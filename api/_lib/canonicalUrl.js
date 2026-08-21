// The dedup key behind "I already have this one".
//
// Lives in api/_lib/ (not supabase/functions/_shared/) for the same reason
// hydrateImages.js does: this is Vercel-side Node code, and raw Node ESM can't
// resolve the .ts modules the edge functions import. There is exactly ONE
// implementation — api/fetch-source.js returns `canonicalUrl` in its response
// and the Telegram bot stores that value verbatim, so the bot never
// canonicalizes anything itself and the two can't drift.
//
// Pure: no I/O, no env. Unit-tested in canonicalUrl.test.js.

// Params that identify the *referrer*, never the content. Two shapes: exact
// names, and the utm_ / mtm_ / pk_ analytics prefixes.
const TRACKING_PARAMS = new Set([
  'fbclid',
  'gclid',
  'dclid',
  'gbraid',
  'wbraid',
  'msclkid',
  'twclid',
  'igshid',
  'igsh',
  'mc_cid',
  'mc_eid',
  'oly_enc_id',
  'oly_anon_id',
  '_branch_match_id',
  '_bhlid',
  'ref',
  'ref_src',
  'ref_url',
  'referrer',
  'source',
  'src',
  'cmpid',
  'campaign_id',
  'sms_ss',
  'at_xt',
  'ito',
  'ncid',
  'spm',
  'scwid',
  // Spotify / Apple share tokens. `si` is a share-session id, not the track.
  'si',
  'nd',
  'uo',
  'app',
  // NOT stripped, deliberately: Apple Podcasts puts the EPISODE id in `?i=`.
  // Dropping it would collapse every episode of a show onto one canonical URL —
  // i.e. the second episode you ever saved would look like a duplicate.
])

const TRACKING_PREFIXES = ['utm_', 'mtm_', 'pk_', 'piwik_', 'hsa_', '_hs']

function isTrackingParam(name) {
  const lower = name.toLowerCase()
  if (TRACKING_PARAMS.has(lower)) return true
  return TRACKING_PREFIXES.some((prefix) => lower.startsWith(prefix))
}

/**
 * Normalize a URL into a stable dedup key.
 *
 * Lowercases the host, drops a leading `www.`, drops the fragment, strips
 * tracking params, sorts what's left, and removes a trailing slash on a
 * non-root path. Returns null for anything that isn't a parseable http(s) URL —
 * a null canonical_url means "don't dedup this", which is the safe default.
 */
export function canonicalizeUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null

  let url
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null

  const host = url.hostname.toLowerCase().replace(/^www\./, '')

  const kept = []
  for (const [name, value] of url.searchParams.entries()) {
    if (!isTrackingParam(name)) kept.push([name, value])
  }
  kept.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const query = kept.length
    ? `?${kept.map(([n, v]) => `${encodeURIComponent(n)}=${encodeURIComponent(v)}`).join('&')}`
    : ''

  let path = url.pathname
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1)

  // Scheme is normalized to https: http:// and https:// of the same page are
  // the same page, and treating them as two captures would be a bug.
  const port = url.port && url.port !== '80' && url.port !== '443' ? `:${url.port}` : ''
  return `https://${host}${port}${path}${query}`
}

/**
 * The dedup key for a podcast episode.
 *
 * Deliberately NOT the share URL: the same episode arrives with a different URL
 * from Apple, Spotify, Overcast, and Podcast Addict. They all play one feed, so
 * the feed URL plus the episode's own identity is the thing that's actually
 * stable. Prefers the RSS <guid>, falling back to the episode number.
 */
export function podcastCanonicalKey(feedUrl, episode) {
  const feedKey = canonicalizeUrl(feedUrl) ?? String(feedUrl ?? '').trim()
  if (!feedKey) return null
  const identity = episode?.guid || (episode?.number != null ? `ep${episode.number}` : '')
  if (!identity) return null
  return `podcast:${feedKey}:${identity}`
}
