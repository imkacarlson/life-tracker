// The noticing pass's cron shell.
//
// Everything this function actually does lives in _shared/librarySuggest.ts,
// which is pure enough for Vitest to drive end to end with a fake Supabase and
// a fake model. This file is only the parts that cannot be: reading env,
// checking the cron secret, building a service-role client, and wiring
// callClaude in as the model.
//
// Auth and shape copy library-rebuild/index.ts, which copies send-reminders:
// fail closed on a missing CRON_SECRET BEFORE comparing, check x-cron-secret,
// then a service-role client.
//
// NOT THE ONLY TRIGGER, and today not scheduled at all. The bot runs the same
// pass after a capture is confirmed, gated on the stored set being stale — see
// telegram-bot/index.ts. This shell exists so the pass can be run by hand
// (LIBRARY_DRY_RUN=1 first) and so a cron migration is a one-liner later.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

import { makeSuggestCall, runLibrarySuggest } from '../_shared/librarySuggest.ts'

// Mirrors REMINDER_DRY_RUN and LIBRARY_DRY_RUN's use in library-rebuild: run
// this by hand with it set and read what it WOULD write first.
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

  const summary = await runLibrarySuggest(supabase, {
    callModel: makeSuggestCall(),
    dryRun: DRY_RUN,
    // Run by hand means "I want the answer now", so the freshness gate — which
    // exists to stop a per-capture trigger being a per-capture bill — is off.
    staleAfterMs: 0,
  })

  return summary.ok ? json(summary) : json(summary, 500)
})
