// Live GRC team-roster fetcher.
//
// The original .flo hard-coded the rosters, which went stale and produced broken
// profile links for athletes who weren't in the list. Instead we fetch the two
// public roster pages and parse the athlete anchors at request time, so links are
// always current. Parsed with a regex (no cheerio dependency in the Deno runtime).

export type Athlete = { name: string; url: string }

const WOMENS_URL = 'https://www.grcrunning.com/womens-team/'
const MENS_URL = 'https://www.grcrunning.com/mens-team/'

// Each athlete entry on both pages is a figure: an anchor wrapping the headshot
// <img>, immediately followed by a <figcaption> holding the full name, e.g.
//   <a href="https://www.grcrunning.com/jane-doe/"><img .../></a>
//   <figcaption class="wp-element-caption">Jane Doe</figcaption>
// The href is tolerant of http/https and an optional www. (some entries use the
// irregular `http://grcrunning.com/jane-doe/` form); nav/footer links lack the
// img+figcaption wrapper and are naturally excluded.
const ATHLETE_RE =
  /<a href="https?:\/\/(?:www\.)?grcrunning\.com\/([a-z0-9-]+)\/"><img[^>]*><\/a><figcaption[^>]*>([^<]+)<\/figcaption>/g

// A real layout change (or a fetch that returns an error page) should fail loudly
// rather than silently producing a near-empty post. Both rosters comfortably
// exceed this.
const MIN_ROSTER = 10

/** Decode the handful of HTML entities that can appear in athlete names. */
function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;/g, "'")
    .replace(/&#8217;|&rsquo;/g, '’')
    .replace(/&#8216;|&lsquo;/g, '‘')
    .trim()
}

/** Parse one roster page's HTML into `{ name, url }[]`, deduped by slug. */
export function parseRoster(html: string): Athlete[] {
  const bySlug = new Map<string, Athlete>()
  for (const match of html.matchAll(ATHLETE_RE)) {
    const slug = match[1]
    const name = decodeEntities(match[2])
    if (!name) continue
    // Normalize every profile URL to the canonical https://www form so links are
    // consistent regardless of how the source page wrote them.
    bySlug.set(slug, { name, url: `https://www.grcrunning.com/${slug}/` })
  }
  return [...bySlug.values()]
}

async function fetchRoster(url: string, label: string): Promise<Athlete[]> {
  const resp = await fetch(url)
  if (!resp.ok) {
    throw new Error(`Failed to fetch ${label} roster (${resp.status})`)
  }
  const html = await resp.text()
  const athletes = parseRoster(html)
  if (athletes.length < MIN_ROSTER) {
    throw new Error(
      `Parsed only ${athletes.length} ${label} athletes (expected >= ${MIN_ROSTER}); ` +
        'the roster page layout may have changed.',
    )
  }
  return athletes
}

/** Fetch both rosters in parallel. Throws on any HTTP/parse/size problem. */
export async function fetchRosters(): Promise<{ mens: Athlete[]; womens: Athlete[] }> {
  const [mens, womens] = await Promise.all([
    fetchRoster(MENS_URL, "men's"),
    fetchRoster(WOMENS_URL, "women's"),
  ])
  return { mens, womens }
}
