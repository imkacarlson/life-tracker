// Prompt template + assembly, ported from the original .flo
// (grc-blog-drafter-flow/prompt_data.py and grc_blog_drafter.py).
//
// Two deliberate choices keep real data out of the git repo:
//  1. Rosters are fetched live (roster.ts) and injected as
//     `Full Name — https://www.grcrunning.com/{slug}/` lines, and Claude is told
//     to use those exact URLs — this fixes the broken profile-link guessing.
//  2. The one-shot formatting example is NOT stored here. It's read at runtime
//     from the BLOG_EXAMPLE function secret (set on the Supabase deployment, like
//     WP_USER), so the real INPUT/OUTPUT example never lives in the repo.

import type { Athlete } from './roster.ts'

export const PROMPT_TEMPLATE =
  `Please create a WordPress template for my running club's race results using the following format: 1. Organize results by race/event with proper WordPress block editor headings 2. For events where both men and women competed, use a two-column layout with "Men:" and "Women:" subheadings. Also this is important and commonly missed please also use a two-column layout when there are multiple events with subheadings for different events run at the same race (just like how Maryland Twlight and Widener are in the example). 3. Format athlete names as links to their profile pages without title attributes: <a href="https://www.grcrunning.com/athlete-name/">Athlete Name</a> 4. Include notable achievements in parentheses after times (PRs, placements, club records)
You can use the example below to see the desired formatting.
IMPORTANT: Use the exact profile URLs provided in the roster lists below. Each roster line is "Full Name — https://www.grcrunning.com/slug/". Match each athlete in the recap to a roster line and use that exact URL. Do not guess or invent profile URLs. If an athlete in the recap is not in either roster list, still include them but link to their best-guess slug and add a title attribute with their name.
Also give me some suggestions for a good title for the blog post with these results. include mention that these are results from last weekend (whatever those dates are).

Output your response in the following format:
   a. First, provide the formatted WordPress template for the race results inside <formatted_results> tags
   b. Then, list your title suggestions inside <title_suggestions> tags

ROSTERS:

Men's Team:
{mens_roster}

Women's Team:
{womens_roster}

Example: "{example}"

This week's recap to be formatted: "{week_recap}"
`

/** Read the one-shot example from the BLOG_EXAMPLE secret. Throws (loud-fail,
 * surfaced in Telegram) if it isn't configured rather than prompting blind. */
export function getExample(): string {
  const example = (typeof Deno !== 'undefined' ? Deno.env.get('BLOG_EXAMPLE') : undefined)?.trim()
  if (!example) {
    throw new Error(
      'BLOG_EXAMPLE is not configured. Set the formatting example as a function secret ' +
        '(see docs/telegram-bot-setup.md).',
    )
  }
  return example
}

function rosterLines(athletes: Athlete[]): string {
  return athletes.map((a) => `${a.name} — ${a.url}`).join('\n')
}

/** Assemble the full prompt from the live rosters, the example, and the recap.
 * Uses function replacers so any `$` in the recap or example is inserted
 * literally (string replacement would otherwise treat `$&` etc. specially). */
export function buildPrompt(recap: string, mens: Athlete[], womens: Athlete[]): string {
  const example = getExample()
  return PROMPT_TEMPLATE
    .replace('{mens_roster}', () => rosterLines(mens))
    .replace('{womens_roster}', () => rosterLines(womens))
    .replace('{example}', () => example)
    .replace('{week_recap}', () => recap)
}
