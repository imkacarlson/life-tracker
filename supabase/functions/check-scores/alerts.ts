// Operational alerts about the score checker itself.
//
// These are what turn "silently broken for three weeks" into "an email within
// half an hour". They go out over Resend (unaffected by an ESPN block) and fall
// back to Telegram only if Resend itself fails — a backstop, not a second
// channel to watch.

import type { AlertKind } from '../_shared/backoff.ts'
import { escapeHtml, sendEmail } from './email.ts'

export type AlertType = AlertKind | 'stale' | 'unnotified'

export type AlertContext = {
  type: AlertType
  /** Last HTTP status from ESPN, or null when the request threw. */
  status?: number | null
  lastSuccessAt?: string | null
  /** When the breaker will try again. */
  retryAt?: string | null
  consecutiveFailures?: number
  /** For 'recovered': how many missed games were caught up on. */
  caughtUp?: number
  /** For 'stale': "Indiana Hoosiers — game 401816681 (2026-08-29T02:00Z)". */
  staleGames?: string[]
  /** For 'unnotified': "Indiana Hoosiers Football 52-16 vs North Texas (recorded 2026-09-05T21:15Z)". */
  unnotifiedGames?: string[]
}

const ALERT_FROM_NAME = 'Sports Score Monitor'

const when = (iso: string | null | undefined): string => (iso ? iso : 'unknown')

export function buildAlert(context: AlertContext): { subject: string; lines: string[] } {
  const status = context.status == null ? 'no response' : `HTTP ${context.status}`

  switch (context.type) {
    case 'blocked':
      return {
        subject: '🚨 Sports scores: ESPN checks stopped',
        lines: [
          `The score checker tripped its circuit breaker after ${context.consecutiveFailures ?? '?'} consecutive failures (${status}).`,
          `Last successful check: ${when(context.lastSuccessAt)}.`,
          `Next automatic retry: ${when(context.retryAt)}.`,
          'No further alerts will be sent while it stays blocked. Toggling Sports Score Alerts off and on in Settings clears the breaker and retries immediately.',
        ],
      }
    case 'early_warning':
      return {
        subject: '⚠️ Sports scores: ESPN check failing',
        lines: [
          `A check just failed (${status}). This is a warning, not a stoppage — the breaker has not tripped yet.`,
          `Consecutive failures: ${context.consecutiveFailures ?? 1}.`,
          `Last successful check: ${when(context.lastSuccessAt)}.`,
        ],
      }
    case 'recovered':
      return {
        subject: '✅ Sports scores: back to normal',
        lines: [
          'ESPN checks are succeeding again.',
          context.caughtUp
            ? `${context.caughtUp} missed game${context.caughtUp === 1 ? '' : 's'} caught up on this run.`
            : 'No missed games needed catching up.',
        ],
      }
    case 'stale':
      return {
        subject: '🕳️ Sports scores: results missing for finished games',
        lines: [
          'These games should have finished more than 6 hours ago and no result was ever recorded:',
          ...(context.staleGames ?? []).map((line) => `• ${line}`),
          'The requests themselves are succeeding, so this points at the response contents rather than at a block.',
        ],
      }
    case 'unnotified':
      return {
        subject: '📭 Sports scores: result recorded but never emailed',
        lines: [
          'These games were fetched and saved, but the score email never went out and retries are still failing:',
          ...(context.unnotifiedGames ?? []).map((line) => `• ${line}`),
          'ESPN is fine — the break is downstream of it, in the summary, the email send, or the worker time limit.',
        ],
      }
  }
}

const toHtml = (lines: string[]): string => lines.map((line) => escapeHtml(line)).join('<br>')

async function sendTelegram(
  token: string,
  chatId: string,
  text: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    })
    if (!resp.ok) {
      return { ok: false, error: `Telegram ${resp.status}: ${await resp.text().catch(() => '')}` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

export type AlertDeps = {
  resendApiKey: string
  recipient: string
  telegramToken?: string
  telegramChatId?: string
}

export type AlertOutcome = {
  ok: boolean
  channel: 'alert-email' | 'alert-telegram'
  subject: string
  error?: string
}

/** Send one alert, preferring email and falling back to Telegram. */
export async function sendAlert(deps: AlertDeps, context: AlertContext): Promise<AlertOutcome> {
  const { subject, lines } = buildAlert(context)

  const emailResult = await sendEmail(
    deps.resendApiKey,
    deps.recipient,
    subject,
    toHtml(lines),
    ALERT_FROM_NAME,
  )
  if (emailResult.ok) {
    return { ok: true, channel: 'alert-email', subject }
  }

  console.error('Alert email failed, falling back to Telegram:', emailResult.error)
  if (!deps.telegramToken || !deps.telegramChatId) {
    return { ok: false, channel: 'alert-email', subject, error: emailResult.error }
  }

  const telegramResult = await sendTelegram(
    deps.telegramToken,
    deps.telegramChatId,
    [subject, '', ...lines].join('\n'),
  )
  return {
    ok: telegramResult.ok,
    channel: 'alert-telegram',
    subject,
    error: telegramResult.error,
  }
}
