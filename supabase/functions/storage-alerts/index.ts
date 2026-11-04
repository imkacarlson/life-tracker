// Daily storage check (pg_cron, see 20261104180100_add_storage_alerts.sql).
//
// Nothing in the activity log, page history or session recordings is purged,
// so this records today's database and file-storage size and emails the owner
// the first time each resource crosses 50 / 70 / 85 / 95% of its limit.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

import { OWNER_EMAIL, sendEmail } from '../_shared/resendEmail.ts'
import {
  dailyGrowth,
  decideStorageAlert,
  formatBytes,
  weeksUntilFull,
} from '../_shared/storageAlert.ts'
import type { Resource, Sample } from '../_shared/storageAlert.ts'

// Supabase free-tier limits. Override with env vars after upgrading a plan.
const DB_LIMIT_BYTES = Number(Deno.env.get('DB_LIMIT_BYTES') ?? 500 * 1024 ** 2)
const STORAGE_LIMIT_BYTES = Number(Deno.env.get('STORAGE_LIMIT_BYTES') ?? 1024 ** 3)
// Growth is averaged over this many days of samples.
const GROWTH_WINDOW_DAYS = 30

const LABELS: Record<Resource, string> = {
  database: 'Database',
  file_storage: 'File storage',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function buildEmail(
  resource: Resource,
  level: number,
  used: number,
  limit: number,
  perDay: number | null,
): { subject: string; html: string } {
  const percent = ((used / limit) * 100).toFixed(1)
  const weeks = weeksUntilFull(used, limit, perDay)
  const pace =
    perDay === null
      ? 'Not enough history yet to estimate how fast it is growing.'
      : perDay <= 0
        ? 'It is not growing right now.'
        : `It is growing about ${formatBytes(perDay * 7)} a week, so it would be full in roughly ${Math.round(weeks ?? 0)} weeks.`
  const advice =
    level >= 85
      ? 'Time to act: move older session recordings to cheaper storage (e.g. Cloudflare R2) or upgrade the Supabase plan.'
      : 'No action needed yet. This is an early heads-up.'

  return {
    subject: `Life Tracker: ${LABELS[resource].toLowerCase()} is ${level}% full`,
    html:
      `<p><strong>${LABELS[resource]}</strong> is at <strong>${percent}%</strong> ` +
      `(${formatBytes(used)} of ${formatBytes(limit)}).</p>` +
      `<p>${pace}</p><p>${advice}</p>`,
  }
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

  try {
    const { data: usageRows, error: usageError } = await supabase.rpc('storage_usage')
    if (usageError || !usageRows?.[0]) throw new Error(usageError?.message ?? 'no usage row')
    const dbBytes = Number(usageRows[0].db_bytes)
    const storageBytes = Number(usageRows[0].storage_bytes)

    const today = new Date().toISOString().slice(0, 10)
    await supabase
      .from('storage_usage_samples')
      .upsert({ sampled_on: today, db_bytes: dbBytes, storage_bytes: storageBytes })

    const since = new Date(Date.now() - GROWTH_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10)
    const { data: samples } = await supabase
      .from('storage_usage_samples')
      .select('sampled_on, db_bytes, storage_bytes')
      .gte('sampled_on', since)
    const history = (samples ?? []) as Sample[]

    const { data: sentRows } = await supabase
      .from('storage_alerts_sent')
      .select('resource, threshold')

    const resources: { resource: Resource; used: number; limit: number; key: 'db_bytes' | 'storage_bytes' }[] = [
      { resource: 'database', used: dbBytes, limit: DB_LIMIT_BYTES, key: 'db_bytes' },
      { resource: 'file_storage', used: storageBytes, limit: STORAGE_LIMIT_BYTES, key: 'storage_bytes' },
    ]

    const summary: Record<string, unknown> = { dbBytes, storageBytes, emailed: [] as string[] }

    for (const { resource, used, limit, key } of resources) {
      const percent = (used / limit) * 100
      const alreadySent = (sentRows ?? [])
        .filter((row) => row.resource === resource)
        .map((row) => Number(row.threshold))
      const { alertAt, rearm } = decideStorageAlert(percent, alreadySent)

      if (rearm.length) {
        await supabase
          .from('storage_alerts_sent')
          .delete()
          .eq('resource', resource)
          .in('threshold', rearm)
      }

      if (alertAt !== null) {
        const { subject, html } = buildEmail(resource, alertAt, used, limit, dailyGrowth(history, key))
        const result = await sendEmail(resendApiKey, OWNER_EMAIL, subject, html, 'Life Tracker')
        // Only remember the level when the email went out, so a failure retries tomorrow.
        if (result.ok) {
          await supabase.from('storage_alerts_sent').upsert({ resource, threshold: alertAt })
          ;(summary.emailed as string[]).push(`${resource}@${alertAt}`)
        } else {
          console.error('storage alert email failed:', result.error)
        }
      }
    }

    return json(summary)
  } catch (err) {
    console.error('storage-alerts error:', String(err))
    return json({ error: 'Check failed' }, 500)
  }
})
