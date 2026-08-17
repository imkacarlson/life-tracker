// Bot-side reminder handling: the post-confirmation "I'll text you…" line, the
// /reminders listing, and the done / snooze replies.
//
// All the parsing is pure and lives in _shared/; this module is only the Supabase
// and Telegram plumbing around it. Zero AI calls — every path here is
// deterministic, which is what makes it cheap enough to run on every message.

import {
  deriveReminders,
  snoozeDedupKey,
  type DeriveOptions,
  type DerivedReminder,
} from '../_shared/deriveReminders.ts'
import { resolveTrackerAnchor } from '../_shared/dailyHelpers.ts'
import {
  buildDoneConfirmation,
  buildSnoozeConfirmation,
  cleanLineText,
  describeArmedReminders,
  describeLead,
} from '../_shared/reminderMessage.ts'
import type { IntentContext } from '../_shared/reminderIntent.ts'
import type { ReminderAction } from '../_shared/reminderReply.ts'
import { buildDeepLink } from '../_shared/deepLink.ts'
import { strikeBlock, type TiptapNode } from '../_shared/strikeBlock.ts'
import { formatInZone, localIsoDate } from '../_shared/wallClock.ts'
import { DEFAULT_LEAD_MINUTES } from '../_shared/leadTime.ts'

type SupabaseLike = { from: (table: string) => any }

const APP_URL = Deno.env.get('APP_URL') ?? 'https://life-tracker-mu-sandy.vercel.app'
const QUIET_START_HOUR = 22
const QUIET_END_HOUR = 7

/** A reminder sent in the last N hours can be acted on by a bare keyword. */
const RECENT_REMINDER_HOURS = 6
const LIST_HORIZON_DAYS = 14

export const deriveOptionsFor = (now: Date, timeZone: string): DeriveOptions => ({
  todayLocal: localIsoDate(now, timeZone),
  timeZone,
  defaultLeadMinutes: DEFAULT_LEAD_MINUTES,
  quiet: { startHour: QUIET_START_HOUR, endHour: QUIET_END_HOUR },
})

/**
 * What the bot promises after applying a confirmed addition.
 *
 * Runs the SAME deriver the cron sweep uses over the SAME persisted
 * {{date:…}} strings, so the bot cannot claim a reminder the sweep won't send.
 * Silence here means the parser couldn't read it — which is exactly the signal
 * the user needs, immediately and visibly.
 */
export function describeArmedForItems(
  items: string[],
  pageTitle: unknown,
  now: Date,
  timeZone: string,
): string {
  const opts = deriveOptionsFor(now, timeZone)
  const anchor = resolveTrackerAnchor(pageTitle, opts.todayLocal)
  return describeArmedReminders(items, anchor, opts)
}

async function loadTrackerPages(supabase: SupabaseLike, userId: string) {
  const { data } = await supabase
    .from('pages')
    .select('id, title, content, section_id')
    .eq('user_id', userId)
    .eq('is_tracker_page', true)
  return data ?? []
}

/** /reminders — everything armed in the next 14 days, plus pending snoozes. */
export async function listUpcomingReminders(
  supabase: SupabaseLike,
  userId: string,
  now: Date,
  timeZone: string,
): Promise<string> {
  const pages = await loadTrackerPages(supabase, userId)
  const horizon = now.getTime() + LIST_HORIZON_DAYS * 86_400_000

  const derived = deriveReminders(pages, deriveOptionsFor(now, timeZone))
    .filter((r) => r.fireAt >= now.getTime() && r.fireAt <= horizon)
    .sort((a, b) => a.fireAt - b.fireAt)

  const { data: snoozes } = await supabase
    .from('bot_reminders')
    .select('fire_at, line_text')
    .eq('user_id', userId)
    .eq('source', 'snooze')
    .eq('status', 'pending')
    .gte('fire_at', new Date(now.getTime()).toISOString())
    .order('fire_at', { ascending: true })

  const lines: string[] = []
  for (const reminder of derived) {
    lines.push(
      `• ${formatInZone(reminder.fireAt, timeZone, ' at ')} — ${summarize(reminder)} ` +
        `_(${describeLead(reminder.leadMinutes)} before)_`,
    )
  }
  for (const snooze of snoozes ?? []) {
    lines.push(
      `• ${formatInZone(Date.parse(snooze.fire_at), timeZone, ' at ')} — ` +
        `${snooze.line_text ?? 'snoozed reminder'} _(snoozed)_`,
    )
  }

  if (!lines.length) {
    return `Nothing armed in the next ${LIST_HORIZON_DAYS} days. Highlight a date **with a clock time** to arm one.`
  }
  return [`**Armed for the next ${LIST_HORIZON_DAYS} days:**`, ...lines].join('\n')
}

const summarize = (reminder: DerivedReminder): string => {
  const text = cleanLineText(reminder.lineText, reminder.leadMatch)
  return text.length > 80 ? `${text.slice(0, 79)}…` : text
}

export type SentReminder = {
  id: string
  block_id: string
  page_id: string | null
  line_text: string | null
  sent_at: string | null
}

const SENT_COLS = 'id, block_id, page_id, line_text, sent_at'

/**
 * Which reminder is this reply about?
 *   1. A quote-reply to the reminder message itself — highest precedence, works
 *      at any age.
 *   2. Otherwise the most recent reminder sent in the last few hours.
 * Returns null when neither applies, so the message goes down the normal path.
 */
export async function findTargetReminder(
  supabase: SupabaseLike,
  userId: string,
  now: Date,
  replyToMessageId?: number | null,
): Promise<SentReminder | null> {
  if (replyToMessageId) {
    const { data } = await supabase
      .from('bot_reminders')
      .select(SENT_COLS)
      .eq('user_id', userId)
      .eq('telegram_message_id', replyToMessageId)
      .maybeSingle()
    if (data) return data as SentReminder
  }

  const cutoff = new Date(now.getTime() - RECENT_REMINDER_HOURS * 3_600_000).toISOString()
  const { data } = await supabase
    .from('bot_reminders')
    .select(SENT_COLS)
    .eq('user_id', userId)
    .eq('status', 'sent')
    .gte('sent_at', cutoff)
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as SentReminder) ?? null
}

export type DoneResult =
  | { ok: true; quoted: string; deepLink: string }
  | { ok: false; reason: 'not_found' | 'conflict' | 'error' }

/**
 * Cross the reminder's block off in the tracker.
 *
 * Same OCC pattern as capture.ts applyPendingJob: re-read, write under an
 * updated_at guard, retry a couple of times on a concurrent write.
 */
export async function applyDone(
  supabase: SupabaseLike,
  reminder: SentReminder,
  now: Date,
): Promise<DoneResult> {
  if (!reminder.page_id) return { ok: false, reason: 'not_found' }

  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: page, error } = await supabase
      .from('pages')
      .select('content, updated_at, section_id')
      .eq('id', reminder.page_id)
      .maybeSingle()
    if (error || !page) return { ok: false, reason: 'error' }

    const { doc, found } = strikeBlock(page.content as TiptapNode, reminder.block_id)
    if (!found) return { ok: false, reason: 'not_found' }

    const { data: written } = await supabase
      .from('pages')
      .update({ content: doc, updated_at: now.toISOString() })
      .eq('id', reminder.page_id)
      .eq('updated_at', page.updated_at)
      .select('updated_at')
      .maybeSingle()

    if (written) {
      const { data: section } = page.section_id
        ? await supabase.from('sections').select('notebook_id').eq('id', page.section_id).maybeSingle()
        : { data: null }
      return {
        ok: true,
        quoted: (reminder.line_text ?? '').replace(/\s+/g, ' ').trim(),
        deepLink: buildDeepLink(
          {
            notebookId: section?.notebook_id,
            sectionId: page.section_id,
            pageId: reminder.page_id,
            blockId: reminder.block_id,
          },
          APP_URL,
        ),
      }
    }
    // Zero rows matched -> a concurrent write landed; re-read and re-apply.
  }
  return { ok: false, reason: 'conflict' }
}

/**
 * Re-arm a reminder for later. Writes a ledger row only — no `pages` write at
 * all — which the sweep's snooze pass picks up.
 */
export async function scheduleSnooze(
  supabase: SupabaseLike,
  userId: string,
  reminder: SentReminder,
  minutes: number,
  now: Date,
): Promise<{ ok: boolean; fireAt: number }> {
  const fireAt = now.getTime() + minutes * 60_000
  const { error } = await supabase.from('bot_reminders').insert({
    user_id: userId,
    dedup_key: snoozeDedupKey(reminder.block_id, fireAt),
    source: 'snooze',
    block_id: reminder.block_id,
    page_id: reminder.page_id,
    fire_at: new Date(fireAt).toISOString(),
    line_text: reminder.line_text,
    status: 'pending',
  })
  // 23505 means an identical snooze already exists — same outcome for the user.
  return { ok: !error || error.code === '23505', fireAt }
}

/**
 * What the intent classifier needs to read a reply: which line the reminder was
 * about (so "that one" has a referent), when it went out, and what time it is
 * now (so "give me an hour" is anchored).
 */
export function intentContextFor(
  reminder: SentReminder,
  now: Date,
  timeZone: string,
): IntentContext {
  const sentAt = reminder.sent_at ? Date.parse(reminder.sent_at) : NaN
  return {
    lineText: reminder.line_text ?? '',
    sentAt: Number.isFinite(sentAt) ? formatInZone(sentAt, timeZone, ' at ') : 'recently',
    nowLocal: formatInZone(now, timeZone, ' at '),
  }
}

/**
 * Carry out a "done" or "snooze" on a reminder we sent.
 *
 * The confirmation is MANDATORY and echoes what was understood: which line, and
 * — for a snooze — the resolved wall-clock time. Intent can now be AI-inferred,
 * so this echo is the safety net. A mis-read reply is visible immediately, and a
 * cross-off is one tap from being undone.
 */
export async function handleReminderAction(
  supabase: SupabaseLike,
  userId: string,
  target: SentReminder,
  action: NonNullable<ReminderAction>,
  now: Date,
  timeZone: string,
): Promise<string> {
  if (action.kind === 'snooze') {
    const { ok, fireAt } = await scheduleSnooze(supabase, userId, target, action.minutes, now)
    if (!ok) return 'Couldn’t snooze that just now — try again in a moment.'
    return buildSnoozeConfirmation({
      lineText: target.line_text,
      minutes: action.minutes,
      fireAt,
      timeZone,
    })
  }

  const result = await applyDone(supabase, target, now)
  if (!result.ok) {
    if (result.reason === 'not_found') {
      return 'That line isn’t in your tracker anymore, so there was nothing to cross off.'
    }
    return 'Couldn’t update your tracker just now — send that again in a moment.'
  }

  return buildDoneConfirmation(result.quoted, result.deepLink)
}
