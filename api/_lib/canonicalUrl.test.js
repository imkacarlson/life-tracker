import { describe, expect, it } from 'vitest'

import { canonicalizeUrl, podcastCanonicalKey } from './canonicalUrl.js'

describe('canonicalizeUrl', () => {
  const cases = [
    ['plain url is unchanged', 'https://example.com/post', 'https://example.com/post'],
    ['host is lowercased', 'https://Example.COM/Post', 'https://example.com/Post'],
    ['www is dropped', 'https://www.example.com/post', 'https://example.com/post'],
    ['http becomes https', 'http://example.com/post', 'https://example.com/post'],
    ['fragment is dropped', 'https://example.com/post#section-2', 'https://example.com/post'],
    [
      'trailing slash is dropped on a path',
      'https://example.com/post/',
      'https://example.com/post',
    ],
    ['root slash is kept', 'https://example.com/', 'https://example.com/'],
    [
      'utm params are stripped',
      'https://example.com/post?utm_source=twitter&utm_medium=social',
      'https://example.com/post',
    ],
    [
      'click ids are stripped',
      'https://example.com/post?fbclid=abc&gclid=def&igshid=ghi',
      'https://example.com/post',
    ],
    [
      'a spotify share token is stripped',
      'https://open.spotify.com/episode/xyz?si=8f2a',
      'https://open.spotify.com/episode/xyz',
    ],
    [
      'meaningful params survive and are sorted',
      'https://example.com/watch?v=abc123&utm_source=x&t=90',
      'https://example.com/watch?t=90&v=abc123',
    ],
    [
      'two links to the same page collapse to one key',
      'https://WWW.Example.com/post/?utm_campaign=newsletter#top',
      'https://example.com/post',
    ],
  ]

  for (const [name, input, expected] of cases) {
    it(name, () => {
      expect(canonicalizeUrl(input)).toBe(expected)
    })
  }

  it('keeps the Apple Podcasts episode id, which is not tracking', () => {
    expect(
      canonicalizeUrl('https://podcasts.apple.com/us/podcast/some-work-all-play/id1521532868?i=1000717&uo=4'),
    ).toBe('https://podcasts.apple.com/us/podcast/some-work-all-play/id1521532868?i=1000717')
  })

  it('returns null for things that are not http(s) urls', () => {
    expect(canonicalizeUrl('')).toBeNull()
    expect(canonicalizeUrl(null)).toBeNull()
    expect(canonicalizeUrl('just a thought, no link')).toBeNull()
    expect(canonicalizeUrl('mailto:someone@example.com')).toBeNull()
    expect(canonicalizeUrl('javascript:alert(1)')).toBeNull()
  })
})

describe('podcastCanonicalKey', () => {
  const FEED = 'https://anchor.fm/s/1a2b3c4/podcast/rss'

  it('keys on the feed plus the episode guid', () => {
    expect(podcastCanonicalKey(FEED, { guid: 'abc-123', number: 324 })).toBe(
      'podcast:https://anchor.fm/s/1a2b3c4/podcast/rss:abc-123',
    )
  })

  it('falls back to the episode number when there is no guid', () => {
    expect(podcastCanonicalKey(FEED, { number: 324 })).toBe(
      'podcast:https://anchor.fm/s/1a2b3c4/podcast/rss:ep324',
    )
  })

  it('gives the same key no matter which app the share came from', () => {
    // The whole point: Apple, Spotify, and Podcast Addict all resolve to one feed.
    const fromApple = podcastCanonicalKey(FEED, { guid: 'abc-123' })
    const fromSpotify = podcastCanonicalKey(`${FEED}?si=xyz`, { guid: 'abc-123' })
    expect(fromApple).toBe(fromSpotify)
  })

  it('returns null when the episode cannot be identified', () => {
    expect(podcastCanonicalKey(FEED, {})).toBeNull()
    expect(podcastCanonicalKey('', { guid: 'abc' })).toBeNull()
  })
})
