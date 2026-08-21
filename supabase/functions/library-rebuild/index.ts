// The Library rebuild's cron shell.
//
// Everything this function actually does lives in _shared/libraryRebuild.ts,
// which is pure enough for Vitest to import directly. This file is only the
// parts that cannot be: reading env, checking the cron secret, building a
// service-role client, and shaping the HTTP response.
//
// Auth and shape copy send-reminders/index.ts: fail closed on a missing
// CRON_SECRET BEFORE comparing, check x-cron-secret, then a service-role client.
//
// NOTE: this is the safety net, not the only trigger. The bot runs the same
// rebuild scoped to one section immediately after a capture is confirmed, which
// is what makes a save show up in the app straight away. See
// telegram-bot/index.ts.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

import { runLibraryRebuild } from '../_shared/libraryRebuild.ts'

const USER_TIMEZONE = Deno.env.get('USER_TIMEZONE') ?? 'America/New_York'
// Matches REMINDER_DRY_RUN. Run this by hand with LIBRARY_DRY_RUN=1 and read the
// output before anything is ever scheduled.
const DRY_RUN = Deno.env.get('LIBRARY_DRY_RUN') === '1'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

Deno.serve(async (req) => {
  const cronSecret = Deno.env.get('CRON_SECRET')
  if (!cronSecret) {
    console.error('CRON_SECRET not configured')
    return json({ error: 'Server misconfigured' }, 500)
  }
  if (req.headers.get('x-cron-secret') !== cronSecret) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  const { summary, log } = await runLibraryRebuild(supabase, {
    timeZone: USER_TIMEZONE,
    dryRun: DRY_RUN,
  })

  if (!summary.ok) return json(summary, 500)
  // In a dry run the log is the whole point of the exercise — it is what gets
  // read before the cron migration is ever applied. prev_content is stripped:
  // it is the revert payload, not something to page through.
  return json({
    ...summary,
    log: DRY_RUN ? log.map(({ prev_content: _p, ...rest }) => rest) : undefined,
  })
})
