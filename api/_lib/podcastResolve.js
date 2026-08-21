// Network side of podcast resolution. Split from podcastFeed.js so that file
// stays pure and unit-testable; everything here does I/O.
//
// Show -> feed uses the free iTunes Search API (no key, no account). Every
// podcast in every app is in that directory, and they all point at the same RSS
// feed, which is what makes "share from whatever app I'm using" work.

import { matchEpisode, parseFeed, showNameFromShare, appleShowIdFromUrl, urlsInText } from './podcastFeed.js'
import { podcastCanonicalKey } from './canonicalUrl.js'

const ITUNES_SEARCH = 'https://itunes.apple.com/search'
const ITUNES_LOOKUP = 'https://itunes.apple.com/lookup'
const FETCH_TIMEOUT_MS = 12_000

// Hosts whose links are unambiguously a podcast episode. An unknown podcast app
// simply falls through to the article path, which fetches its episode page —
// degraded, not broken, so this list never has to be exhaustive.
const PODCAST_HOSTS = [
  'podcasts.apple.com',
  'podcast.apple.com',
  'open.spotify.com/episode',
  'open.spotify.com/show',
  'pca.st',
  'pcast.link',
  'overcast.fm',
  'podcastaddict.com',
  'castbox.fm',
  'player.fm',
  'podbean.com',
  'anchor.fm',
  'podcasters.spotify.com',
  'iheart.com/podcast',
  'music.amazon.com/podcasts',
  'podcastrepublic.net',
  'radiopublic.com',
  'listennotes.com',
  'podchaser.com',
  'youtube.com/podcast',
  'deezer.com/show',
  'audible.com/pd',
]

/** Does this share text point at a podcast episode? */
export function looksLikePodcast(text) {
  const haystack = String(text ?? '').toLowerCase()
  return PODCAST_HOSTS.some((host) => haystack.includes(host))
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Resolve a show to its RSS feed.
 *
 * An Apple share carries the show's numeric id, which is an exact lookup with no
 * guessing at all — always prefer it. Everything else falls back to searching
 * iTunes by the show's name as it appears in the share text.
 */
export async function resolveFeedUrl(shareText) {
  const urls = urlsInText(shareText)
  const appleId = urls.map(appleShowIdFromUrl).find(Boolean)

  if (appleId) {
    const resp = await fetchWithTimeout(`${ITUNES_LOOKUP}?id=${appleId}&entity=podcast`)
    if (resp.ok) {
      const data = await resp.json().catch(() => null)
      const hit = data?.results?.find((r) => r.feedUrl)
      if (hit?.feedUrl) return { feedUrl: hit.feedUrl, showName: hit.collectionName ?? null }
    }
  }

  const showName = showNameFromShare(shareText)
  if (!showName) return null

  const params = new URLSearchParams({ term: showName, entity: 'podcast', limit: '5' })
  const resp = await fetchWithTimeout(`${ITUNES_SEARCH}?${params}`)
  if (!resp.ok) return null
  const data = await resp.json().catch(() => null)
  const hit = data?.results?.find((r) => r.feedUrl)
  if (!hit?.feedUrl) return null
  return { feedUrl: hit.feedUrl, showName: hit.collectionName ?? showName }
}

// A description this short isn't the episode's content, it's a stub.
const THIN_DESCRIPTION_CHARS = 200

/**
 * Resolve a podcast share into a capture.
 *
 * Returns the same envelope as the article path so the caller never branches:
 * `status` is 'ok' | 'thin' | 'error', and anything but 'ok' means the bot tells
 * the user what it couldn't read.
 */
export async function resolvePodcast(shareText) {
  const resolved = await resolveFeedUrl(shareText).catch(() => null)
  if (!resolved?.feedUrl) {
    return {
      status: 'error',
      sourceType: 'podcast',
      error: 'Could not work out which podcast this is.',
    }
  }

  const feedResp = await fetchWithTimeout(resolved.feedUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LifeTracker/1.0)' },
    timeoutMs: 20_000,
  }).catch(() => null)

  if (!feedResp?.ok) {
    return {
      status: 'error',
      sourceType: 'podcast',
      error: `Found the show but its feed didn't load (${feedResp?.status ?? 'network error'}).`,
      meta: { feedUrl: resolved.feedUrl, showName: resolved.showName },
    }
  }

  const { showTitle, items } = parseFeed(await feedResp.text())
  const episode = matchEpisode(items, shareText, { showTitle: showTitle || resolved.showName })

  const meta = {
    feedUrl: resolved.feedUrl,
    site: showTitle || resolved.showName || null,
    showName: showTitle || resolved.showName || null,
  }

  if (!episode) {
    // The show resolved but the episode didn't. Say so — a capture filed under
    // the wrong episode is worse than one with no episode attached.
    return {
      status: 'thin',
      sourceType: 'podcast',
      title: meta.showName,
      markdown: '',
      meta,
      error: 'Matched the show but not the specific episode.',
    }
  }

  Object.assign(meta, {
    episodeNumber: episode.number ?? null,
    episodeGuid: episode.guid,
    published: episode.pubDate,
    duration: episode.duration,
    audioUrl: episode.audioUrl,
    episodeUrl: episode.link,
  })

  const description = episode.description ?? ''
  return {
    status: description.length >= THIN_DESCRIPTION_CHARS ? 'ok' : 'thin',
    sourceType: 'podcast',
    title: episode.title,
    url: episode.link ?? urlsInText(shareText)[0] ?? null,
    canonicalUrl: podcastCanonicalKey(resolved.feedUrl, episode),
    markdown: description,
    meta,
    ...(description.length >= THIN_DESCRIPTION_CHARS
      ? {}
      : { error: 'The episode description is very short.' }),
  }
}
