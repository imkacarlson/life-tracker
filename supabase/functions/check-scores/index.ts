import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'jsr:@supabase/supabase-js@2'

// --- Types ---

type Team = {
  id: string
  name: string
  display_name: string
  sport: string
  league: string
  espn_team_id: string
  emoji_win: string
  emoji_loss: string
  emoji_tie: string
}

type GameResult = {
  espnGameId: string
  gameDate: string
  teamScore: number
  opponentName: string
  opponentScore: number
  result: 'win' | 'loss' | 'tie'
  homeAway: 'home' | 'away'
  rawData: unknown
}

// --- Config ---

const EMAIL_RECIPIENT = 'imkacarlson@gmail.com'
const GEMINI_MODEL = 'gemini-2.5-flash'

// Team seed data — inserted on first run if sport_teams is empty
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

// Gemini prompt per team — matches the original Power Automate flow format
const GEMINI_PROMPT_TEMPLATE = (teamFullName: string, sport: string) =>
  `Give me a current 3-bullet update on the ${teamFullName} ${sport} team in the following format: \n` +
  ` Record & Standings: Include win-loss record, division standing, and a note on playoff chances. \n` +
  ` Recent News: One or two notable updates. \n` +
  ` Next Game (not counting any games currently happening or recently ended): Date, opponent, location and start time (in eastern time zone).\n` +
  `Keep the tone neutral and concise, and be sure to rely on sources and not hallucinate.`

// Sport label used in the Gemini prompt
const SPORT_LABELS: Record<string, string> = {
  'baseball': 'MLB baseball',
  'basketball': 'NBA',
  'hockey': 'NHL',
  'football': 'NFL',
  'soccer': "women's soccer",
}

function sportLabel(team: Team): string {
  // For college teams, use a more specific label
  if (team.league === 'college-football') return 'NCAA football'
  if (team.league === 'mens-college-basketball') return 'NCAA men\'s basketball'
  if (team.league === 'womens-college-basketball') return 'NCAA women\'s basketball'
  return SPORT_LABELS[team.sport] ?? team.sport
}

// --- ESPN API ---

async function fetchCompletedGames(team: Team): Promise<GameResult[]> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${team.sport}/${team.league}/teams/${team.espn_team_id}/schedule`
  const resp = await fetch(url)
  if (!resp.ok) {
    console.error(`ESPN API error for ${team.display_name}: ${resp.status}`)
    return []
  }

  const data = await resp.json()
  const events = data.events ?? []
  const results: GameResult[] = []

  // Only process games that completed in the last 24 hours
  // (prevents a flood of emails on first run or after downtime)
  const cutoff = Date.now() - 24 * 60 * 60 * 1000

  for (const event of events) {
    const competition = event.competitions?.[0]
    if (!competition) continue

    const status = competition.status?.type
    if (!status?.completed) continue

    const gameTime = new Date(event.date).getTime()
    if (gameTime < cutoff) continue

    const espnGameId = String(event.id)
    const gameDate = event.date?.split('T')[0] ?? ''

    // Find our team and the opponent in competitors
    const competitors = competition.competitors ?? []
    const ourTeam = competitors.find(
      (c: any) => String(c.team?.id) === team.espn_team_id
    )
    const opponent = competitors.find(
      (c: any) => String(c.team?.id) !== team.espn_team_id
    )

    if (!ourTeam || !opponent) continue

    const teamScore = parseInt(ourTeam.score?.value ?? ourTeam.score ?? '0', 10)
    const opponentScore = parseInt(opponent.score?.value ?? opponent.score ?? '0', 10)

    let result: 'win' | 'loss' | 'tie'
    if (ourTeam.winner === true) {
      result = 'win'
    } else if (opponent.winner === true) {
      result = 'loss'
    } else {
      result = 'tie'
    }

    results.push({
      espnGameId,
      gameDate,
      teamScore,
      opponentName: opponent.team?.displayName ?? 'Unknown',
      opponentScore,
      result,
      homeAway: ourTeam.homeAway ?? 'home',
      rawData: event,
    })

  }

  return results
}

// --- Gemini AI Summary ---

async function generateSummary(team: Team, apiKey: string): Promise<string | null> {
  const prompt = GEMINI_PROMPT_TEMPLATE(team.display_name, sportLabel(team))
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
      }),
    })

    if (!resp.ok) {
      console.error(`Gemini API error for ${team.display_name}: ${resp.status}`)
      return null
    }

    const data = await resp.json()
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? null
  } catch (err) {
    console.error(`Gemini call failed for ${team.display_name}:`, err)
    return null
  }
}

// --- Email via Resend ---

// From name per sport — matches original Power Automate flow
const FROM_NAMES: Record<string, string> = {
  'nationals': 'MLB Scores',
  'pacers': 'NBA Scores',
  'capitals': 'NHL Scores',
  'commanders': 'NFL Scores',
  'colts': 'NFL Scores',
  'iu_football': 'College Football',
  'iu_basketball': "Men's College Basketball",
  'iu_womens_basketball': "Women's College Basketball",
  'spirit': "Women's Soccer",
}

// Short display name for email subject
const SHORT_NAMES: Record<string, string> = {
  'nationals': 'Nats',
  'pacers': 'Pacers',
  'capitals': 'Capitals',
  'commanders': 'Commanders',
  'colts': 'Colts',
  'iu_football': 'Hoosiers',
  'iu_basketball': 'Hoosier Men',
  'iu_womens_basketball': 'Hoosier Women',
  'spirit': 'Spirit',
}

function buildEmailSubject(team: Team, game: GameResult): string {
  const emoji = game.result === 'win' ? team.emoji_win
    : game.result === 'loss' ? team.emoji_loss
    : team.emoji_tie

  const resultLabel = game.result === 'win' ? 'Win!'
    : game.result === 'loss' ? 'Lose'
    : 'Tie'

  const shortName = SHORT_NAMES[team.name] ?? team.display_name

  return `${emoji} ${shortName} ${resultLabel} ${game.teamScore}-${game.opponentScore} vs ${game.opponentName}`
}

function buildEmailHtml(team: Team, game: GameResult, aiSummary: string | null): string {
  const resultLabel = game.result === 'win' ? 'Win' : game.result === 'loss' ? 'Loss' : 'Tie'
  const location = game.homeAway === 'home' ? 'Home' : 'Away'

  // Convert markdown-style bold (**text**) to <b> tags in AI summary
  const summaryHtml = aiSummary
    ? '<br><br>' + escapeHtml(aiSummary)
        .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
        .replace(/\n/g, '<br>')
    : ''

  return `<b>${escapeHtml(team.display_name)} ${resultLabel} ${game.teamScore}-${game.opponentScore}</b> vs ${escapeHtml(game.opponentName)} (${location})<br>${game.gameDate}${summaryHtml}`
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

async function sendEmail(
  resendApiKey: string,
  to: string,
  subject: string,
  html: string,
  fromName: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify({
        from: `${fromName} <onboarding@resend.dev>`,
        to: [to],
        subject,
        html,
      }),
    })

    if (!resp.ok) {
      const errBody = await resp.text()
      console.error('Resend error:', errBody)
      return { ok: false, error: `Resend ${resp.status}: ${errBody}` }
    }

    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

// --- Main Handler ---

Deno.serve(async (req) => {
  // Validate cron secret
  const cronSecret = Deno.env.get('CRON_SECRET')
  if (!cronSecret) {
    console.error('CRON_SECRET not configured')
    return new Response(JSON.stringify({ error: 'Server misconfigured' }), { status: 500 })
  }

  const providedSecret = req.headers.get('x-cron-secret')
  if (providedSecret !== cronSecret) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  const googleApiKey = Deno.env.get('GEMINI_SCORES_API_KEY')
  const resendApiKey = Deno.env.get('RESEND_API_KEY')

  if (!resendApiKey) {
    console.error('RESEND_API_KEY not configured')
    return new Response(JSON.stringify({ error: 'RESEND_API_KEY missing' }), { status: 500 })
  }

  // Use service role to bypass RLS
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  // Cleanup: delete score_history and notification_log older than 7 days
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  await supabase.from('notification_log').delete().lt('created_at', sevenDaysAgo)
  await supabase.from('score_history').delete().lt('created_at', sevenDaysAgo)

  // Seed teams if table is empty (first run)
  const { count } = await supabase
    .from('sport_teams')
    .select('*', { count: 'exact', head: true })

  if (count === 0) {
    // Get the single user (this is a personal app)
    const { data: users } = await supabase.auth.admin.listUsers()
    const userId = users?.users?.[0]?.id
    if (!userId) {
      return new Response(JSON.stringify({ error: 'No user found for seeding' }), { status: 500 })
    }

    const seedRows = SEED_TEAMS.map((t) => ({ ...t, user_id: userId }))
    const { error: seedError } = await supabase.from('sport_teams').insert(seedRows)
    if (seedError) {
      console.error('Seed error:', seedError)
      return new Response(JSON.stringify({ error: 'Failed to seed teams' }), { status: 500 })
    }
    console.log('Seeded sport_teams with', seedRows.length, 'teams')
  }

  // Fetch active teams
  const { data: teams, error: teamsError } = await supabase
    .from('sport_teams')
    .select('*')
    .eq('active', true)

  if (teamsError || !teams) {
    console.error('Failed to load teams:', teamsError)
    return new Response(JSON.stringify({ error: 'Failed to load teams' }), { status: 500 })
  }

  const results: Array<{ team: string; gamesFound: number; notified: number; errors: string[] }> = []

  for (const team of teams as Team[]) {
    const teamResult = { team: team.display_name, gamesFound: 0, notified: 0, errors: [] as string[] }

    // Fetch completed games from ESPN
    const games = await fetchCompletedGames(team)
    teamResult.gamesFound = games.length

    for (const game of games) {
      // Dedup: try to insert into score_history first
      // ON CONFLICT DO NOTHING — if row already exists, skip
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
        .select('id')
        .single()

      // If insert failed due to unique constraint, this game was already processed
      if (insertError) {
        // 23505 = unique_violation (already notified)
        if (insertError.code === '23505') continue
        teamResult.errors.push(`Insert error: ${insertError.message}`)
        continue
      }

      const scoreHistoryId = inserted.id

      // Generate AI summary (non-blocking — if it fails, send score-only email)
      let aiSummary: string | null = null
      if (googleApiKey) {
        aiSummary = await generateSummary(team, googleApiKey)

        // Save AI summary back to score_history
        if (aiSummary) {
          await supabase
            .from('score_history')
            .update({ ai_summary: aiSummary })
            .eq('id', scoreHistoryId)
        }
      }

      // Build and send email
      const subject = buildEmailSubject(team, game)
      const html = buildEmailHtml(team, game, aiSummary)
      const fromName = FROM_NAMES[team.name] ?? 'Sports Scores'
      const emailResult = await sendEmail(resendApiKey, EMAIL_RECIPIENT, subject, html, fromName)

      // Log notification
      await supabase.from('notification_log').insert({
        score_history_id: scoreHistoryId,
        channel: 'email',
        recipient: EMAIL_RECIPIENT,
        subject,
        status: emailResult.ok ? 'sent' : 'failed',
        error_message: emailResult.error ?? null,
      })

      if (emailResult.ok) {
        teamResult.notified++
      } else {
        teamResult.errors.push(`Email failed: ${emailResult.error}`)
      }
    }

    results.push(teamResult)
  }

  const totalNotified = results.reduce((sum, r) => sum + r.notified, 0)
  console.log(`check-scores complete: ${totalNotified} notifications sent`)

  return new Response(JSON.stringify({ ok: true, results }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
