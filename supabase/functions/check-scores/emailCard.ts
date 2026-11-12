// The score email body: a scoreboard card you can read at a glance.
//
//   [ team-colored band: final score ]
//   [ Record | Rank | Playoff odds   ]
//   [ Next game ............ logo + Home/Away ]
//   [ News (one line from Gemini)    ]
//   [ Conference standings table     ]
//
// Email-safe on purpose: tables and inline styles only. Gmail strips <svg>,
// <script> and most <style> rules, so every bar and chip is a table cell or a
// span with a background color. Any section whose data is missing is left out.
//
// HOUSE RULE: zero jsr:/npm:/https:// imports, zero top-level `Deno.*`.

import type { GameResult, Team } from './espn.ts'
import type { Insight } from './summary.ts'
import type { NextGame, Standings, TeamContext } from './teamContext.ts'

export type CardData = {
  /** Playoff odds and news from Gemini, if it answered. */
  insight: Insight | null
  /** Odds from this team's previous email, for the ▲▼ change. */
  previousOddsPct: number | null
  context: TeamContext
}

// --- Palette (light; this is what lands in the inbox) -----------------------

const C = {
  page: '#f4f5f7',
  card: '#ffffff',
  text: '#16181d',
  muted: '#6b7280',
  line: '#e5e7eb',
  soft: '#f4f5f7',
  win: '#1f9d55',
  loss: '#d64545',
  tie: '#6b7280',
  amber: '#c98a12',
  usRow: '#e8eef7',
  homeText: '#1d6b45',
  homeBg: '#e3f3ea',
  awayText: '#3d4f7a',
  awayBg: '#e6eaf4',
}

const FONT = 'Arial, Helvetica, sans-serif'
const NUM_FONT = "'Arial Narrow', Arial, Helvetica, sans-serif"
const EASTERN = 'America/New_York'

// --- Small helpers ------------------------------------------------------------

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th … 21st. */
export function ordinal(n: number): string {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`
  const suffix = ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'
  return `${n}${suffix}`
}

/** "4-8" -> "4–8" (en dash reads as a record, not a minus). */
const dashes = (s: string) => s.replace(/-/g, '–')

const label = (text: string, extra = '') =>
  `<span style="font-family:${FONT};font-size:10.5px;letter-spacing:0.08em;text-transform:uppercase;color:${C.muted};font-weight:bold;${extra}">${escapeHtml(text)}</span>`

/** Band color from ESPN's team color, falling back to slate. */
function bandColors(hex: unknown): { bg: string; fg: string; fgDim: string } {
  const clean = typeof hex === 'string' && /^[0-9a-f]{6}$/i.test(hex) ? hex : '1f2937'
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(clean.slice(i, i + 2), 16) / 255)
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  // Light team colors (gold, silver) get dark text.
  return luminance > 0.6
    ? { bg: `#${clean}`, fg: '#111111', fgDim: 'rgba(0,0,0,0.55)' }
    : { bg: `#${clean}`, fg: '#ffffff', fgDim: 'rgba(255,255,255,0.6)' }
}

const easternDate = (iso: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(iso).toLocaleString('en-US', { timeZone: EASTERN, ...opts })

/** "Sun, Nov 15 · 7:00 PM" in Eastern time. */
export function formatGameTime(iso: string, timeValid: boolean): string {
  const day = easternDate(iso, { weekday: 'short', month: 'short', day: 'numeric' })
  const time = timeValid ? easternDate(iso, { hour: 'numeric', minute: '2-digit' }) : 'Time TBD'
  return `${day} · ${time}`
}

// --- Reading the finished game out of the raw ESPN event ---------------------

type Side = { name: string; score: number; won: boolean }

function readGame(team: Team, game: GameResult) {
  const event: any = game.rawData ?? {}
  const competitors: any[] = event?.competitions?.[0]?.competitors ?? []
  const us = competitors.find((c) => String(c?.team?.id) === team.espn_team_id)
  const opp = competitors.find((c) => String(c?.team?.id) !== team.espn_team_id)

  const ourSide: Side = {
    name: us?.team?.displayName ?? team.display_name,
    score: game.teamScore,
    won: game.result === 'win',
  }
  const oppSide: Side = {
    name: opp?.team?.displayName ?? game.opponentName,
    score: game.opponentScore,
    won: game.result === 'loss',
  }

  // Record AFTER this game; ESPN updates it on the scoreboard with the final.
  const record = us?.records?.[0]?.summary
  const startIso = typeof event?.date === 'string' ? event.date : `${game.gameDate}T12:00:00Z`

  return {
    // Sports convention: away team on top.
    rows: game.homeAway === 'away' ? [ourSide, oppSide] : [oppSide, ourSide],
    record: typeof record === 'string' ? dashes(record) : null,
    colors: bandColors(us?.team?.color),
    accent: bandColors(us?.team?.color).bg,
    dateLabel: easternDate(startIso, { month: 'short', day: 'numeric' }),
    lastOpponentId: opp?.team?.id ? String(opp.team.id) : null,
  }
}

/** The opponent's ESPN id, so the standings table can tag the last game. */
export function lastOpponentId(team: Team, game: GameResult): string | null {
  return readGame(team, game).lastOpponentId
}

// --- Sections ------------------------------------------------------------------

function scoreBand(team: Team, game: GameResult, g: ReturnType<typeof readGame>): string {
  const pill = game.result === 'win'
    ? { text: 'Win', bg: C.win }
    : game.result === 'loss'
    ? { text: 'Loss', bg: C.loss }
    : { text: 'Tie', bg: C.tie }

  const where = game.homeAway === 'home' ? 'Home' : 'Away'

  const row = (side: Side, last: boolean) => `
    <tr>
      <td style="font-family:${FONT};font-size:15px;color:${side.won || game.result === 'tie' ? g.colors.fg : g.colors.fgDim};padding:${last ? '2px 0 0' : '8px 0 2px'};">${escapeHtml(side.name)}</td>
      <td align="right" style="font-family:${NUM_FONT};font-size:32px;font-weight:bold;line-height:1;color:${side.won || game.result === 'tie' ? g.colors.fg : g.colors.fgDim};padding:${last ? '2px 0 0' : '8px 0 2px'};">${side.score}</td>
    </tr>`

  return `
  <tr><td style="background:${g.colors.bg};padding:16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="font-family:${FONT};font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:${g.colors.fgDim};">Final · ${where} · ${escapeHtml(g.dateLabel)}</td>
        <td align="right"><span style="font-family:${FONT};background:${pill.bg};color:#ffffff;font-size:11px;font-weight:bold;letter-spacing:0.06em;text-transform:uppercase;padding:3px 8px;border-radius:3px;">${pill.text}</span></td>
      </tr>
      ${row(g.rows[0], false)}
      ${row(g.rows[1], true)}
    </table>
  </td></tr>`
}

type Tile = { label: string; value: string; sub?: string; subColor?: string; barPct?: number }

function buildTiles(
  record: string | null,
  standings: Standings | null,
  standingsFresh: boolean,
  data: CardData,
): Tile[] {
  const tiles: Tile[] = []

  if (record) {
    tiles.push({
      label: 'Record',
      value: record,
      // Streak comes from standings, which can lag the final by a few minutes.
      sub: standingsFresh && standings?.streak ? standings.streak : undefined,
    })
  }

  if (standings?.ourRank) {
    tiles.push({ label: standings.groupLabel || 'Rank', value: ordinal(standings.ourRank) })
  }

  const odds = data.insight?.playoff_odds_pct ?? null
  if (odds !== null) {
    const prev = data.previousOddsPct
    let sub: string | undefined
    let subColor: string | undefined
    if (prev !== null) {
      const delta = odds - prev
      sub = delta === 0 ? 'No change' : `${delta > 0 ? '▲' : '▼'} ${Math.abs(delta)} pts`
      subColor = delta > 0 ? C.win : delta < 0 ? C.loss : C.muted
    }
    tiles.push({ label: 'Playoffs', value: `${odds}%`, barPct: odds, sub, subColor })
  } else if (standings?.points) {
    tiles.push({ label: 'Points', value: standings.points })
  } else if (standings?.gamesBack) {
    tiles.push({ label: 'Games back', value: standings.gamesBack === '0' ? '—' : standings.gamesBack })
  }

  return tiles
}

function tilesRow(tiles: Tile[]): string {
  if (tiles.length === 0) return ''
  const width = Math.floor(100 / tiles.length)

  const cells = tiles.map((t, i) => {
    const bar = t.barPct === undefined ? '' : `
      <table role="presentation" width="80%" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:4px auto 0;">
        <tr>
          ${t.barPct > 0 ? `<td width="${t.barPct}%" style="background:${C.amber};height:6px;font-size:0;line-height:0;">&nbsp;</td>` : ''}
          ${t.barPct < 100 ? `<td width="${100 - t.barPct}%" style="background:${C.soft};height:6px;font-size:0;line-height:0;">&nbsp;</td>` : ''}
        </tr>
      </table>`
    return `
      <td width="${width}%" align="center" valign="top" style="padding:12px 6px;${i > 0 ? `border-left:1px solid ${C.line};` : ''}">
        ${label(t.label)}<br>
        <span style="font-family:${NUM_FONT};font-size:26px;font-weight:bold;line-height:1.15;color:${C.text};">${escapeHtml(t.value)}</span>
        ${bar}
        ${t.sub ? `<div style="font-family:${FONT};font-size:11px;color:${t.subColor ?? C.muted};padding-top:2px;">${escapeHtml(t.sub)}</div>` : ''}
      </td>`
  }).join('')

  return `
  <tr><td style="border-bottom:1px solid ${C.line};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${cells}</tr></table>
  </td></tr>`
}

function nextGameRow(next: NextGame): string {
  const home = next.homeAway === 'home'
  const tag = home
    ? `<span style="font-family:${FONT};font-size:9.5px;font-weight:bold;letter-spacing:0.08em;text-transform:uppercase;background:${C.homeBg};color:${C.homeText};padding:2px 7px;border-radius:999px;white-space:nowrap;">&#8962; Home</span>`
    : `<span style="font-family:${FONT};font-size:9.5px;font-weight:bold;letter-spacing:0.08em;text-transform:uppercase;background:${C.awayBg};color:${C.awayText};padding:2px 7px;border-radius:999px;white-space:nowrap;">&#9992; Away</span>`

  const logo = next.opponentLogo
    ? `<img src="${escapeHtml(next.opponentLogo)}" width="40" height="40" alt="${escapeHtml(next.opponentName)}" style="display:block;margin:0 auto 4px;width:40px;height:40px;border:0;">`
    : ''

  const season = next.seasonLabel
    ? `<span style="font-family:${FONT};font-size:10px;font-weight:bold;letter-spacing:0.06em;text-transform:uppercase;color:${C.amber};">${escapeHtml(next.seasonLabel)}</span><br>`
    : ''

  const where = [`${home ? 'vs' : 'at'} ${next.opponentName}`, next.venue].filter(Boolean).join(' · ')

  return `
  <tr><td style="border-bottom:1px solid ${C.line};padding:11px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td width="52" valign="middle">${label('Next')}</td>
      <td valign="middle" style="font-family:${FONT};font-size:13.5px;color:${C.text};line-height:1.4;">
        ${season}<b>${escapeHtml(formatGameTime(next.startTime, next.timeValid))}</b><br>
        <span style="color:${C.muted};">${escapeHtml(where)}</span>
      </td>
      <td width="70" align="center" valign="middle">${logo}${tag}</td>
    </tr></table>
  </td></tr>`
}

function newsRow(news: string): string {
  return `
  <tr><td style="border-bottom:1px solid ${C.line};padding:11px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td width="52" valign="top" style="padding-top:2px;">${label('News')}</td>
      <td valign="top" style="font-family:${FONT};font-size:13.5px;color:${C.text};line-height:1.4;">${escapeHtml(news)}</td>
    </tr></table>
  </td></tr>`
}

function standingsSection(s: Standings, accent: string, fresh: boolean): string {
  const cell = (content: string, align: 'left' | 'right', style = '') =>
    `<td align="${align}" style="font-family:${FONT};font-size:13px;padding:6px 4px;${style}">${content}</td>`

  const cutRow = (line: Standings['cutLines'][number]) => {
    const color = line.kind === 'out' ? C.muted : C.amber
    const border = line.kind === 'out' ? '#c3c8d0' : C.amber
    return `
      <tr><td colspan="4" style="padding:3px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td width="1%" style="font-family:${FONT};font-size:10px;font-weight:bold;letter-spacing:0.06em;text-transform:uppercase;color:${color};white-space:nowrap;padding-right:6px;">${escapeHtml(line.label)}</td>
          <td style="border-top:1.5px dashed ${border};font-size:0;line-height:0;">&nbsp;</td>
        </tr></table>
      </td></tr>`
  }

  const body = s.rows.map((r) => {
    const bg = r.isUs ? `background:${C.usRow};font-weight:bold;` : ''
    const tag = r.isLastOpponent
      ? ` <span style="font-size:9.5px;font-weight:bold;letter-spacing:0.06em;text-transform:uppercase;color:${C.muted};">last game</span>`
      : ''
    const line = s.cutLines.find((c) => c.afterRank === r.rank)
    return `
      <tr>
        ${cell(String(r.rank), 'right', `${bg}color:${C.muted};width:24px;${r.isUs ? `border-left:3px solid ${accent};` : ''}`)}
        ${cell(`${escapeHtml(r.name)}${tag}`, 'left', `${bg}color:${C.text};`)}
        ${cell(escapeHtml(r.record), 'right', `${bg}color:${C.text};`)}
        ${cell(escapeHtml(r.extra), 'right', `${bg}color:${C.text};`)}
      </tr>${line ? cutRow(line) : ''}`
  }).join('')

  const first = s.rows[0]?.rank
  const last = s.rows[s.rows.length - 1]?.rank
  const notes = [
    first && last ? `Showing ${ordinal(first)}–${ordinal(last)}.` : '',
    s.extraLabel === 'GB' ? 'GB is games behind 1st.' : '',
    fresh ? '' : 'Standings may not include this game yet.',
  ].filter(Boolean).join(' ')

  const th = (text: string, align: 'left' | 'right') =>
    `<td align="${align}" style="font-family:${FONT};font-size:10.5px;letter-spacing:0.06em;text-transform:uppercase;color:${C.muted};font-weight:bold;padding:6px 4px;border-bottom:1px solid ${C.line};">${text}</td>`

  return `
  <tr><td style="border-top:6px solid ${C.soft};padding:14px 16px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td>${label(s.groupName || 'Standings')}</td>
      <td align="right">${s.legend ? label(s.legend, 'font-weight:normal;') : ''}</td>
    </tr></table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:6px;">
      <tr>${th('', 'right')}${th('Team', 'left')}${th('Record', 'right')}${th(s.extraLabel, 'right')}</tr>
      ${body}
    </table>
    <div style="font-family:${FONT};font-size:11.5px;color:${C.muted};padding-top:6px;">${escapeHtml(notes)}</div>
  </td></tr>`
}

// --- The whole card -------------------------------------------------------------

/**
 * True when the standings already count this game, i.e. our row's record
 * matches the scoreboard's post-game record. Compared digits-only so "4–8"
 * and "4-8" match, and NHL's "10-6-0" matches "10–6–0".
 */
function standingsIncludeGame(record: string | null, standings: Standings | null): boolean {
  if (!record || !standings) return false
  const ours = standings.rows.find((r) => r.isUs)?.record
  const digits = (s: string) => s.match(/\d+/g)?.join('-') ?? ''
  return ours !== undefined && digits(ours) === digits(record)
}

export function buildCardHtml(team: Team, game: GameResult, data: CardData): string {
  const g = readGame(team, game)
  const { standings, nextGame } = data.context
  const fresh = standingsIncludeGame(g.record, standings)

  const sections = [
    scoreBand(team, game, g),
    tilesRow(buildTiles(g.record, standings, fresh, data)),
    nextGame ? nextGameRow(nextGame) : '',
    data.insight?.news ? newsRow(data.insight.news) : '',
    standings && standings.rows.length > 0 ? standingsSection(standings, g.accent, fresh) : '',
  ].join('')

  return `<div style="background:${C.page};padding:16px 8px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;margin:0 auto;background:${C.card};border-radius:12px;overflow:hidden;border-collapse:separate;">
${sections}
</table>
</div>`
}
