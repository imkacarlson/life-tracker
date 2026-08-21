// Podcast resolution: turn whatever a podcast app put on the clipboard into a
// specific episode of a specific feed.
//
// The insight this is built on: it does not matter which app the share came
// from. Apple, Spotify, Overcast, Pocket Casts, and Podcast Addict all play the
// same RSS feed, so resolving <show> -> feed URL -> episode makes every app work
// at once. The show -> feed lookup is the free iTunes Search API (no key).
//
// GENERALITY NOTE: podcasts vary wildly in how they identify an episode. Some
// set <itunes:episode>, some prefix the title ("324. …"), many do neither. So
// matching goes URL -> explicit number -> title overlap, and TITLE OVERLAP is
// the path that has to carry most feeds. Episode numbers are a bonus, not the
// mechanism.
//
// Pure parsing lives here so it can be unit-tested against real feed fixtures;
// the network calls live in api/fetch-source.js. See canonicalUrl.js for why
// this is api/_lib/ JS rather than supabase/functions/_shared/ TypeScript.

/** Unwrap CDATA and decode the handful of entities that actually show up. */
function decodeXmlText(raw) {
  if (!raw) return ''
  let text = String(raw)
  text = text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_m, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&')
    .trim()
}

function tagText(xml, tag) {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i').exec(xml)
  return match ? decodeXmlText(match[1]) : ''
}

function attr(xml, tag, name) {
  const match = new RegExp(`<${tag}\\s[^>]*${name}="([^"]*)"`, 'i').exec(xml)
  return match ? match[1] : ''
}

/** Strip the HTML that podcast descriptions are full of, keeping paragraph breaks. */
export function stripHtml(html) {
  return String(html ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim()
}

/**
 * The leading "324." in an episode title, for the feeds that do number that way.
 *
 * Rejects four-digit years so "2026 In Review" and "1984, Revisited" don't read
 * as episodes 2026 and 1984 — a mis-read number would beat the title match and
 * silently save the wrong episode.
 */
export function episodeNumberFromTitle(title) {
  const match = /^\s*(?:episode\s*|ep\.?\s*)?#?(\d{1,4})\s*[.:)\]\-–—]\s*\S/i.exec(String(title ?? ''))
  if (!match) return null
  const value = Number(match[1])
  if (value >= 1900 && value <= 2100) return null
  return value
}

/** Any http(s) URLs in a blob of share text, without trailing sentence punctuation. */
export function urlsInText(text) {
  const found = String(text ?? '').match(/https?:\/\/[^\s<>"')]+/gi) ?? []
  return found.map((url) => url.replace(/[.,;:!?]+$/, ''))
}

/**
 * The Apple Podcasts show id in a share URL (`…/id1521532868?i=…`).
 *
 * Worth a special case because it is the one show-resolution path that involves
 * no guessing at all: iTunes can be looked up by this id directly, where every
 * other app's URL forces a search on the show's name.
 */
export function appleShowIdFromUrl(url) {
  const match = /podcasts\.apple\.com\/[^\s]*\/id(\d+)/i.exec(String(url ?? ''))
  return match ? match[1] : null
}

/** Parse an RSS feed into { showTitle, items }. Order is feed order (newest first). */
export function parseFeed(xml) {
  const source = String(xml ?? '')
  const firstItem = source.indexOf('<item>')
  const channelHead = firstItem === -1 ? source : source.slice(0, firstItem)
  const showTitle = tagText(channelHead, 'title')

  const items = []
  for (const match of source.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const raw = match[1]
    const title = tagText(raw, 'title')
    const explicitNumber = tagText(raw, 'itunes:episode')
    items.push({
      title,
      // <itunes:episode> is authoritative where it exists; the title prefix is
      // the fallback for feeds (like every Anchor-hosted one) that omit it.
      number: explicitNumber ? Number(explicitNumber) : episodeNumberFromTitle(title),
      guid: tagText(raw, 'guid') || null,
      pubDate: tagText(raw, 'pubDate') || null,
      link: tagText(raw, 'link') || null,
      audioUrl: attr(raw, 'enclosure', 'url') || null,
      duration: tagText(raw, 'itunes:duration') || null,
      description: stripHtml(tagText(raw, 'description')),
    })
  }

  return { showTitle, items }
}

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'at', 'is', 'are',
  'was', 'were', 'be', 'with', 'from', 'by', 'my', 'our', 'your', 'it', 'its',
  'this', 'that', 'how', 'why', 'what', 'when', 'who',
  // Share-blob furniture, not content.
  'episode', 'ep', 'podcast', 'podcasts', 'listen', 'listening', 'check', 'out',
  'via', 'shared', 'share', 'spotify', 'apple', 'overcast', 'pocket', 'casts',
])

function significantWords(text, extraStopWords) {
  return String(text ?? '')
    // URLs are chrome, and their path segments ("pca", "abc", "episodes") are
    // noise that dilutes the overlap score on every feed. Drop them before
    // tokenizing rather than hoping the threshold absorbs them.
    .replace(/https?:\/\/\S+/gi, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(
      (word) =>
        word.length > 2 && !STOP_WORDS.has(word) && !(extraStopWords?.has(word) ?? false),
    )
}

/** Does this share text point at this exact item's page or guid? */
function linkMatches(item, shareUrls) {
  if (!shareUrls.length) return false
  const candidates = [item.link, item.guid, item.audioUrl].filter(Boolean).map((v) => v.toLowerCase())
  if (!candidates.length) return false
  return shareUrls.some((url) => {
    const lower = url.toLowerCase().replace(/[.,)]+$/, '')
    return candidates.some((candidate) => candidate === lower || candidate.startsWith(lower))
  })
}

/**
 * Find the episode a share refers to. Returns null rather than guessing.
 *
 * Order is deliberate, most-reliable first:
 *   1. A URL in the share that IS this episode's page/guid. Exact, and the one
 *      signal that needs no heuristic at all.
 *   2. An explicit episode number that the feed actually uses.
 *   3. Word overlap between the share text and the episode title. This is the
 *      general path — most podcasts do not number their episodes anywhere.
 *
 * A wrong episode saved confidently is worse than saving the show, the link, and
 * the user's note with no episode attached, so a weak match yields null.
 */
export function matchEpisode(items, shareText, { showTitle } = {}) {
  const list = Array.isArray(items) ? items : []
  if (!list.length) return null

  const text = String(shareText ?? '')

  // The show's own name appears in nearly every share ("Long Run Radio\n324.
  // …"), and it is by definition the same for every episode — so it can only
  // dilute the score, never discriminate. Drop it from both sides when we know
  // it. Pass parseFeed()'s showTitle to get this; it is optional so callers that
  // only have a list of items still work.
  const showWords = new Set(showTitle ? significantWords(showTitle) : [])

  // 1. Exact link / guid.
  const shareUrls = urlsInText(text)
  const byLink = list.find((item) => linkMatches(item, shareUrls))
  if (byLink) return byLink

  // 2. Explicit number — only trusted when the feed is actually numbered, so a
  //    stray "2 hours" or "top 5" in the share can't select an episode.
  const feedIsNumbered = list.some((item) => Number.isFinite(item.number))
  if (feedIsNumbered) {
    const shareNumber =
      episodeNumberFromTitle(text) ??
      Number(/(?:^|\s)(?:#|ep\.?\s*|episode\s*)(\d{1,4})\b/i.exec(text)?.[1])
    if (Number.isFinite(shareNumber)) {
      const byNumber = list.find((item) => item.number === shareNumber)
      if (byNumber) return byNumber
    }
  }

  // 3. Title overlap — the path that carries unnumbered feeds.
  const shareWords = new Set(significantWords(text, showWords))
  // A single content word is never enough to name an episode. Two can be, once
  // the show name and URLs are stripped out ("The Bone Wars" -> bone, wars) —
  // the real strength guard is the >=2 hits and the near-tie check below.
  if (shareWords.size < 2) return null

  // Each candidate gets a three-key rank, compared left to right:
  //
  //   1. overlap  hits over the SMALLER of the two word sets. Both sides get
  //               truncated in practice, and normalizing by either one alone
  //               breaks a real case: a share carrying only the first half of a
  //               long title scores badly against the title's length, and a
  //               chatty share with the user's own thought in it scores badly
  //               against its own length.
  //   2. hits     raw matched-word count. Load-bearing for re-releases: an
  //               "Essentials:"/rebroadcast edition and the original both
  //               contain the whole share, so both hit overlap 1.0 — but the
  //               re-release matches one MORE word, and that word ("essentials")
  //               is exactly what the user's share used to tell them apart.
  //   3. tightness hits over the TITLE's length, i.e. how little of the title
  //               went unmatched. Resolves the same pair in the other
  //               direction: a share WITHOUT "essentials" fits the original
  //               exactly and the re-release with one word left over.
  //
  // A dead tie on all three means the share genuinely doesn't distinguish the
  // two (formulaic titles like "Ask Me Anything #…"), and guessing there would
  // file the wrong episode — so that returns null.
  let best = null
  let bestRank = [0, 0, 0]
  let tied = false

  const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]

  for (const item of list) {
    const titleWords = new Set(significantWords(item.title, showWords))
    if (!titleWords.size) continue
    let hits = 0
    for (const word of titleWords) if (shareWords.has(word)) hits += 1
    if (hits < 2) continue

    const rank = [
      hits / Math.min(titleWords.size, shareWords.size),
      hits,
      hits / titleWords.size,
    ]
    const delta = compare(rank, bestRank)
    if (delta > 0) {
      tied = false
      best = item
      bestRank = rank
    } else if (delta === 0 && best) {
      tied = true
    }
  }

  // Under half the smaller set in common is a coincidence, not a match.
  if (bestRank[0] < 0.5) return null
  if (tied) return null
  return best
}

// The SHARING APP is not the show. Podcast Addict signs its shares
// "via @PodcastAddict", and a naive "via X" rule reads that as the podcast's
// name — which then resolves to whatever junk feed iTunes returns for it.
// That is not hypothetical: it shipped, and searching iTunes for
// "@PodcastAddict" returned a feed literally titled "ADDICTPODICK".
const SHARING_APPS = [
  'podcastaddict', 'podcast addict', 'spotify', 'overcast', 'pocketcasts',
  'pocket casts', 'apple podcasts', 'applepodcasts', 'castbox', 'playerfm',
  'player fm', 'podbean', 'stitcher', 'iheartradio', 'iheart', 'deezer',
  'audible', 'amazon music', 'youtube music', 'podcast republic', 'antennapod',
  'castro', 'downcast', 'breaker', 'anchor',
]

function isSharingApp(candidate) {
  const clean = String(candidate ?? '').trim().toLowerCase()
  // A Telegram/social handle is always an attribution, never a show name.
  if (clean.startsWith('@')) return true
  const squashed = clean.replace(/[^a-z0-9]/g, '')
  return SHARING_APPS.some((app) => squashed === app.replace(/[^a-z0-9]/g, ''))
}

/**
 * Guess the show name from a share blob, for the iTunes search.
 *
 * Only used when the share carries no Apple show id (see appleShowIdFromUrl),
 * which is the deterministic path.
 *
 * Ordered most- to least-reliable:
 *   1. "[Show Name] Episode 645: …" — a bracketed prefix is unambiguous, and it
 *      is what Podcast Addict (among others) actually emits.
 *   2. "… via X" / "… from X" — but never when X is the sharing app itself.
 *   3. The first line that is neither a URL nor the episode title.
 */
export function showNameFromShare(shareText) {
  const lines = String(shareText ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  // 1. Bracketed show prefix.
  for (const line of lines) {
    const bracket = /^\[([^\]]{2,90})\]/.exec(line)
    if (bracket?.[1]?.trim()) return bracket[1].trim()
  }

  // 2. "via"/"from" attribution. "on" is deliberately NOT a trigger — it is far
  //    too common inside episode titles ("... on Chicago Marathon") to be a
  //    reliable signal.
  for (const line of lines) {
    const viaMatch = /(?:^|\s)(?:via|from)\s+(.+?)(?:\s*[-–—|]\s*.*)?$/i.exec(line)
    const candidate = viaMatch?.[1]?.trim()
    if (!candidate) continue
    if (/^https?:/i.test(candidate)) continue
    if (isSharingApp(candidate)) continue
    return candidate
  }

  // 3. Otherwise: the first line that isn't a URL and isn't the episode title.
  for (const line of lines) {
    if (/^https?:/i.test(line)) continue
    if (episodeNumberFromTitle(line) != null) continue
    if (line.length > 80) continue
    return line
  }
  return null
}
