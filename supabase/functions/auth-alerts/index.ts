// Sign-in alerts. Called by the notify_auth_event() trigger (see migration
// 20260924210000_add_auth_alerts.sql) whenever a session is created, a session
// changes IP, or an account is created. Emails the owner about anything from a
// device or network it hasn't seen before, then remembers it so each new
// device/network alerts exactly once.
//
// Decision + email formatting live in _shared/authAlert.ts (unit-tested).

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

import {
  type AuthEvent,
  buildAlertEmail,
  decideAlert,
  describeDevice,
  type IpInfo,
} from '../_shared/authAlert.ts'
import { OWNER_EMAIL, sendEmail } from '../_shared/resendEmail.ts'

// The Playwright E2E account. Its runner sign-ins are muted (see decideAlert).
const TEST_USER_ID = Deno.env.get('AUTH_ALERT_TEST_USER_ID') ?? ''
const USER_TIMEZONE = Deno.env.get('USER_TIMEZONE') ?? 'America/New_York'
const DASHBOARD_URL = 'https://supabase.com/dashboard/project/ogzpgnxmcifaqliuxxzu/auth/users'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** Best-effort IP lookup for the email. Never throws; null on any failure. */
async function lookupIp(ip: string | null): Promise<IpInfo | null> {
  if (!ip) return null
  try {
    const resp = await fetch(`https://ipinfo.io/${encodeURIComponent(ip)}/json`, {
      signal: AbortSignal.timeout(3000),
    })
    if (!resp.ok) return null
    const data = await resp.json()
    if (data?.bogon) return null
    return { city: data.city, region: data.region, country: data.country, org: data.org }
  } catch {
    return null
  }
}

type Supabase = ReturnType<typeof createClient>

async function isKnown(supabase: Supabase, userId: string, kind: string, value: string | null) {
  if (!value) return true // nothing to compare — don't alert on missing data alone
  const { data, error } = await supabase
    .from('auth_known_origins')
    .select('value')
    .eq('user_id', userId)
    .eq('kind', kind)
    .eq('value', value)
    .maybeSingle()
  if (error) throw error
  return data !== null
}

async function remember(supabase: Supabase, userId: string, kind: string, value: string | null) {
  if (!value) return
  const { error } = await supabase
    .from('auth_known_origins')
    .upsert(
      { user_id: userId, kind, value, last_seen: new Date().toISOString() },
      { onConflict: 'user_id,kind,value' },
    )
  if (error) throw error
}

Deno.serve(async (req) => {
  // --- Auth (mirrors check-scores) — fail closed BEFORE any comparison. ---
  const cronSecret = Deno.env.get('CRON_SECRET')
  if (!cronSecret) {
    console.error('CRON_SECRET not configured')
    return json({ error: 'Server misconfigured' }, 500)
  }
  if (req.headers.get('x-cron-secret') !== cronSecret) {
    return json({ error: 'Unauthorized' }, 401)
  }
  const resendApiKey = Deno.env.get('RESEND_API_KEY')
  if (!resendApiKey) {
    console.error('RESEND_API_KEY not configured')
    return json({ error: 'RESEND_API_KEY missing' }, 500)
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  const body = await req.json().catch(() => null)

  // One-off: mark the devices of sessions that already exist as known, so the
  // first deploy doesn't email about them. Body: { type: 'seed', sessions: [{ user_id, user_agent }] }
  if (body?.type === 'seed' && Array.isArray(body.sessions)) {
    for (const s of body.sessions) {
      await remember(supabase, s.user_id, 'device', describeDevice(s.user_agent))
    }
    return json({ seeded: body.sessions.length })
  }

  const event = body as AuthEvent | null
  if (!event?.type || !event.user_id) return json({ error: 'Bad payload' }, 400)

  try {
    const isSession = event.type !== 'user_created'
    const device = isSession ? describeDevice(event.user_agent) : ''
    const deviceKnown = isSession ? await isKnown(supabase, event.user_id, 'device', device) : true
    const networkKnown = isSession ? await isKnown(supabase, event.user_id, 'network', event.network) : true

    // Only pay for the IP lookup when an email is on the table.
    const ipInfo =
      isSession && deviceKnown && networkKnown ? null : await lookupIp(isSession ? event.ip : null)

    const decision = decideAlert({
      event,
      device,
      deviceKnown,
      networkKnown,
      isTestAccount: TEST_USER_ID !== '' && event.user_id === TEST_USER_ID,
      ipInfo,
    })

    if (decision.action === 'alert') {
      const { subject, html } = buildAlertEmail({
        event,
        reasons: decision.reasons,
        device,
        ipInfo,
        timeZone: USER_TIMEZONE,
        dashboardUrl: DASHBOARD_URL,
      })
      const result = await sendEmail(resendApiKey, OWNER_EMAIL, subject, html, 'Life Tracker Security')
      // Don't learn the device/network if the email failed — the next event retries the alert.
      if (!result.ok) {
        console.error('auth alert email failed:', result.error)
        return json({ error: 'Email failed' }, 502)
      }
    }

    if (isSession) {
      await remember(supabase, event.user_id, 'device', device)
      await remember(supabase, event.user_id, 'network', event.network)
    }

    console.log(`auth-alerts ${event.type} ${event.user_id}: ${decision.action}`,
      decision.action === 'alert' ? decision.reasons : decision.reason)
    return json({ ok: true, decision })
  } catch (err) {
    console.error('auth-alerts error:', err)
    return json({ error: String(err) }, 500)
  }
})
