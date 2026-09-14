import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'

import {
  HEALTHY,
  type HealthSnapshot,
  applyFailure,
  applySuccess,
  classifyFailure,
  isBackedOff,
  parseRetryAfter,
} from '../_shared/backoff.ts'
import { findStaleGames, nextPollDelayMinutes } from '../_shared/pollSchedule.ts'
import { decideScoresRun } from '../_shared/scoresEnabled.ts'
import { type AlertContext, sendAlert } from './alerts.ts'
import {
  EMAIL_RECIPIENT,
  buildEmailHtml,
  buildEmailSubject,
  fromNameForTeam,
  sendEmail,
} from './email.ts'
import {
  EspnFetchError,
  type GameResult,
  type Team,
  createScoreboardCache,
  fetchTeamGames,
} from './espn.ts'
import { decideNotifyAction, decideSendAction } from './notifyState.ts'
import { type GeminiAttempt, generateSummary } from './summary.ts'

const HEALTH_ID = 'espn'
const RETENTION_DAYS = 7

/**
 * Diagnostics live longer than the games they describe.
 *
 * Summary failures arrive roughly once or twice a week, so the 7-day window
 * above would usually hold a single one — and a single failure is what produced
 * two wrong root causes already. 30 days keeps enough of them side by side to
 * compare. Growth is bounded and trivial: 1-3 rows per completed game, so ~10-20
 * rows a week, purged by age on every run.
 */
const DIAGNOSTICS_RETENTION_DAYS = 30

/**
 * Total time all Gemini summaries may consume in ONE run, across every game.
 *
 * The edge worker is killed at 150s. A per-attempt timeout alone is not enough:
 * two games finishing in the same tick would each get their own ladder and
 * together could still blow the budget. This is the whole-run ceiling.
 *
 * Sized against measured runs, not guesswork: ticks with nothing to notify take
 * 23-30s, so ESPN + the DB writes + the emails cost ~30s, and 30 + 90 leaves
 * ~30s of margin under the worker limit.
 */
const SUMMARY_RUN_BUDGET_MS = 90_000

/**
 * Most one game's summary may consume, so the FIRST game cannot eat the whole
 * run budget and starve the rest.
 *
 * Without this the run budget alone was actively unfair: game 1 spending it all
 * left game 2 a sliver, and `Math.min(attemptCap, left)` then capped game 2
 * TIGHTER than game 1 — a second game in the same tick was structurally certain
 * to miss its summary. Two fully-timed-out games now cost 90s, not an unbounded
 * ladder, and any game after that degrades to a score-only email.
 */
const SUMMARY_GAME_BUDGET_MS = 50_000

/**
 * How long a game may wait for its AI summary before the email goes out anyway.
 *
 * The summary used to get exactly one attempt, in the ~60s before the email was
 * sent, and gemini-2.5-flash hangs often enough (googleapis/python-genai#1893:
 * sockets stall instead of returning 503) that the attempt usually missed. Once
 * the email was out, the blurb was lost for that game forever.
 *
 * Holding briefly buys a second attempt minutes later, which is the spacing an
 * intermittent upstream actually responds to. The ceiling is deliberately short:
 * the score is the product, the blurb is garnish, and a late score is worse than
 * a plain one.
 */
const SUMMARY_HOLD_MINUTES = 5

/** Most held games to finish per run, so a backlog cannot blow the worker. */
const PENDING_BATCH_LIMIT = 5

/** Alert if a result sits recorded-but-unemailed for longer than this. */
const UNNOTIFIED_ALERT_HOURS = 2

// Team seed data — inserted on first run if sport_teams is empty.
const SEED_TEAMS = [
  { name: 'nationals', display_name: 'Washington Nationals', sport: 'baseball', league: 'mlb', espn_team_id: '20', emoji_win: '⚾🏆', emoji_loss: '⚾❌', emoji_tie: '⚾🤝' },
  { name: 'pacers', display_name: 'Indiana Pacers', sport: 'basketball', league: 'nba', espn_team_id: '11', emoji_win: '🏀🏆', emoji_loss: '🏀❌', emoji_tie: '🏀🤝' },
  { name: 'capitals', display_name: 'Washington Capitals', sport: 'hockey', league: 'nhl', espn_team_id: '23', emoji_win: '🏒🏆', emoji_loss: '🏒❌', emoji_tie: '🏒🤝' },
  { name: 'commanders', display_name: 'Washington Commanders', sport: 'football', league: 'nfl', espn_team_id: '28', emoji_win: '🏈🏆', emoji_loss: '🏈❌', emoji_tie: '🏈🤝' },
  { name: 'colts', display_name: 'Indianapolis Colts', sport: 'football', league: 'nfl', espn_team_id: '11', emoji_win: '🏈🏆', emoji_loss: '🏈❌', emoji_tie: '🏈🤝' },
  { name: 'iu_football', display_name: 'Indiana Hoosiers Football', sport: 'football', league: 'college-football', espn_team_id: '84', emoji_win: '🏈🏆', emoji_loss: '🏈❌', emoji_tie: '🏈🤝' },
  { name: 'iu_basketball', display_name: 'Indiana Hoosiers Basketball', sport: 'basketball', league: 'mens-college-basketball', espn_team_id: '84', emoji_win: '🏀🏆', emoji_loss: '🏀❌', emoji_tie: '🏀🤝' },
  { name: 'iu_womens_basketball', display_name: 'Indiana Hoosiers Women\'s Basketball', sport: 'basketball', league: 'womens-college-basketball', espn_team_id: '84', emoji_win: '🏀🏆', emoji_loss: '🏀❌', emoji_tie: '🏀🤝' },
  { name: 'spirit', display_name: 'Washington Spirit', sport: 'soccer', league: 'usa.nwsl', espn_team_id: '15365', emoji_win: '⚽🏆', emoji_loss: '⚽❌', emoji_tie: '⚽🤝' },
]

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

// --- Health record ---

type HealthRow = HealthSnapshot & {
  last_status: number | null
  last_success_at: string | null
  last_seen_enabled: boolean
}

const DEFAULT_HEALTH: HealthRow = {
  ...HEALTHY,
  last_status: null,
  last_success_at: null,
  last_seen_enabled: true,
}

async function loadHealth(supabase: SupabaseClient): Promise<HealthRow> {
  const { data, error } = await supabase
    .from('sports_check_health')
    .select('state, consecutive_failures, backoff_level, backoff_until, last_status, last_success_at, last_seen_enabled')
    .eq('id', HEALTH_ID)
    .maybeSingle()

  if (error || !data) {
    if (error) console.error('Failed to read sports_check_health:', error)
    return { ...DEFAULT_HEALTH }
  }
  return data as HealthRow
}

async function saveHealth(supabase: SupabaseClient, patch: Partial<HealthRow>): Promise<void> {
  const { error } = await supabase
    .from('sports_check_health')
    .upsert({ id: HEALTH_ID, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'id' })
  if (error) console.error('Failed to write sports_check_health:', error)
}

// --- Main Handler ---

Deno.serve(async (req) => {
  const now = new Date()

  // 1. Cron secret. The Settings toggle is NOT an auth control, so this stays first.
  const cronSecret = Deno.env.get('CRON_SECRET')
  if (!cronSecret) {
    console.error('CRON_SECRET not configured')
    return json({ error: 'Server misconfigured' }, 500)
  }
  if (req.headers.get('x-cron-secret') !== cronSecret) {
    return json({ error: 'Unauthorized' }, 401)
  }

  // 2. Service-role client (bypasses RLS). Created before the API-key guards so
  //    that a disabled system with a rotated key stays quiet instead of emitting
  //    a 500 every 15 minutes.
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  // 3. The Settings toggle. `.limit(1)` is load-bearing: without it maybeSingle()
  //    errors (PGRST116) on 2+ rows, which would silently disable scoring forever.
  const { data: settingsRow, error: settingsError } = await supabase
    .from('settings')
    .select('sports_scores_enabled')
    .limit(1)
    .maybeSingle()

  const decision = decideScoresRun(settingsRow, settingsError)
  const health = await loadHealth(supabase)

  if (!decision.run) {
    if (decision.reason === 'settings_unavailable') {
      console.error('Could not read settings; skipping this run:', settingsError)
    } else if (health.last_seen_enabled) {
      // The one write we allow while dormant, and only on the transition. It is
      // what makes an off→on flip in Settings clear a tripped breaker below.
      await saveHealth(supabase, { last_seen_enabled: false })
    }
    return json({ ok: true, skipped: decision.reason })
  }

  // A manual off→on flip means "try again now": clear any tripped breaker.
  let currentHealth: HealthRow = health
  if (!health.last_seen_enabled) {
    currentHealth = { ...DEFAULT_HEALTH, last_success_at: health.last_success_at }
    await saveHealth(supabase, { ...HEALTHY, last_seen_enabled: true })
    console.log('Sports score alerts re-enabled — circuit breaker cleared')
  }

  // 4. API keys.
  const googleApiKey = Deno.env.get('GEMINI_SCORES_API_KEY')
  const resendApiKey = Deno.env.get('RESEND_API_KEY')
  if (!resendApiKey) {
    console.error('RESEND_API_KEY not configured')
    return json({ error: 'RESEND_API_KEY missing' }, 500)
  }

  const alertDeps = {
    resendApiKey,
    recipient: EMAIL_RECIPIENT,
    telegramToken: Deno.env.get('TELEGRAM_BOT_TOKEN') ?? undefined,
    telegramChatId: Deno.env.get('TELEGRAM_ALLOWED_USER_ID') ?? undefined,
  }

  const logAlert = async (context: AlertContext) => {
    const outcome = await sendAlert(alertDeps, context)
    await supabase.from('notification_log').insert({
      score_history_id: null,
      channel: outcome.channel,
      recipient: EMAIL_RECIPIENT,
      subject: outcome.subject,
      status: outcome.ok ? 'sent' : 'failed',
      error_message: outcome.error ?? null,
    })
    await saveHealth(supabase, { last_alert_at: new Date().toISOString() })
  }

  // Whole-run ceiling, shared by the pending pass and the team loop. Each game
  // carves a bounded slice out of this rather than helping itself — see
  // SUMMARY_GAME_BUDGET_MS.
  const runStartedAtMs = Date.now()
  const notifyKeys = {
    resendApiKey,
    googleApiKey,
    summaryRunDeadline: runStartedAtMs + SUMMARY_RUN_BUDGET_MS,
    runStartedAtMs,
    // Ties every gemini_call_log row from this tick together.
    runId: crypto.randomUUID().slice(0, 8),
  }

  // 5. Retention cleanup. Deliberately after the enabled check — "dormant" means
  //    no writes either. The backlog is bounded (nothing new is created while
  //    off) and purges on the first run after re-enabling, because cleanup
  //    deletes by age rather than incrementally.
  const cutoffIso = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()
  await supabase.from('notification_log').delete().lt('created_at', cutoffIso)
  await supabase.from('score_history').delete().lt('created_at', cutoffIso)
  await supabase.from('sports_expected_games').delete().lt('created_at', cutoffIso)

  const diagnosticsCutoffIso = new Date(
    now.getTime() - DIAGNOSTICS_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString()
  await supabase.from('gemini_call_log').delete().lt('created_at', diagnosticsCutoffIso)

  // 6. Seed teams on first run.
  const { count } = await supabase
    .from('sport_teams')
    .select('*', { count: 'exact', head: true })

  if (count === 0) {
    const { data: users } = await supabase.auth.admin.listUsers()
    const userId = users?.users?.[0]?.id
    if (!userId) return json({ error: 'No user found for seeding' }, 500)

    const { error: seedError } = await supabase
      .from('sport_teams')
      .insert(SEED_TEAMS.map((t) => ({ ...t, user_id: userId })))
    if (seedError) {
      console.error('Seed error:', seedError)
      return json({ error: 'Failed to seed teams' }, 500)
    }
    console.log('Seeded sport_teams with', SEED_TEAMS.length, 'teams')
  }

  // 6b. Finish games we recorded but held back for another summary attempt.
  //
  //     Before the backoff check deliberately: a held email needs nothing from
  //     ESPN, so it must still go out while ESPN is in a backoff window.
  //
  //     This cannot be folded into the team loop below. `nextPollDelayMinutes`
  //     returns MAX_POLL_MINUTES once a team has no live or upcoming games —
  //     exactly the state right after an evening game — so a team that just
  //     played sleeps ~24h and a held email would wait a day. The retry has to
  //     be independent of polling, and it can be: score_history carries every
  //     field the email needs.
  const pending = await flushPendingGames(supabase, notifyKeys)
  if (pending.sent > 0 || pending.held > 0) {
    console.log(`pending games: ${pending.sent} sent, ${pending.held} still held`)
  }

  // 7. Respect an active backoff window.
  if (isBackedOff(currentHealth, now)) {
    return json({ ok: true, skipped: 'backoff', retryAt: currentHealth.backoff_until })
  }

  // 8. Only teams that are actually due. `next_poll_at` null means "ask now".
  const { data: teams, error: teamsError } = await supabase
    .from('sport_teams')
    .select('*')
    .eq('active', true)

  if (teamsError || !teams) {
    console.error('Failed to load teams:', teamsError)
    return json({ error: 'Failed to load teams' }, 500)
  }

  const dueTeams = (teams as Team[]).filter(
    (team) => !team.next_poll_at || Date.parse(team.next_poll_at) <= now.getTime(),
  )

  // 9. Check each due team. ONE attempt per tick: the first failed request ends
  //    the loop rather than retrying, so a block never becomes a retry storm.
  const cache = createScoreboardCache()
  const results: Array<{ team: string; gamesFound: number; notified: number; errors: string[] }> = []
  let fetchError: EspnFetchError | null = null

  for (const team of dueTeams) {
    const teamResult = { team: team.display_name, gamesFound: 0, notified: 0, errors: [] as string[] }

    let games
    try {
      games = await fetchTeamGames(team, now, cache)
    } catch (err) {
      if (err instanceof EspnFetchError) {
        fetchError = err
        console.error(`ESPN fetch failed for ${team.display_name}: ${err.message}`)
        break
      }
      throw err
    }

    teamResult.gamesFound = games.completed.length

    // Remember every game we know about, so the stale check can notice one that
    // never produced a result even when the response itself looks fine.
    const expectedRows = games.all
      .filter((game) => !game.completed)
      .map((game) => ({
        team_id: team.id,
        espn_game_id: game.id,
        start_time: game.startTime,
      }))
    if (expectedRows.length > 0) {
      await supabase
        .from('sports_expected_games')
        .upsert(expectedRows, { onConflict: 'team_id,espn_game_id' })
    }

    for (const game of games.completed) {
      const notified = await recordAndNotify(supabase, team, game, notifyKeys)
      if (notified.skipped) continue
      if (notified.ok) teamResult.notified++
      if (notified.error) teamResult.errors.push(notified.error)
    }

    // A recorded result retires the expectation.
    const settledIds = games.all.filter((game) => game.completed).map((game) => game.id)
    if (settledIds.length > 0) {
      await supabase
        .from('sports_expected_games')
        .delete()
        .eq('team_id', team.id)
        .in('espn_game_id', settledIds)
    }

    const delayMinutes = nextPollDelayMinutes(games.all, team.league, now)
    await supabase
      .from('sport_teams')
      .update({ next_poll_at: new Date(now.getTime() + delayMinutes * 60_000).toISOString() })
      .eq('id', team.id)

    results.push(teamResult)
  }

  const totalNotified = results.reduce((sum, r) => sum + r.notified, 0)

  // 10. Fold the outcome into the breaker and alert on state changes only.
  if (fetchError) {
    const kind = classifyFailure(fetchError.status)
    const transition = applyFailure(currentHealth, {
      kind,
      now,
      retryAfterSeconds: parseRetryAfter(fetchError.retryAfter, now),
    })
    await saveHealth(supabase, { ...transition.next, last_status: fetchError.status })

    if (transition.alert) {
      await logAlert({
        type: transition.alert,
        status: fetchError.status,
        lastSuccessAt: currentHealth.last_success_at,
        retryAt: transition.next.backoff_until,
        consecutiveFailures: transition.next.consecutive_failures,
      })
    }

    return json({
      ok: false,
      error: fetchError.message,
      state: transition.next.state,
      results,
    }, 200)
  }

  if (dueTeams.length > 0) {
    const transition = applySuccess(currentHealth)
    await saveHealth(supabase, {
      ...transition.next,
      last_status: 200,
      last_success_at: now.toISOString(),
    })
    if (transition.alert) {
      await logAlert({ type: transition.alert, caughtUp: totalNotified })
    }
  }

  // 11. Stale-data check across ALL teams — the alert that would have caught
  //     the 2026-08-05 outage, since it fires on a clean 200 with no results.
  await checkForStaleGames(supabase, teams as Team[], now, logAlert)

  // 12. The gap the stale check cannot see: a game we DID record and DID NOT
  //     email. findStaleGames excludes anything present in score_history, so on
  //     2026-09-05 it saw nothing wrong while the Indiana result sat unsent.
  await checkForUnnotifiedGames(supabase, teams as Team[], now, logAlert)

  console.log(`check-scores complete: ${totalNotified} notifications sent, ${dueTeams.length}/${teams.length} teams checked`)

  return json({ ok: true, teamsChecked: dueTeams.length, results })
})

// --- Helpers ---

type NotifyOutcome = {
  ok: boolean
  skipped: boolean
  /** Recorded, summary still missing, email intentionally held for a retry. */
  deferred?: boolean
  error?: string
}

type NotifyKeys = {
  resendApiKey: string
  googleApiKey: string | undefined
  summaryRunDeadline: number
  runStartedAtMs: number
  runId: string
}

/**
 * Insert the result, then email it. The unique constraint dedupes the ROW; the
 * `notified_at` timestamp dedupes the EMAIL.
 *
 * Those are deliberately two different facts. The insert commits seconds-to-
 * minutes before the email is sent, and a worker killed in that window used to
 * leave a row that every later run read as "already notified" — which is exactly
 * how the 2026-09-05 Indiana result was recorded and never sent. Now a duplicate
 * insert with no `notified_at` means "finish the job", not "nothing to do".
 */
async function recordAndNotify(
  supabase: SupabaseClient,
  team: Team,
  game: GameResult,
  keys: NotifyKeys,
): Promise<NotifyOutcome> {
  const { data: inserted, error: insertError } = await supabase
    .from('score_history')
    .insert({
      team_id: team.id,
      espn_game_id: game.espnGameId,
      game_date: game.gameDate,
      team_score: game.teamScore,
      opponent_name: game.opponentName,
      opponent_score: game.opponentScore,
      result: game.result,
      home_away: game.homeAway,
      raw_espn_data: game.rawData,
    })
    .select('id, created_at')
    .single()

  let scoreHistoryId: string
  let aiSummary: string | null = null
  /** When the RESULT was recorded — the clock the hold window runs on. */
  let recordedAtMs: number

  if (insertError) {
    // 23505 = unique_violation: we have seen this game before. Whether we
    // EMAILED it is a separate question, answered by notified_at.
    if (insertError.code !== '23505') {
      return { ok: false, skipped: false, error: `Insert error: ${insertError.message}` }
    }

    const { data: existing, error: readError } = await supabase
      .from('score_history')
      .select('id, notified_at, ai_summary, created_at')
      .eq('team_id', team.id)
      .eq('espn_game_id', game.espnGameId)
      .maybeSingle()

    if (readError) {
      return { ok: false, skipped: false, error: `Dedupe read error: ${readError.message}` }
    }

    const decision = decideNotifyAction(existing)
    if (decision.action === 'skip') return { ok: false, skipped: true }

    console.log(`Retrying unsent notification for ${team.display_name} game ${game.espnGameId}`)
    scoreHistoryId = decision.scoreHistoryId
    aiSummary = decision.reuseSummary
    recordedAtMs = Date.parse(existing?.created_at ?? '') || Date.now()
  } else {
    scoreHistoryId = inserted.id
    recordedAtMs = Date.parse(inserted.created_at ?? '') || Date.now()
  }

  return finishGame(supabase, team, game, {
    scoreHistoryId,
    existingSummary: aiSummary,
    recordedAtMs,
  }, keys)
}

/**
 * Attempt the summary, then either email the result or hold it for another go.
 *
 * Shared deliberately by the fresh path above and the pending pass below: both
 * must make the IDENTICAL send-or-hold decision, and two copies of that rule
 * would drift apart.
 */
async function finishGame(
  supabase: SupabaseClient,
  team: Team,
  game: GameResult,
  row: { scoreHistoryId: string; existingSummary: string | null; recordedAtMs: number },
  keys: NotifyKeys,
): Promise<NotifyOutcome> {
  const scoreHistoryId = row.scoreHistoryId
  let aiSummary = row.existingSummary

  // AI summary is non-blocking — a failure, a timeout, or an exhausted run
  // budget all just mean a score-only email. Skipped entirely when a previous
  // attempt already produced one.
  if (keys.googleApiKey && !aiSummary) {
    // This game's slice, clamped to whatever the run has left — so the run
    // ceiling always wins over the per-game allowance.
    const gameDeadline = Math.min(
      Date.now() + SUMMARY_GAME_BUDGET_MS,
      keys.summaryRunDeadline,
    )

    const attempts: GeminiAttempt[] = []
    const secsIntoRun = Math.round((Date.now() - keys.runStartedAtMs) / 100) / 10

    aiSummary = await generateSummary(
      team,
      keys.googleApiKey,
      gameDeadline,
      (a) => attempts.push(a),
    )

    if (aiSummary) {
      await supabase.from('score_history').update({ ai_summary: aiSummary }).eq('id', scoreHistoryId)
    }

    // Instrumentation must never cost us the email, so this is best-effort and
    // swallows its own errors — including the case where the migration has not
    // been applied yet.
    if (attempts.length > 0) {
      const { error: logError } = await supabase.from('gemini_call_log').insert(
        attempts.map((a) => ({
          score_history_id: scoreHistoryId,
          team_name: team.display_name,
          run_id: keys.runId,
          attempt: a.attempt,
          grounded: a.grounded,
          outcome: a.outcome,
          status_code: a.statusCode,
          headers_ms: a.headersMs,
          total_ms: a.totalMs,
          secs_into_run: secsIntoRun,
          error_name: a.errorName,
          error_detail: a.errorDetail,
        })),
      )
      if (logError) console.error('Failed to write gemini_call_log:', logError.message)
    }
  }

  // Send, or hold this game for one more attempt on a later run? The decision
  // lives in notifyState.ts so it can be unit tested; it is keyed on the row's
  // AGE, so even if the pending pass breaks entirely the next run sends anyway.
  if (
    decideSendAction({
      hasSummary: Boolean(aiSummary),
      ageMs: Date.now() - row.recordedAtMs,
      holdMs: SUMMARY_HOLD_MINUTES * 60_000,
    }) === 'hold'
  ) {
    console.log(
      `Holding ${team.display_name} game ${game.espnGameId} for another summary attempt ` +
      `(up to ${SUMMARY_HOLD_MINUTES}m); notified_at stays null`,
    )
    return { ok: false, skipped: false, deferred: true }
  }

  const subject = buildEmailSubject(team, game)
  const emailResult = await sendEmail(
    keys.resendApiKey,
    EMAIL_RECIPIENT,
    subject,
    buildEmailHtml(team, game, aiSummary),
    fromNameForTeam(team),
  )

  await supabase.from('notification_log').insert({
    score_history_id: scoreHistoryId,
    channel: 'email',
    recipient: EMAIL_RECIPIENT,
    subject,
    status: emailResult.ok ? 'sent' : 'failed',
    error_message: emailResult.error ?? null,
  })

  // ONLY a confirmed send closes the game out. A failure leaves notified_at null
  // so the next tick retries rather than declaring victory.
  if (emailResult.ok) {
    await supabase
      .from('score_history')
      .update({ notified_at: new Date().toISOString() })
      .eq('id', scoreHistoryId)
  }

  return {
    ok: emailResult.ok,
    skipped: false,
    error: emailResult.ok ? undefined : `Email failed: ${emailResult.error}`,
  }
}

/**
 * Finish games that were recorded but held back, without touching ESPN.
 *
 * GameResult maps 1:1 onto score_history's columns, so a held game can be
 * emailed from the row alone. The query rides the partial index added with
 * `notified_at` (score_history_unnotified_idx: created_at WHERE notified_at IS
 * NULL), so this costs essentially nothing on the overwhelming majority of runs
 * where there is nothing pending.
 */
async function flushPendingGames(
  supabase: SupabaseClient,
  keys: NotifyKeys,
): Promise<{ sent: number; held: number }> {
  const { data: pending, error } = await supabase
    .from('score_history')
    .select(
      'id, espn_game_id, game_date, team_score, opponent_name, opponent_score, ' +
      'result, home_away, raw_espn_data, ai_summary, created_at, sport_teams(*)',
    )
    .is('notified_at', null)
    .order('created_at', { ascending: true })
    .limit(PENDING_BATCH_LIMIT)

  if (error) {
    console.error('Failed to read pending games:', error.message)
    return { sent: 0, held: 0 }
  }
  if (!pending || pending.length === 0) return { sent: 0, held: 0 }

  let sent = 0
  let held = 0

  for (const rowData of pending) {
    const row = rowData as Record<string, any>
    const team = row.sport_teams as Team | null
    if (!team) {
      // The team row is gone (deleted, not just deactivated). Nothing to email
      // to, and retention will clear the orphan.
      console.error(`Pending game ${row.espn_game_id} has no team; skipping`)
      continue
    }

    const game: GameResult = {
      espnGameId: row.espn_game_id,
      gameDate: row.game_date,
      teamScore: row.team_score,
      opponentName: row.opponent_name,
      opponentScore: row.opponent_score,
      result: row.result,
      homeAway: row.home_away,
      rawData: row.raw_espn_data,
    }

    const outcome = await finishGame(supabase, team, game, {
      scoreHistoryId: row.id,
      existingSummary: row.ai_summary ?? null,
      recordedAtMs: Date.parse(row.created_at ?? '') || Date.now(),
    }, keys)

    if (outcome.deferred) held++
    else if (outcome.ok) sent++
    else if (outcome.error) console.error(`Pending game ${row.espn_game_id}: ${outcome.error}`)
  }

  return { sent, held }
}

/** Alert once about games that should be over but never produced a result. */
async function checkForStaleGames(
  supabase: SupabaseClient,
  teams: Team[],
  now: Date,
  logAlert: (context: AlertContext) => Promise<void>,
): Promise<void> {
  const { data: expected, error } = await supabase
    .from('sports_expected_games')
    .select('team_id, espn_game_id, start_time')
    .is('alerted_at', null)

  if (error || !expected || expected.length === 0) {
    if (error) console.error('Failed to read sports_expected_games:', error)
    return
  }

  const { data: recorded } = await supabase
    .from('score_history')
    .select('espn_game_id')
    .in('espn_game_id', expected.map((row) => row.espn_game_id))

  const stale = findStaleGames(
    expected as Array<{ espn_game_id: string; start_time: string; team_id: string }>,
    (recorded ?? []).map((row) => row.espn_game_id),
    now,
  ) as Array<{ espn_game_id: string; start_time: string; team_id: string }>

  if (stale.length === 0) return

  const teamNames = new Map(teams.map((team) => [team.id, team.display_name]))
  await logAlert({
    type: 'stale',
    staleGames: stale.map(
      (row) => `${teamNames.get(row.team_id) ?? 'Unknown team'} — game ${row.espn_game_id} started ${row.start_time}`,
    ),
  })

  // Mark them so the alert fires once, not every 15 minutes.
  const alertedAt = new Date().toISOString()
  for (const row of stale) {
    await supabase
      .from('sports_expected_games')
      .update({ alerted_at: alertedAt })
      .eq('team_id', row.team_id)
      .eq('espn_game_id', row.espn_game_id)
  }
}

/**
 * Alert about results that were recorded but never emailed.
 *
 * The retry in recordAndNotify heals this within one tick under normal
 * conditions, so anything still unsent after UNNOTIFIED_ALERT_HOURS means the
 * retries themselves are failing — which is worth an email even though the
 * ESPN side looks perfectly healthy.
 */
async function checkForUnnotifiedGames(
  supabase: SupabaseClient,
  teams: Team[],
  now: Date,
  logAlert: (context: AlertContext) => Promise<void>,
): Promise<void> {
  const cutoff = new Date(now.getTime() - UNNOTIFIED_ALERT_HOURS * 60 * 60 * 1000).toISOString()

  const { data: unnotified, error } = await supabase
    .from('score_history')
    .select('id, team_id, team_score, opponent_name, opponent_score, created_at')
    .is('notified_at', null)
    .is('notify_alerted_at', null)
    .lt('created_at', cutoff)

  if (error || !unnotified || unnotified.length === 0) {
    if (error) console.error('Failed to read unnotified score_history rows:', error)
    return
  }

  const teamNames = new Map(teams.map((team) => [team.id, team.display_name]))
  await logAlert({
    type: 'unnotified',
    unnotifiedGames: unnotified.map(
      (row) =>
        `${teamNames.get(row.team_id) ?? 'Unknown team'} ${row.team_score}-${row.opponent_score} vs ` +
        `${row.opponent_name} (recorded ${row.created_at})`,
    ),
  })

  // Stamp them so the alert fires once, not every 15 minutes. The rows stay
  // unnotified, so the email retry keeps trying independently of this.
  const alertedAt = new Date().toISOString()
  await supabase
    .from('score_history')
    .update({ notify_alerted_at: alertedAt })
    .in('id', unnotified.map((row) => row.id))
}
