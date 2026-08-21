import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  appleShowIdFromUrl,
  episodeNumberFromTitle,
  matchEpisode,
  parseFeed,
  showNameFromShare,
  stripHtml,
  urlsInText,
} from './podcastFeed.js'

const fixture = (name) =>
  readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), 'utf8')

// Two fixtures modelled on real feeds that fail in OPPOSITE directions. The
// shows are invented; every structural quirk below was copied from a live feed,
// because those quirks are the entire reason this module exists.
//
//   numbered — Anchor-hosted. NO <itunes:episode> anywhere; the episode number
//              exists only as a "324." prefix on the title. Descriptions are
//              CDATA-wrapped HTML with nested <p><p> and &#8220; entities.
//   prose    — Simplecast. Titles are plain prose ("The Bone Wars") with no
//              number in them at all; <itunes:episode> is present on some items
//              and absent on others; descriptions carry an ad wrapper.
const NUMBERED = fixture('numbered-feed.xml')
const PROSE = fixture('prose-feed.xml')

describe('parseFeed — a numbered-title feed', () => {
  const feed = parseFeed(NUMBERED)

  it('reads the show title out of the channel, not the first item', () => {
    expect(feed.showTitle).toBe('Long Run Radio')
  })

  it('recovers the episode number from the title when the feed has no episode tag', () => {
    expect(NUMBERED).not.toContain('<itunes:episode>')
    expect(feed.items.map((item) => item.number)).toEqual([324, 323, 319])
  })

  it('carries the fields a capture page needs', () => {
    const [latest] = feed.items
    expect(latest.title).toContain('When Longer Intervals Backfire')
    expect(latest.guid).toBe('9c5f647b-341f-46f7-8c07-1a1275e42f9e')
    expect(latest.pubDate).toBe('Tue, 18 Aug 2026 12:55:36 GMT')
    expect(latest.duration).toBe('01:27:19')
    expect(latest.audioUrl).toMatch(/^https:\/\/anchor\.fm\//)
  })

  it('unwraps CDATA and strips the HTML out of a description', () => {
    const [latest] = feed.items
    expect(latest.description).not.toContain('<p>')
    expect(latest.description).not.toContain('CDATA')
    expect(latest.description).toContain('VO2 slow')
  })
})

describe('parseFeed — an unnumbered-title feed', () => {
  const feed = parseFeed(PROSE)

  it('reads the show title', () => {
    expect(feed.showTitle).toBe('The Quiet Details')
  })

  it('prefers <itunes:episode> where the feed provides it', () => {
    const bones = feed.items.find((item) => item.title === 'The Bone Wars')
    expect(bones.number).toBe(679)
  })

  it('leaves number null where neither the tag nor the title supplies one', () => {
    const objects = feed.items.find((item) => item.title.startsWith('100 Objects'))
    expect(objects.number).toBeNull()
  })

  it('parses guid and link for every item', () => {
    for (const item of feed.items) {
      expect(item.guid).toBeTruthy()
      expect(item.link).toMatch(/^https?:\/\//)
    }
  })
})

describe('parseFeed — junk input', () => {
  it('returns an empty feed rather than throwing', () => {
    expect(parseFeed('').items).toEqual([])
    expect(parseFeed('<rss><channel></channel></rss>').items).toEqual([])
    expect(parseFeed(null).items).toEqual([])
  })
})

describe('episodeNumberFromTitle', () => {
  const cases = [
    ['324. Why Longer Intervals May Be Worse', 324],
    ['Episode 42: Something', 42],
    ['Ep. 7 - A Short One', 7],
    ['#7 - A Short One', 7],
    ['12) Another Format', 12],
    ['No number here', null],
    ['The Bone Wars', null],
    // Years must not read as episode numbers: a mis-read number outranks the
    // title match and would silently save the wrong episode.
    ['2026 In Review', null],
    ['1984: Revisited', null],
    ['', null],
    [null, null],
  ]
  for (const [title, expected] of cases) {
    it(`${JSON.stringify(title)} -> ${expected}`, () => {
      expect(episodeNumberFromTitle(title)).toBe(expected)
    })
  }
})

describe('matchEpisode — the general path: unnumbered titles', () => {
  const { items, showTitle } = parseFeed(PROSE)

  it('matches on the episode page link, which needs no heuristic at all', () => {
    const share = 'Just listened to this\nhttps://quietdetails.example/?p=48275'
    expect(matchEpisode(items, share, { showTitle }).title).toBe('Bamboo Is Innocent')
  })

  it('matches a prose title by word overlap', () => {
    expect(matchEpisode(items, 'The Quiet Details — The Bone Wars', { showTitle }).title).toBe(
      'The Bone Wars',
    )
  })

  it('matches when the share carries the title plus the user\'s own thought', () => {
    const share =
      'The Bone Wars, from The Quiet Details — wild story, want to remember the paleontology feud bit'
    expect(matchEpisode(items, share, { showTitle }).title).toBe('The Bone Wars')
  })

  it('does not let a stray number in the share pick an episode', () => {
    // "#13" is part of a title here, not a selector for episode 13.
    const share = '100 Objects #13: The Sand Letters'
    expect(matchEpisode(items, share, { showTitle }).title).toBe('100 Objects #13: The Sand Letters')
  })
})

describe('matchEpisode — the numbered-feed path', () => {
  const { items, showTitle } = parseFeed(NUMBERED)

  it('matches on an explicit episode number in the share text', () => {
    const share =
      'Long Run Radio\n324. When Longer Intervals Backfire (Sometimes)\nhttps://pca.st/abc'
    expect(matchEpisode(items, share, { showTitle }).number).toBe(324)
  })

  it('matches an older episode by number, not just the newest', () => {
    expect(matchEpisode(items, 'LRR #319 was a good one', { showTitle }).number).toBe(319)
  })

  it('falls back to title overlap when there is no number', () => {
    const share = 'The Theory of Zone Compression, Surgery, and The New Big Supplement'
    expect(matchEpisode(items, share, { showTitle }).number).toBe(323)
  })
})

describe('matchEpisode — refusing to guess', () => {
  const { items } = parseFeed(NUMBERED)

  it('returns null rather than guessing when nothing really matches', () => {
    // Saving the wrong episode confidently is worse than saving no episode.
    expect(matchEpisode(items, 'a completely unrelated conversation about sourdough')).toBeNull()
    expect(matchEpisode(items, 'listen')).toBeNull()
    expect(matchEpisode([], '324. Anything')).toBeNull()
  })

  it('does not match a number that is not in the feed', () => {
    expect(matchEpisode(items, '999. Not A Real Episode')).toBeNull()
  })

  it('prefers a re-release over the original when the share names it', () => {
    // Real shape, from the Huberman Lab feed: an "Essentials:" re-release and
    // the original both contain the entire share text, so both score 1.0 by
    // overlap. The share said "Essentials", which is one extra matched word —
    // without a hit-count tiebreak the tie-guard rejects BOTH and the episode
    // is silently lost.
    const feed = [
      { title: 'Essentials: How to Access Your Creativity | Rick Rubin', number: null },
      { title: 'How to Access Your Creativity | Rick Rubin', number: null },
      { title: 'Protocols to Access Creative Energy and Process | Rick Rubin', number: null },
    ]
    const share = 'Huberman Lab\nEssentials: How to Access Your Creativity | Rick Rubin\nhttps://pca.st/x'
    expect(matchEpisode(feed, share, { showTitle: 'Huberman Lab' }).title).toBe(
      'Essentials: How to Access Your Creativity | Rick Rubin',
    )
  })

  it('picks the original when the share does not say "Essentials"', () => {
    const feed = [
      { title: 'Essentials: How to Access Your Creativity | Rick Rubin', number: null },
      { title: 'How to Access Your Creativity | Rick Rubin', number: null },
    ]
    expect(
      matchEpisode(feed, 'How to Access Your Creativity | Rick Rubin', {
        showTitle: 'Huberman Lab',
      }).title,
    ).toBe('How to Access Your Creativity | Rick Rubin')
  })

  it('refuses a near-tie between two episodes', () => {
    const formulaic = [
      { title: 'Ask Me Anything', number: null },
      { title: 'Ask Me Anything', number: null },
    ]
    expect(matchEpisode(formulaic, 'Ask Me Anything')).toBeNull()
  })
})

describe('appleShowIdFromUrl', () => {
  it('reads the show id, the one show lookup that involves no guessing', () => {
    expect(
      appleShowIdFromUrl('https://podcasts.apple.com/us/podcast/long-run-radio/id1521532868?i=1000717'),
    ).toBe('1521532868')
  })

  it('is null for every other app', () => {
    expect(appleShowIdFromUrl('https://open.spotify.com/episode/xyz')).toBeNull()
    expect(appleShowIdFromUrl('https://pca.st/abc')).toBeNull()
    expect(appleShowIdFromUrl('')).toBeNull()
  })
})

describe('urlsInText', () => {
  it('pulls every link out of a share blob', () => {
    expect(urlsInText('see https://a.example/x and http://b.example/y!')).toEqual([
      'https://a.example/x',
      'http://b.example/y',
    ])
  })

  it('is empty for a plain thought', () => {
    expect(urlsInText('just something I want to remember')).toEqual([])
  })
})

describe('showNameFromShare', () => {
  it('reads the show off its own line in a Podcast Addict share', () => {
    const share = [
      'Long Run Radio',
      '324. When Longer Intervals Backfire (Sometimes)',
      'https://podcastaddict.com/episode/123456',
    ].join('\n')
    expect(showNameFromShare(share)).toBe('Long Run Radio')
  })

  it('reads the show out of a "via" line', () => {
    expect(showNameFromShare('Listening to this via Long Run Radio')).toBe('Long Run Radio')
  })

  it('skips urls', () => {
    expect(showNameFromShare('https://pca.st/abc\nHuberman Lab')).toBe('Huberman Lab')
  })

  it('returns null when there is nothing show-shaped', () => {
    expect(showNameFromShare('https://pca.st/abc')).toBeNull()
    expect(showNameFromShare('')).toBeNull()
  })
})

describe('stripHtml', () => {
  it('keeps paragraph breaks and drops tags', () => {
    expect(stripHtml('<p>One</p><p>Two<br>Three</p>')).toBe('One\n\nTwo\nThree')
  })

  it('is safe on empty input', () => {
    expect(stripHtml(null)).toBe('')
  })
})

describe('showNameFromShare — the Podcast Addict share format (regression)', () => {
  // The share format that shipped broken on 2026-08-20: the "via X" rule
  // grabbed "@PodcastAddict" (the APP), iTunes returned a junk feed titled
  // "ADDICTPODICK", and no episode could ever match because we were searching
  // the wrong show's feed entirely.
  //
  // Invented show and episode, real SHAPE — the bracketed prefix, the app's own
  // URL layout, and the trailing "via @PodcastAddict" are what the parser has to
  // survive, and none of them depend on which podcast it was.
  const ADDICT_SHARE = [
    '[The Long Way Round Podcast] Episode 645: A First Marathon That Did Not Go To Plan',
    'https://podcastaddict.com/the-long-way-round-podcast/episode/208768275 via @PodcastAddict',
    '',
    'A line of my own thoughts about the episode goes here.',
  ].join('\n')

  it('reads the show out of the bracketed prefix', () => {
    expect(showNameFromShare(ADDICT_SHARE)).toBe('The Long Way Round Podcast')
  })

  it('never returns the sharing app', () => {
    expect(showNameFromShare(ADDICT_SHARE)).not.toContain('PodcastAddict')
    expect(showNameFromShare(ADDICT_SHARE)).not.toContain('@')
  })

  it('still finds the episode number in the same share', () => {
    // Guards the other half of the chain: with the right feed, 645 is what
    // selects the episode.
    expect(/(?:^|\s)(?:#|ep\.?\s*|episode\s*)(\d{1,4})\b/i.exec(ADDICT_SHARE)[1]).toBe('645')
  })
})

describe('showNameFromShare — sharing apps are never the show', () => {
  for (const app of ['@PodcastAddict', 'Spotify', 'Overcast', 'Pocket Casts', 'Apple Podcasts']) {
    it(`rejects "${app}"`, () => {
      expect(showNameFromShare(`Some Episode Title\nhttps://x.example/y via ${app}`)).not.toBe(app)
    })
  }

  it('still accepts a genuine "via <show>"', () => {
    expect(showNameFromShare('Listening to this via Long Run Radio')).toBe('Long Run Radio')
  })

  it('does not treat "on" as an attribution word', () => {
    // "on" appears inside episode titles constantly. The old rule turned this
    // line into a search for the show "Chicago Marathon"; now the line is
    // recognized as an episode title and skipped, leaving no show name at all —
    // which is the honest answer here.
    expect(showNameFromShare('Ep 12: Notes on Chicago Marathon')).not.toBe('Chicago Marathon')
    expect(showNameFromShare('Ep 12: Notes on Chicago Marathon')).toBeNull()
  })
})
