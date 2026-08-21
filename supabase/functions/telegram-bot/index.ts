import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { Bot, webhookCallback } from 'https://deno.land/x/grammy@v1.30.0/mod.ts'

import { isAuthorized } from './auth.ts'
import { buildSystemPrompt } from './prompt.ts'
import { formatNowInZone } from './datetime.ts'
import { callClaude } from '../_shared/anthropic.ts'
import { buildTools } from './tools.ts'
import { renderProposedPreview } from './render.ts'
import { fetchSourceFromShare } from './fetchSource.ts'
import { recentActivity } from './library.ts'
import {
  attachSourceText,
  findCaptureByMessageId,
  readTextDocument,
} from './libraryAttach.ts'
import { registerCommands, sendPhoto, sendReply, startTyping } from './telegram.ts'
import { handleBlog } from './blog/handler.ts'
import {
  applyPendingJob,
  classifyReply,
  deleteJob,
  findPendingJob,
  purgeExpiredJobs,
} from './capture.ts'
import {
  describeArmedForItems,
  findTargetReminder,
  handleReminderAction,
  intentContextFor,
  listUpcomingReminders,
} from './reminders.ts'
import { runLibraryRebuild } from '../_shared/libraryRebuild.ts'
import { makeSuggestCall, runLibrarySuggest } from '../_shared/librarySuggest.ts'
import { parseReminderReply } from '../_shared/reminderReply.ts'
import { classifyReminderIntent } from './geminiIntent.ts'
import {
  closeActiveSessions,
  loadRecentTurns,
  persistAssistantTurn,
  persistUserTurn,
  resolveSession,
  setSessionMode,
} from './session.ts'
import type { SessionMode } from './session.ts'

// --- Constants (tunable) ---
const IDLE_MINUTES = 30 // continue same conversation if last reply was within this window
const MAX_TURNS = 12 // recent turns loaded into context (sessions are short by design)
const MODEL = 'claude-sonnet-5' // main reasoning: placement choice + Q&A (accuracy-sensitive)
// Sonnet 5 defaults to `high` effort, which would be slower and pricier than the
// old Sonnet 4.6 behavior. Anthropic rates Sonnet 5 @ medium as comparable to
// Sonnet 4.6 @ high — i.e. today's quality, cheaper. Don't drop below medium:
// at `low` the model makes fewer tool calls and may skip read_tracker_structure,
// which is exactly the step that makes placement good.
const EFFORT = 'medium' as const
// The confirm/cancel classification is a tiny, well-scoped yes/no/change call —
// run it on the fastest model so the "yes" → "Added ✅" round-trip feels instant.
const CLASSIFY_MODEL = 'claude-haiku-4-5-20251001'
// Summarizing a fetched source is a bounded read-and-condense job with no tools
// available to it, so it runs on the fast model too. The accuracy-sensitive
// decision (which section, tracker vs library) already happened upstairs.
const SUMMARIZE_MODEL = 'claude-haiku-4-5-20251001'
// Telegram caps a message at 4096 characters, so a long paste arrives as a
// .txt document instead. Anything bigger than this is not a note the user typed.
const MAX_DOCUMENT_BYTES = 2_000_000
// A quote-reply this long is a pasted article, not a "yes". Below it, the normal
// flow handles the message (a short quote-reply is usually a confirmation).
const ATTACH_MIN_CHARS = 400
// /think: a deeper model with adaptive extended thinking, sticky until /new.
// max_tokens is a hard ceiling that INCLUDES thinking tokens, so the standard
// 2048 default would let thinking eat the whole budget and truncate the answer.
const THINK_MODEL = 'claude-opus-5'
const THINK_EFFORT = 'medium' as const
const THINK_MAX_TOKENS = 8192
const THINK_USAGE =
  'Send /think followed by what you want me to think through, e.g.\n\n' +
  '/think plan out my marathon build\n\n' +
  'I stay in deep-thinking mode until you send /new.'
const TYPING_INTERVAL_MS = 4000 // re-send "typing…" before Telegram's ~5s expiry
// Above this, a message is prose, not a reply to a reminder — don't pay for a
// classification of it. "snooze that one" is 15 characters.
const MAX_INTENT_CHARS = 200

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
// Same default capture.ts uses — search results carry deep links back into the app.
const APP_URL = (Deno.env.get('APP_URL') ?? 'https://life-tracker-mu-sandy.vercel.app').replace(
  /\/$/,
  '',
)

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

// /blog <recap> -> format the recap and create a WordPress draft. Registered
// before the message:text tracker handler so it never collides with it.
bot.command('blog', handleBlog)

// /reminders -> what's armed for the next two weeks. Pure derivation, zero AI.
// This is the feedback loop that makes the feature trustworthy instead of the
// user hoping their phone buzzes.
bot.command('reminders', async (ctx) => {
  try {
    const userId = await getUserId()
    const text = await listUpcomingReminders(supabase, userId, new Date(), USER_TIMEZONE)
    await sendReply(ctx.api, ctx.chat.id, text)
  } catch (err) {
    console.error('/reminders error:', String(err))
    await sendReply(ctx.api, ctx.chat.id, 'Couldn’t read your reminders just now.')
  }
})

// /library -> what the weekly rebuild last changed. Pure reads, zero AI.
//
// Mirrors /reminders, and for the same reason: silent self-rewriting only earns
// trust if the user can see what it did without having to go looking.
bot.command('library', async (ctx) => {
  try {
    const userId = await getUserId()
    const rows = await recentActivity(supabase, userId, 10)
    if (!rows.length) {
      await sendReply(ctx.api, ctx.chat.id, 'Nothing has been rebuilt in your Library yet.')
      return
    }
    const stamp = (iso: string) =>
      new Intl.DateTimeFormat('en-US', {
        timeZone: USER_TIMEZONE,
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date(iso))

    const lines = rows.map((row) => `- ${stamp(row.created_at)} — ${row.summary}`)
    await sendReply(
      ctx.api,
      ctx.chat.id,
      ['**Recent Library changes**', ...lines, '', 'Reply "undo <page name>" to put one back.'].join(
        '\n',
      ),
    )
  } catch (err) {
    console.error('/library error:', String(err))
    await sendReply(ctx.api, ctx.chat.id, 'Couldn’t read your Library activity just now.')
  }
})

/**
 * The whole conversational flow: session, dedup, pending-proposal capture, and
 * the agentic tool loop. Shared by the plain text handler and /think so the
 * logic lives in exactly one place.
 *
 * `forceMode` is set by /think, which switches the session before running.
 */
// deno-lint-ignore no-explicit-any
async function handleUserMessage(ctx: any, text: string, forceMode?: SessionMode): Promise<void> {
  const chatId = ctx.chat.id
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

    const session = await resolveSession(supabase, userId, chatId, IDLE_MINUTES, now)
    const sessionId = session.id

    let mode: SessionMode = session.mode
    if (forceMode && forceMode !== mode) {
      await setSessionMode(supabase, sessionId, forceMode)
      mode = forceMode
      await sendReply(ctx.api, chatId, '🧠 Deep thinking on — staying here until /new')
    }
    const deep = mode === 'think'

    // Dedup: if Telegram retried this exact message, stop after the first time.
    const { duplicate } = await persistUserTurn(supabase, sessionId, text, messageId)
    if (duplicate) return

    // --- Is this a wall of text quote-replied onto a capture? ---
    // Some sources can't be fetched server-side (a paywalled article the user
    // subscribes to). Quote-replying the capture's "Saved 📚" message with the
    // pasted text fills in its source_text. Checked before the pending-proposal
    // block because a long paste is never a confirmation.
    if (replyToMessageId && text.trim().length >= ATTACH_MIN_CHARS) {
      const target = await findCaptureByMessageId(supabase, userId, replyToMessageId)
      if (target) {
        const stored = await attachSourceText(supabase, target.page_id, text, now)
        const reply = stored
          ? `Got it — attached that text to **${target.title}**. It's searchable now.`
          : `Couldn't attach that to **${target.title}**. Try again in a moment.`
        await persistAssistantTurn(supabase, sessionId, reply)
        await sendReply(ctx.api, chatId, reply)
        return
      }
    }

    // A pending preview owns bare confirmations ("done" could mean "yes, add it"),
    // so it's resolved first and reused by the capture block below — same query,
    // same arguments.
    const pendingJob = await findPendingJob(supabase, { userId, sessionId, replyToMessageId })

    // --- Is this message acting on a reminder we sent? ---
    // The deterministic keyword match runs first: free, instant, already
    // unit-tested, and unchanged. Only when it declines — and the message is
    // short enough to plausibly be a reply — do we look for a live reminder and
    // pay for a classification. That gate is what bounds the cost: no model call
    // unless a reminder is actually in play.
    // /think is an explicit "answer this" — never let a short one get read as a
    // cross-off. The keyword path is unchanged there, since it already was.
    const canClassify = !forceMode && text.trim().length <= MAX_INTENT_CHARS
    const keywordAction = parseReminderReply(text)
    if (!pendingJob && (keywordAction || canClassify)) {
      const target = await findTargetReminder(supabase, userId, now, replyToMessageId)
      if (target) {
        const action =
          keywordAction ??
          (await classifyReminderIntent(text, intentContextFor(target, now, USER_TIMEZONE)))
        // null means "just a message" — fall through to the normal flow untouched.
        if (action) {
          const reply = await handleReminderAction(
            supabase,
            userId,
            target,
            action,
            now,
            USER_TIMEZONE,
          )
          await persistAssistantTurn(supabase, sessionId, reply)
          await sendReply(ctx.api, chatId, reply)
          return
        }
      }
    }

    // --- Capture: is this message responding to a pending proposal? ---
    if (pendingJob) {
      const { decision } = await classifyReply(text, CLASSIFY_MODEL)

      if (decision === 'confirm') {
        const result = await applyPendingJob(supabase, pendingJob, now, USER_TIMEZONE)
        let reply: string
        if (result.ok && pendingJob.kind === 'library_capture') {
          await deleteJob(supabase, pendingJob.id)
          reply = `Saved 📚 — [Open in library](${result.deepLink})`
          // Remember which message this capture's confirmation was, so a later
          // quote-reply carrying pasted text can attach itself to this capture.
          const sentId = await sendReply(ctx.api, chatId, reply)
          await persistAssistantTurn(supabase, sessionId, reply)
          if (sentId != null) {
            await supabase
              .from('library_sources')
              .update({ telegram_message_id: sentId })
              .eq('page_id', result.pageId)
          }
          // Re-render the Library pages that make this capture findable in the
          // app — the section's front page, Lately, Activity. Free: the rebuild
          // makes zero model calls, it only renders what capture time already
          // decided and stored.
          //
          // AFTER the reply, so it adds nothing to the user's "Saved 📚", and
          // inside a try/catch that only logs: the capture is already committed
          // by this point, and a rendering failure must never turn a successful
          // save into an error message.
          try {
            const { summary } = await runLibraryRebuild(supabase, {
              timeZone: USER_TIMEZONE,
              sectionIds: result.sectionId ? [result.sectionId] : undefined,
            })
            if (!summary.ok) console.error('post-capture rebuild failed:', summary.error)
          } catch (err) {
            console.error('post-capture rebuild error:', String(err))
          }

          // Then notice what the new capture might be part of: "2 saved, both
          // about recovering from a rough race — want a topic for that?"
          //
          // A MODEL CALL, which is exactly why it is not folded into the rebuild
          // above — libraryRebuild.ts promises ZERO MODEL CALLS and that promise
          // is what makes a per-capture rebuild free. This one is gated on the
          // stored set being stale (six hours by default), so a burst of saves
          // costs one pass and not one per save.
          //
          // Same try/catch-and-log for the same reason: the capture is already
          // committed and the user has already been told so.
          try {
            const summary = await runLibrarySuggest(supabase, {
              callModel: makeSuggestCall(),
              sectionIds: result.sectionId ? [result.sectionId] : undefined,
            })
            if (!summary.ok) console.error('post-capture suggest failed:', summary.error)
          } catch (err) {
            console.error('post-capture suggest error:', String(err))
          }
          return
        }
        if (result.ok) {
          await deleteJob(supabase, pendingJob.id)
          // Derived, never asserted: this runs the same parser the cron sweep
          // does over the same stored {{date:…}} strings, so the bot can't
          // promise a text that won't arrive. Silence = nothing armed.
          const armed = describeArmedForItems(
            (pendingJob.placement as { items?: string[] })?.items ?? [],
            result.pageTitle,
            now,
            USER_TIMEZONE,
          )
          reply = `Added ✅ — [Open in tracker](${result.deepLink})` + (armed ? `\n\n${armed}` : '')
        } else if (result.reason === 'no_section') {
          await deleteJob(supabase, pendingJob.id)
          reply =
            'I couldn’t work out which Library section to file that in. Tell me the section ' +
            'and I’ll re-propose.'
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
      fetchSource: fetchSourceFromShare,
      summarizeModel: SUMMARIZE_MODEL,
    }, APP_URL)

    const reply = await callClaude({
      system: buildSystemPrompt(true, nowDisplay, deep),
      messages: turns.map((t) => ({ role: t.role, content: t.content })),
      tools: tools.defs,
      runTool: tools.runTool,
      model: deep ? THINK_MODEL : MODEL,
      effort: deep ? THINK_EFFORT : EFFORT,
      ...(deep ? { maxTokens: THINK_MAX_TOKENS, thinking: { type: 'adaptive' as const } } : {}),
    })

    await persistAssistantTurn(supabase, sessionId, reply)
    await sendReply(ctx.api, chatId, reply)
  } catch (err) {
    console.error('telegram-bot handler error:', String(err))
    await sendReply(ctx.api, chatId, 'Sorry — something went wrong on my end. Please try again.')
  } finally {
    stopTyping()
  }
}

// /think <question> -> switch this session into deep-thinking mode and answer.
// Registered before message:text so it never collides with it; ctx.match keeps
// the literal "/think" out of what the model sees.
bot.command('think', async (ctx) => {
  const question = (ctx.match ?? '').trim()
  if (!question) {
    await sendReply(ctx.api, ctx.chat.id, THINK_USAGE)
    return
  }
  await handleUserMessage(ctx, question, 'think')
})

bot.on('message:text', async (ctx) => {
  await handleUserMessage(ctx, ctx.message.text)
})

/**
 * A .txt document — how a paste longer than Telegram's 4096-character message
 * cap arrives. Quote-replied onto a capture's confirmation, it becomes that
 * capture's source text.
 *
 * This is the bot's first non-text handler. Before it, a document (or a photo,
 * or a voice note) fell through in complete silence with no reply at all, which
 * looks exactly like the bot being broken.
 */
bot.on('message:document', async (ctx) => {
  const chatId = ctx.chat.id
  const replyToMessageId = ctx.message.reply_to_message?.message_id ?? null
  const fileId = ctx.message.document?.file_id

  if (!replyToMessageId) {
    await sendReply(
      ctx.api,
      chatId,
      'I can read a .txt file if you reply to a saved item with it — that attaches the full ' +
        'text to that capture. On its own I don’t have anywhere to put it.',
    )
    return
  }

  const stopTyping = startTyping(ctx.api, chatId, TYPING_INTERVAL_MS)
  try {
    const userId = await getUserId()
    const target = await findCaptureByMessageId(supabase, userId, replyToMessageId)
    if (!target) {
      await sendReply(
        ctx.api,
        chatId,
        'That reply isn’t on one of your saved Library items, so I don’t know what to attach it to.',
      )
      return
    }
    if (!fileId) {
      await sendReply(ctx.api, chatId, 'I couldn’t find a file on that message.')
      return
    }

    const read = await readTextDocument(BOT_TOKEN, fileId, MAX_DOCUMENT_BYTES)
    if (!read.ok) {
      await sendReply(ctx.api, chatId, read.reason)
      return
    }

    const stored = await attachSourceText(supabase, target.page_id, read.text, new Date())
    await sendReply(
      ctx.api,
      chatId,
      stored
        ? `Got it — attached that text to **${target.title}**. It's searchable now.`
        : `Couldn’t attach that to **${target.title}**. Try again in a moment.`,
    )
  } catch (err) {
    console.error('document handler error:', String(err))
    await sendReply(ctx.api, chatId, 'Sorry — something went wrong reading that file.')
  } finally {
    stopTyping()
  }
})

// Everything else a user can send. Without this, a photo or a voice note is met
// with total silence, which is indistinguishable from the bot being down.
bot.on(['message:photo', 'message:voice', 'message:audio', 'message:video'], async (ctx) => {
  await sendReply(
    ctx.api,
    ctx.chat.id,
    'I can only read text for now. Send a link with a thought and I’ll save it, or paste the ' +
      'text itself.',
  )
})

// Register the command menu once at cold start (non-fatal if it fails).
registerCommands(bot.api)

// grammY verifies the secret-token header; mismatches get 401.
// timeoutMilliseconds: grammY's default is 10s, after which it abandons the
// handler and the edge worker is torn down mid-flight. The capture flow (a few
// Claude calls + a headless-Chrome render + photo send) routinely needs longer,
// so we raise the ceiling well under Telegram's ~60s webhook tolerance and
// Supabase's wall-clock limit. Slow flows still complete and reply.
const handleUpdate = webhookCallback(bot, 'std/http', {
  secretToken: WEBHOOK_SECRET,
  timeoutMilliseconds: 55_000,
})

Deno.serve(async (req) => {
  try {
    return await handleUpdate(req)
  } catch (err) {
    console.error('webhook error:', String(err))
    return new Response('ok', { status: 200 }) // ack to avoid Telegram retry storms
  }
})
