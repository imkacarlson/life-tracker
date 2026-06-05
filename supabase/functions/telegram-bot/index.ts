import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { Bot, webhookCallback } from 'https://deno.land/x/grammy@v1.30.0/mod.ts'

import { isAuthorized } from './auth.ts'
import { buildSystemPrompt } from './prompt.ts'
import { formatNowInZone } from './datetime.ts'
import { callClaude } from './anthropic.ts'
import { buildTools } from './tools.ts'
import { renderProposedPreview } from './render.ts'
import { registerCommands, sendPhoto, sendReply, startTyping } from './telegram.ts'
import {
  applyPendingJob,
  classifyReply,
  deleteJob,
  findPendingJob,
  purgeExpiredJobs,
} from './capture.ts'
import {
  closeActiveSessions,
  loadRecentTurns,
  persistAssistantTurn,
  persistUserTurn,
  resolveSession,
} from './session.ts'

// --- Constants (tunable) ---
const IDLE_MINUTES = 30 // continue same conversation if last reply was within this window
const MAX_TURNS = 12 // recent turns loaded into context (sessions are short by design)
const MODEL = 'claude-sonnet-4-6' // matches the app's default
const TYPING_INTERVAL_MS = 4000 // re-send "typing…" before Telegram's ~5s expiry

// --- Secrets / config ---
// verify_jwt = false is deliberate: Telegram cannot send a Supabase JWT. Auth is
// the webhook secret-token header (verified by grammY) + a Telegram user-ID
// allowlist that also pins the reply destination (see auth.ts).
const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? ''
const WEBHOOK_SECRET = Deno.env.get('TELEGRAM_WEBHOOK_SECRET') ?? ''
const ALLOWED_USER_ID = Deno.env.get('TELEGRAM_ALLOWED_USER_ID') ?? ''
// The user's local IANA time zone. Telegram never sends the sender's zone, so it
// comes from config; "today"/"now" and current-month selection are computed in
// this zone. Update the secret if you relocate long-term. Documented fallback.
const USER_TIMEZONE = Deno.env.get('USER_TIMEZONE') ?? 'America/New_York'

// Service-role client; access is scoped in code to the single known user.
const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
)

// Resolve (and cache) the single app user — this is a personal, single-user app.
let cachedUserId: string | null = null
async function getUserId(): Promise<string> {
  if (cachedUserId) return cachedUserId
  // Find the user who actually owns tracker pages (there may be multiple auth users).
  const { data, error } = await supabase
    .from('pages')
    .select('user_id')
    .eq('is_tracker_page', true)
    .limit(1)
    .single()
  if (error || !data?.user_id) throw new Error('No tracker-owning user found')
  cachedUserId = data.user_id
  return data.user_id
}

const bot = new Bot(BOT_TOKEN)

// Drop everything that isn't from the allowed user in their own private chat.
bot.use(async (ctx, next) => {
  if (!isAuthorized(ctx.from?.id, ctx.chat?.id, ALLOWED_USER_ID)) return
  await next()
})

// /new -> close the active session; next message starts fresh.
bot.command('new', async (ctx) => {
  await closeActiveSessions(supabase, ctx.chat.id)
  await ctx.reply('Starting fresh ✨')
})

bot.on('message:text', async (ctx) => {
  const chatId = ctx.chat.id
  const text = ctx.message.text
  const messageId = ctx.message.message_id
  // A quote-reply to a preview photo lets the user re-activate that exact
  // proposal, even past the idle window.
  const replyToMessageId = ctx.message.reply_to_message?.message_id ?? null

  const stopTyping = startTyping(ctx.api, chatId, TYPING_INTERVAL_MS)
  try {
    const userId = await getUserId()
    const now = new Date()

    // Opportunistic cleanup so expired proposals never accumulate.
    await purgeExpiredJobs(supabase)

    const sessionId = await resolveSession(supabase, userId, chatId, IDLE_MINUTES, now)

    // Dedup: if Telegram retried this exact message, stop after the first time.
    const { duplicate } = await persistUserTurn(supabase, sessionId, text, messageId)
    if (duplicate) return

    // --- Capture: is this message responding to a pending proposal? ---
    const pendingJob = await findPendingJob(supabase, { userId, sessionId, replyToMessageId })
    if (pendingJob) {
      const { decision } = await classifyReply(text, MODEL)

      if (decision === 'confirm') {
        const result = await applyPendingJob(supabase, pendingJob, now)
        let reply: string
        if (result.ok) {
          await deleteJob(supabase, pendingJob.id)
          reply = `Added ✅\n${result.deepLink}`
        } else if (result.reason === 'anchor_missing') {
          await deleteJob(supabase, pendingJob.id)
          reply =
            'Your tracker changed since I drafted that, so the spot I picked is gone. ' +
            'Send me the addition again and I’ll re-propose.'
        } else {
          // conflict/error — keep the job so the user can simply confirm again.
          reply = 'Couldn’t save that just now — reply to confirm again in a moment.'
        }
        await persistAssistantTurn(supabase, sessionId, reply)
        await sendReply(ctx.api, chatId, reply)
        return
      }

      if (decision === 'cancel') {
        await deleteJob(supabase, pendingJob.id)
        const reply = 'Okay, scrapped that — nothing was added.'
        await persistAssistantTurn(supabase, sessionId, reply)
        await sendReply(ctx.api, chatId, reply)
        return
      }

      if (decision === 'revise') {
        // Supersede the old proposal; the normal loop below re-proposes from the
        // conversation, which now includes this revision.
        await deleteJob(supabase, pendingJob.id)
      }
      // 'unclear' falls through too: answer the message normally and leave the
      // proposal pending, so a later "yes" (or a quote-reply) still applies it.
    }

    // --- Normal agentic loop (Q&A + propose) ---
    const turns = await loadRecentTurns(supabase, sessionId, MAX_TURNS)
    const nowDisplay = formatNowInZone(now, USER_TIMEZONE).display
    const tools = buildTools(supabase, userId, now, USER_TIMEZONE, {
      api: ctx.api,
      chatId,
      sessionId,
      sendPhoto,
      renderPreview: renderProposedPreview,
    })

    const reply = await callClaude({
      system: buildSystemPrompt(true, nowDisplay),
      messages: turns.map((t) => ({ role: t.role, content: t.content })),
      tools: tools.defs,
      runTool: tools.runTool,
      model: MODEL,
    })

    await persistAssistantTurn(supabase, sessionId, reply)
    await sendReply(ctx.api, chatId, reply)
  } catch (err) {
    console.error('telegram-bot handler error:', String(err))
    await sendReply(ctx.api, chatId, 'Sorry — something went wrong on my end. Please try again.')
  } finally {
    stopTyping()
  }
})

// Register the command menu once at cold start (non-fatal if it fails).
registerCommands(bot.api)

// grammY verifies the secret-token header; mismatches get 401.
const handleUpdate = webhookCallback(bot, 'std/http', { secretToken: WEBHOOK_SECRET })

Deno.serve(async (req) => {
  try {
    return await handleUpdate(req)
  } catch (err) {
    console.error('webhook error:', String(err))
    return new Response('ok', { status: 200 }) // ack to avoid Telegram retry storms
  }
})
