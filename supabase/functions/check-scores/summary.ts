// Gemini-generated team blurb attached to each score email.

import type { Team } from './espn.ts'

// PINNED, do not "upgrade". This needs Google Search grounding (see the
// tools: [{ google_search: {} }] below) and the free tier does not serve
// grounding on any 3.x model — every one of them returns 429 RESOURCE_EXHAUSTED
// the moment the tool is requested, while 2.5-flash returns grounded results
// normally. Verified against the live API. Plain (ungrounded) 3.x generation is
// fine on the same key, which is why the reminder-intent classifier can run on
// 3.5-flash-lite.
const GEMINI_MODEL = 'gemini-2.5-flash'

// Gemini occasionally returns a transient 5xx/429 or an empty 200 body, so a
// couple of retries with a short backoff usually recovers the summary.
const GEMINI_MAX_ATTEMPTS = 3

const GEMINI_PROMPT_TEMPLATE = (teamFullName: string, sport: string) =>
  `Give me a current 3-bullet update on the ${teamFullName} ${sport} team in the following format: \n` +
  ` Record & Standings: Include win-loss record, division standing, and a note on playoff chances. \n` +
  ` Recent News: One or two notable updates. \n` +
  ` Next Game (not counting any games currently happening or recently ended): Date, opponent, location and start time (in eastern time zone).\n` +
  `Keep the tone neutral and concise, and be sure to rely on sources and not hallucinate.`

const SPORT_LABELS: Record<string, string> = {
  'baseball': 'MLB baseball',
  'basketball': 'NBA',
  'hockey': 'NHL',
  'football': 'NFL',
  'soccer': "women's soccer",
}

export function sportLabel(team: Team): string {
  if (team.league === 'college-football') return 'NCAA football'
  if (team.league === 'mens-college-basketball') return "NCAA men's basketball"
  if (team.league === 'womens-college-basketball') return "NCAA women's basketball"
  return SPORT_LABELS[team.sport] ?? team.sport
}

export async function generateSummary(team: Team, apiKey: string): Promise<string | null> {
  const prompt = GEMINI_PROMPT_TEMPLATE(team.display_name, sportLabel(team))
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`

  for (let attempt = 1; attempt <= GEMINI_MAX_ATTEMPTS; attempt++) {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
        }),
      })

      if (resp.ok) {
        const data = await resp.json()
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? null
        if (text) return text
        // 200 but no usable text — transient grounding hiccup, worth retrying.
        console.error(`Gemini empty response for ${team.display_name} (attempt ${attempt}/${GEMINI_MAX_ATTEMPTS})`)
      } else {
        console.error(`Gemini API error for ${team.display_name}: ${resp.status} (attempt ${attempt}/${GEMINI_MAX_ATTEMPTS})`)
        // 4xx (except 429 rate limit) are permanent — don't waste retries.
        if (resp.status >= 400 && resp.status < 500 && resp.status !== 429) {
          return null
        }
      }
    } catch (err) {
      console.error(`Gemini call failed for ${team.display_name} (attempt ${attempt}/${GEMINI_MAX_ATTEMPTS}):`, err)
    }

    // Linear backoff between attempts: 1s, then 2s. Skip after the last attempt.
    if (attempt < GEMINI_MAX_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt))
    }
  }

  return null
}
