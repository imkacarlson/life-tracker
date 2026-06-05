import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { Bot, webhookCallback } from 'https://deno.land/x/grammy@v1.30.0/mod.ts'

import { isAuthorized } from './auth.ts'
import { buildSystemPrompt } from './prompt.ts'
import { formatNowInZone } from './datetime.ts'
import { callClaude } from './anthropic.ts'
import { buildTools } from './tools.ts'
import { selectCurrentMonthTracker } from './trackerText.ts'
import { pickContextBlockId, renderTrackerPreview } from './preview.ts'
import {
  registerCommands,
  sendDocument,
  sendPhoto,
  sendReply,
  startTyping,
} from './telegram.ts'
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

// TEMPORARY (Phase A verification): render the current month's tracker to a
// screenshot and send it both ways (compressed photo + crisp file) so we can
// compare and confirm the end-to-end edge -> Vercel -> Telegram path. Phase B
// replaces this with the real add-to-tracker propose/preview/confirm flow.
bot.command('preview', async (ctx) => {
  const chatId = ctx.chat.id
  const stopTyping = startTyping(ctx.api, chatId, TYPING_INTERVAL_MS)
  try {
    const userId = await getUserId()
    const { data } = await supabase
      .from('pages')
      .select('id, title, content, is_tracker_page, updated_at')
      .eq('user_id', userId)
      .eq('is_tracker_page', true)
    const page = selectCurrentMonthTracker(data ?? [], new Date(), USER_TIMEZONE)
    if (!page?.id) {
      await ctx.reply('No tracker page found for this month.')
      return
    }
    const blockId = pickContextBlockId(page.content)
    const png = await renderTrackerPreview(page.id, blockId)
    await sendPhoto(ctx.api, chatId, png, `${page.title} — as photo (compressed)`)
    await sendDocument(ctx.api, chatId, png, `${page.title} — as file (crisp)`)
  } catch (err) {
    console.error('preview command error:', String(err))
    await sendReply(ctx.api, chatId, `Preview failed: ${String(err)}`)
  } finally {
    stopTyping()
  }
})

bot.on('message:text', async (ctx) => {
  const chatId = ctx.chat.id
  const text = ctx.message.text
  const messageId = ctx.message.message_id

  const stopTyping = startTyping(ctx.api, chatId, TYPING_INTERVAL_MS)
  try {
    const userId = await getUserId()
    const now = new Date()

    const sessionId = await resolveSession(supabase, userId, chatId, IDLE_MINUTES, now)

    // Dedup: if Telegram retried this exact message, stop after the first time.
    const { duplicate } = await persistUserTurn(supabase, sessionId, text, messageId)
    if (duplicate) return

    const turns = await loadRecentTurns(supabase, sessionId, MAX_TURNS)
    const nowDisplay = formatNowInZone(now, USER_TIMEZONE).display
    const tools = buildTools(supabase, userId, now, USER_TIMEZONE)

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
