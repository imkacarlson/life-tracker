// Score email composition and delivery (Resend).

import type { GameResult, Team } from './espn.ts'

export const EMAIL_RECIPIENT = 'imkacarlson@gmail.com'

// From name per sport — matches the original Power Automate flow.
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

// Short display name for the email subject.
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

export const fromNameForTeam = (team: Team): string => FROM_NAMES[team.name] ?? 'Sports Scores'

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function buildEmailSubject(team: Team, game: GameResult): string {
  const emoji = game.result === 'win' ? team.emoji_win
    : game.result === 'loss' ? team.emoji_loss
    : team.emoji_tie

  const resultLabel = game.result === 'win' ? 'Win!'
    : game.result === 'loss' ? 'Lose'
    : 'Tie'

  const shortName = SHORT_NAMES[team.name] ?? team.display_name

  return `${emoji} ${shortName} ${resultLabel} ${game.teamScore}-${game.opponentScore} vs ${game.opponentName}`
}

export function buildEmailHtml(team: Team, game: GameResult, aiSummary: string | null): string {
  const resultLabel = game.result === 'win' ? 'Win' : game.result === 'loss' ? 'Loss' : 'Tie'
  const location = game.homeAway === 'home' ? 'Home' : 'Away'

  // Convert markdown-style bold (**text**) to <b> tags in the AI summary.
  const summaryHtml = aiSummary
    ? '<br><br>' + escapeHtml(aiSummary)
        .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
        .replace(/\n/g, '<br>')
    : ''

  return `<b>${escapeHtml(team.display_name)} ${resultLabel} ${game.teamScore}-${game.opponentScore}</b> vs ${escapeHtml(game.opponentName)} (${location})<br>${game.gameDate}${summaryHtml}`
}

export async function sendEmail(
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
