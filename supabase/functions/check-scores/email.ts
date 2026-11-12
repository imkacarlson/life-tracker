// Score email composition and delivery (Resend).

import type { GameResult, Team } from './espn.ts'
import { OWNER_EMAIL } from '../_shared/resendEmail.ts'
import { type CardData, buildCardHtml } from './emailCard.ts'

// Delivery lives in _shared so auth-alerts can reuse it.
export { sendEmail } from '../_shared/resendEmail.ts'

export const EMAIL_RECIPIENT = OWNER_EMAIL

// From name per sport — matches the original Power Automate flow.
const FROM_NAMES: Record<string, string> = {
  'nationals': 'MLB Scores',
  'pacers': 'NBA Scores',
  'wizards': 'NBA Scores',
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
  'wizards': 'Wizards',
  'capitals': 'Capitals',
  'commanders': 'Commanders',
  'colts': 'Colts',
  'iu_football': 'Hoosiers',
  'iu_basketball': 'Hoosier Men',
  'iu_womens_basketball': 'Hoosier Women',
  'spirit': 'Spirit',
}

export const fromNameForTeam = (team: Team): string => FROM_NAMES[team.name] ?? 'Sports Scores'

// alerts.ts imports escapeHtml from here; the card owns the one copy.
export { escapeHtml } from './emailCard.ts'

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

/** The email body is the scoreboard card; see emailCard.ts. */
export function buildEmailHtml(team: Team, game: GameResult, data: CardData): string {
  return buildCardHtml(team, game, data)
}
