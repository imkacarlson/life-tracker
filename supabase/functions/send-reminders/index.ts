// Reminder sweep. Runs every 5 minutes; re-derives the complete reminder set
// from the current tracker documents and sends whatever is due and unsent.
//
// The import graph is deliberately tiny — supabase-js plus the pure _shared
// modules. NO grammY, NO telegramify-markdown, NO puppeteer: this cold-starts
// 288 times a day, and it emits one fixed message format we control.
//
// Cost: ~8.6K invocations/month against a 500K free tier, ~1s each, and ZERO AI
// tokens. Extraction is deterministic regex over document JSON.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

import {
  countOrphanedTimedHighlights,
  deriveReminders,
  type DerivedReminder,
} from '../_shared/deriveReminders.ts'
import { buildDeepLink } from '../_shared/deepLink.ts'
import { buildReminderText, cleanLineText } from '../_shared/reminderMessage.ts'
import { localIsoDate } from '../_shared/wallClock.ts'

// --- Config ---
const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? ''
// In a Telegram private chat, chat.id === from.id (see telegram-bot/auth.ts), so
// the allowlisted user id IS the destination chat id.
const CHAT_ID = Deno.env.get('TELEGRAM_ALLOWED_USER_ID') ?? ''
const USER_TIMEZONE = Deno.env.get('USER_TIMEZONE') ?? 'America/New_York'
const APP_URL = Deno.env.get('APP_URL') ?? 'https://life-tracker-mu-sandy.vercel.app'

const num = (name: string, fallback: number): number => {
  const parsed = Number(Deno.env.get(name))
  return Number.isFinite(parsed) ? parsed : fallback
}

const DEFAULT_LEAD_MINUTES = num('REMINDER_DEFAULT_LEAD_MINUTES', 90)
// Backfill guard: never send something that came due while the function was down.
const GRACE_MINUTES = num('REMINDER_GRACE_MINUTES', 120)
const QUIET_START_HOUR = num('REMINDER_QUIET_START_HOUR', 22)
const QUIET_END_HOUR = num('REMINDER_QUIET_END_HOUR', 7)
// A parse regression sends 10 texts and logs the overflow, not 600.
const MAX_PER_TICK = num('REMINDER_MAX_PER_TICK', 10)
// Deploy-day seatbelt: ignore anything that would have fired before this instant.
const MIN_FIRE_AT = Deno.env.get('REMINDER_MIN_FIRE_AT') ?? ''
const DRY_RUN = (Deno.env.get('REMINDER_DRY_RUN') ?? '') === '1'

// The autosave debounce is 2s (useTrackers.js), so a tick can otherwise catch a
// half-typed "8/17 8:20am" on its way to "8:20pm" and send it. Costs ≤1 minute
// of latency to skip pages that were touched in the last minute.
const STABILITY_WINDOW_MS = 60_000
// Telegram sustains roughly one message per second to a single chat.
const SEND_GAP_MS = 250
// Don't remind someone about something that already happened.
const PAST_DUE_TOLERANCE_MS = 15 * 60_000

const MS_PER_MINUTE = 60_000

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

type SnoozeRow = {
  id: string
  block_id: string
  page_id: string | null
  fire_at: string
  line_text: string | null
}

/** Direct fetch, not grammY — one dependency and one code path. */
async function sendMessage(text: string): Promise<number | null> {
  const resp = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text,
      // Otherwise Telegram fetches a link-preview card on every single reminder.
      disable_web_page_preview: true,
    }),
  })
  if (!resp.ok) {
    throw new Error(`telegram sendMessage failed (${resp.status}) ${await resp.text().catch(() => '')}`)
  }
  const data = await resp.json().catch(() => null)
  const id = data?.result?.message_id
  return typeof id === 'number' ? id : null
}

Deno.serve(async (req) => {
  // --- 1. Auth (mirrors check-scores) — fail closed BEFORE any comparison. ---
  const cronSecret = Deno.env.get('CRON_SECRET')
  if (!cronSecret) {
    console.error('CRON_SECRET not configured')
    return json({ error: 'Server misconfigured' }, 500)
  }
  if (req.headers.get('x-cron-secret') !== cronSecret) {
    return json({ error: 'Unauthorized' }, 401)
  }
  if (!BOT_TOKEN || !CHAT_ID) {
    console.error('TELEGRAM_BOT_TOKEN / TELEGRAM_ALLOWED_USER_ID not configured')
    return json({ error: 'Telegram not configured' }, 500)
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  const now = Date.now()
  const summary = {
    ok: true,
    dryRun: DRY_RUN,
    derived: 0,
    due: 0,
    sent: 0,
    skipped: 0,
    snoozesSent: 0,
    overflow: 0,
    orphanedTimedHighlights: 0,
  }

  try {
    // --- 4. Read the tracker pages. ---
    const { data: pages, error: pagesError } = await supabase
      .from('pages')
      .select('id, title, content, section_id, user_id, updated_at')
      .eq('is_tracker_page', true)
    if (pagesError) {
      console.error('load pages failed:', pagesError.message)
      return json({ error: 'Failed to load pages' }, 500)
    }
    const allPages = pages ?? []
    const userId = allPages[0]?.user_id
    if (!userId) return json({ ...summary, note: 'no tracker pages' })

    // --- 3. Any snoozes that have come due go out first. ---
    if (!DRY_RUN) {
      summary.snoozesSent = await sendDueSnoozes(supabase, now)
    }

    // --- 5. Stability guard. ---
    const stablePages = allPages.filter(
      (page) => now - Date.parse(page.updated_at ?? 0) > STABILITY_WINDOW_MS,
    )

    // --- 6. Derive. ⚠️ todayLocal MUST come from localIsoDate, not
    // toISOString().slice(0,10) — see the `today` trap in deriveReminders.ts. ---
    const todayLocal = localIsoDate(now, USER_TIMEZONE)
    const derived = deriveReminders(
      stablePages.map((page) => ({ id: page.id, title: page.title, content: page.content })),
      {
        todayLocal,
        timeZone: USER_TIMEZONE,
        defaultLeadMinutes: DEFAULT_LEAD_MINUTES,
        quiet: { startHour: QUIET_START_HOUR, endHour: QUIET_END_HOUR },
      },
    )
    summary.derived = derived.length

    // --- 6b. Diagnostic: any timed highlight we could NOT reach at all. ---
    summary.orphanedTimedHighlights = countOrphanedTimedHighlights(stablePages, derived.length)
    if (summary.orphanedTimedHighlights > 0) {
      console.warn(
        `${summary.orphanedTimedHighlights} highlighted date(s) carry a clock time but produced ` +
          'no reminder — a new class of unreachable date. Investigate.',
      )
    }

    // --- 7. Filter. ---
    const minFireAt = MIN_FIRE_AT ? Date.parse(MIN_FIRE_AT) : Number.NEGATIVE_INFINITY
    const graceFloor = now - GRACE_MINUTES * MS_PER_MINUTE
    const due = derived.filter(
      (reminder) =>
        reminder.fireAt <= now &&
        reminder.fireAt >= graceFloor &&
        reminder.fireAt >= minFireAt &&
        reminder.dueAt >= now - PAST_DUE_TOLERANCE_MS,
    )
    summary.due = due.length

    // --- 8. Cap. ---
    const ordered = due.slice().sort((a, b) => a.fireAt - b.fireAt)
    const batch = ordered.slice(0, MAX_PER_TICK)
    summary.overflow = ordered.length - batch.length
    if (summary.overflow > 0) {
      console.warn(`${summary.overflow} reminder(s) over the per-tick cap; deferred to the next tick`)
    }

    // --- 9. Dry run stops here: nothing sent, nothing written. ---
    if (DRY_RUN) {
      return json({
        ...summary,
        preview: batch.map((r) => ({
          dedupKey: r.dedupKey,
          fireAt: new Date(r.fireAt).toISOString(),
          dueAt: new Date(r.dueAt).toISOString(),
          leadMinutes: r.leadMinutes,
          lineText: r.lineText,
        })),
      })
    }

    // --- 10. Batch-resolve notebook ids for the deep links. ---
    const pageById = new Map(allPages.map((page) => [page.id, page]))
    const sectionIds = [
      ...new Set(batch.map((r) => pageById.get(r.pageId ?? '')?.section_id).filter(Boolean)),
    ]
    const notebookBySection = new Map<string, string>()
    if (sectionIds.length) {
      const { data: sections } = await supabase
        .from('sections')
        .select('id, notebook_id')
        .in('id', sectionIds as string[])
      for (const section of sections ?? []) notebookBySection.set(section.id, section.notebook_id)
    }

    // --- 11. Claim, send, record. ---
    for (const [index, reminder] of batch.entries()) {
      const claimed = await claim(supabase, userId, reminder)
      if (!claimed) {
        summary.skipped += 1
        continue
      }

      const page = pageById.get(reminder.pageId ?? '')
      const deepLink = buildDeepLink(
        {
          notebookId: page?.section_id ? notebookBySection.get(page.section_id) : null,
          sectionId: page?.section_id ?? null,
          pageId: reminder.pageId,
          blockId: reminder.blockId,
        },
        APP_URL,
      )

      try {
        if (index > 0) await sleep(SEND_GAP_MS)
        const messageId = await sendMessage(buildReminderText(reminder, USER_TIMEZONE, deepLink))
        await supabase
          .from('bot_reminders')
          .update({
            status: 'sent',
            sent_at: new Date().toISOString(),
            telegram_message_id: messageId,
          })
          .eq('id', claimed)
        summary.sent += 1
      } catch (err) {
        // Drop the claim so the next tick retries rather than silently losing it.
        console.error('send failed, releasing claim:', String(err))
        await supabase.from('bot_reminders').delete().eq('id', claimed)
      }
    }

    return json(summary)
  } catch (err) {
    console.error('send-reminders error:', String(err))
    return json({ ok: false, error: String(err) }, 500)
  }
})

/**
 * Claim-insert (the check-scores dedup pattern): the unique index on
 * (user_id, dedup_key) is the lock. A 23505 means another tick — or an earlier
 * send of this exact reminder — already owns it.
 */
async function claim(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  reminder: DerivedReminder,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('bot_reminders')
    .insert({
      user_id: userId,
      dedup_key: reminder.dedupKey,
      source: 'derived',
      block_id: reminder.blockId,
      page_id: reminder.pageId,
      due_at: new Date(reminder.dueAt).toISOString(),
      lead_minutes: reminder.leadMinutes,
      fire_at: new Date(reminder.fireAt).toISOString(),
      // Store it already cleaned: this snapshot is what a "done" reply quotes
      // back and what /reminders lists, and the lead clause is machine-facing.
      line_text: cleanLineText(reminder.lineText, reminder.leadMatch),
      status: 'pending',
    })
    .select('id')
    .single()

  if (error) {
    if (error.code !== '23505') console.error('claim insert failed:', error.message)
    return null
  }
  return data?.id ?? null
}

/** Snoozes are already-decided sends: one row, one message, no re-derivation. */
async function sendDueSnoozes(
  supabase: ReturnType<typeof createClient>,
  now: number,
): Promise<number> {
  const { data, error } = await supabase
    .from('bot_reminders')
    .select('id, block_id, page_id, fire_at, line_text')
    .eq('source', 'snooze')
    .eq('status', 'pending')
    .lte('fire_at', new Date(now).toISOString())
    .order('fire_at', { ascending: true })
    .limit(MAX_PER_TICK)
  if (error || !data?.length) return 0

  let sent = 0
  for (const row of data as SnoozeRow[]) {
    try {
      const deepLink = buildDeepLink({ pageId: row.page_id, blockId: row.block_id }, APP_URL)
      const messageId = await sendMessage(
        buildReminderText(
          { dueAt: Date.parse(row.fire_at), leadMinutes: 0, lineText: row.line_text ?? '', leadMatch: null },
          USER_TIMEZONE,
          deepLink,
        ),
      )
      await supabase
        .from('bot_reminders')
        .update({ status: 'sent', sent_at: new Date().toISOString(), telegram_message_id: messageId })
        .eq('id', row.id)
      sent += 1
      await sleep(SEND_GAP_MS)
    } catch (err) {
      console.error('snooze send failed:', String(err))
    }
  }
  return sent
}
