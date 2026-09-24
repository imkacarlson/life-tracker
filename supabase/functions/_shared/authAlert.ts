// Pure decision + formatting logic for the auth-alerts edge function.
// No Deno, no network — see the _shared house rule in AGENTS.md.

export type AuthEvent =
  | {
      type: 'session_created' | 'session_ip_changed'
      user_id: string
      email: string | null
      session_id: string
      ip: string | null
      previous_ip?: string | null
      network: string | null
      user_agent: string | null
      at: string
    }
  | { type: 'user_created'; user_id: string; email: string | null; at: string }

export type IpInfo = {
  city?: string
  region?: string
  country?: string
  org?: string
}

/**
 * Coarse, version-free device label, e.g. "Chrome on Windows". Versions are
 * dropped on purpose: browsers auto-update, and "Chrome 152 -> 153" must not
 * look like a new device.
 */
export function describeDevice(userAgent: string | null | undefined): string {
  const ua = userAgent ?? ''
  if (!ua.trim()) return 'Unknown client'
  if (/^(node|undici|deno|supabase)/i.test(ua)) return 'Script (no browser)'

  let browser = 'Unknown browser'
  if (/HeadlessChrome\//.test(ua)) browser = 'Headless Chrome'
  else if (/\bClaude\//.test(ua)) browser = 'Claude app'
  else if (/\bEdg(A|iOS)?\//.test(ua)) browser = 'Edge'
  else if (/\bFirefox\/|\bFxiOS\//.test(ua)) browser = 'Firefox'
  else if (/\bCriOS\/|\bChrome\//.test(ua)) browser = 'Chrome'
  else if (/\bSafari\//.test(ua)) browser = 'Safari'

  let os = 'unknown OS'
  if (/Android/.test(ua)) os = 'Android'
  else if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS'
  else if (/Windows/.test(ua)) os = 'Windows'
  else if (/CrOS/.test(ua)) os = 'ChromeOS'
  else if (/Mac OS X|Macintosh/.test(ua)) os = 'macOS'
  else if (/Linux/.test(ua)) os = 'Linux'

  return `${browser} on ${os}`
}

/**
 * True for the user agents Playwright and the E2E helpers produce: headless
 * Chrome (Desktop Chrome project), the emulated "Pixel 7" (Mobile Chrome
 * project — real Android Chrome reports a reduced "Android 10; K" UA instead),
 * and Node-side supabase-js sign-ins from e2e/test-helpers.js.
 */
export function isAutomatedClient(userAgent: string | null | undefined): boolean {
  const ua = userAgent ?? ''
  if (!ua.trim()) return true
  return /HeadlessChrome\/|Pixel 7\b|^(node|undici|deno)/i.test(ua)
}

/** GitHub-hosted Actions runners live in Azure. */
export function isGithubRunnerNetwork(info: IpInfo | null): boolean {
  return /microsoft/i.test(info?.org ?? '')
}

export type Decision =
  | { action: 'alert'; reasons: string[] }
  | { action: 'quiet'; reason: string }

/**
 * Decide whether an event is worth an email.
 *
 * - New account: always. This is single-user; sign-ups should be disabled.
 * - New session: alert if the device OR the network is unfamiliar.
 * - Session IP change: alert only if the network is unfamiliar (same session,
 *   so the device can't meaningfully change — but a stolen token would show
 *   up here from the thief's network).
 * - The E2E test account is muted only when it looks like the test runner:
 *   automated UA AND (GitHub runner network OR a network already known).
 *   Anything else on that account still alerts.
 */
export function decideAlert(args: {
  event: AuthEvent
  device: string
  deviceKnown: boolean
  networkKnown: boolean
  isTestAccount: boolean
  ipInfo: IpInfo | null
}): Decision {
  const { event, device, deviceKnown, networkKnown, isTestAccount, ipInfo } = args
  if (event.type === 'user_created') {
    return { action: 'alert', reasons: ['A new account was created'] }
  }

  const reasons: string[] = []
  if (event.type === 'session_created' && !deviceKnown) {
    reasons.push(`New device: ${device}`)
  }
  if (!networkKnown) {
    reasons.push(
      event.type === 'session_ip_changed'
        ? 'An existing session is now being used from a new network'
        : 'New network',
    )
  }
  if (reasons.length === 0) return { action: 'quiet', reason: 'known device and network' }

  if (
    isTestAccount &&
    isAutomatedClient(event.user_agent) &&
    (networkKnown || isGithubRunnerNetwork(ipInfo))
  ) {
    return { action: 'quiet', reason: 'E2E test runner' }
  }

  return { action: 'alert', reasons }
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function formatLocation(info: IpInfo | null): string {
  if (!info) return 'Unknown location'
  const place = [info.city, info.region, info.country].filter(Boolean).join(', ')
  return place || 'Unknown location'
}

export function formatWhen(iso: string, timeZone: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('en-US', {
    timeZone,
    // dateStyle/timeStyle can't be combined with timeZoneName, hence the long form.
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  })
}

export function buildAlertEmail(args: {
  event: AuthEvent
  reasons: string[]
  device: string
  ipInfo: IpInfo | null
  timeZone: string
  dashboardUrl: string
}): { subject: string; html: string } {
  const { event, reasons, device, ipInfo, timeZone, dashboardUrl } = args
  const account = event.email ?? event.user_id
  const when = formatWhen(event.at, timeZone)

  const subject =
    event.type === 'user_created'
      ? `Life Tracker: new account created (${account})`
      : event.type === 'session_ip_changed'
        ? `Life Tracker: session used from a new network (${account})`
        : `Life Tracker: new sign-in (${account})`

  const rows: [string, string][] = [
    ['Account', account],
    ['When', when],
  ]
  if (event.type !== 'user_created') {
    rows.push(['Device', device])
    rows.push(['IP', event.ip ?? 'unknown'])
    if (event.type === 'session_ip_changed' && event.previous_ip) {
      rows.push(['Previous IP', event.previous_ip])
    }
    rows.push(['Location', formatLocation(ipInfo)])
    if (ipInfo?.org) rows.push(['Network owner', ipInfo.org])
    rows.push(['User agent', event.user_agent ?? 'unknown'])
    rows.push(['Session ID', event.session_id])
  } else {
    rows.push(['User ID', event.user_id])
  }

  const table = rows
    .map(([k, v]) => `<tr><td style="padding:2px 12px 2px 0;color:#666">${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`)
    .join('')

  const advice =
    event.type === 'user_created'
      ? 'This app is single-user, so this should never happen. If you did not create it, delete the account and make sure sign-ups are disabled.'
      : 'If this was you, no action is needed — you will not be alerted about this device/network again. If it was NOT you, sign the account out everywhere and change your password.'

  const html = `<p><b>${reasons.map(escapeHtml).join('<br>')}</b></p>
<table style="font-size:14px">${table}</table>
<p>${escapeHtml(advice)}</p>
<p><a href="${escapeHtml(dashboardUrl)}">Open Supabase Auth users</a></p>`

  return { subject, html }
}
