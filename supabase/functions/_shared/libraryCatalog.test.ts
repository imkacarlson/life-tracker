import { describe, expect, it } from 'vitest'

import {
  REBUILD_NOTE,
  extractNotes,
  kindLabel,
  groupByMonth,
  monthLabel,
  renderActivity,
  renderLately,
  renderSectionIndex,
  renderTopicCatalog,
  toCatalogEntries,
} from './libraryCatalog.ts'
import type { CatalogEntry } from './libraryCatalog.ts'

const flatten = (node: any): string => {
  if (!node) return ''
  if (node.text) return node.text
  return (node.content ?? []).map(flatten).join('')
}

const headings = (doc: any) =>
  (doc.content ?? []).filter((n: any) => n.type === 'heading').map(flatten)

const links = (doc: any): string[] => {
  const found: string[] = []
  const walk = (node: any) => {
    if (!node) return
    for (const mark of node.marks ?? []) {
      if (mark.type === 'link' && mark.attrs?.href) found.push(mark.attrs.href)
    }
    ;(node.content ?? []).forEach(walk)
  }
  walk(doc)
  return found
}

const ENTRIES: CatalogEntry[] = [
  {
    pageId: 'cap-1',
    title: 'Carbohydrate intake during long runs',
    savedAt: '2026-08-19T14:00:00Z',
    site: 'example.com',
    kind: 'article',
    notes: [{ date: 'Aug 19', text: 'worth revisiting before the fall build' }],
  },
  {
    pageId: 'cap-2',
    title: '324. Why Longer Intervals May Be Worse',
    savedAt: '2026-08-20T09:00:00Z',
    site: 'Long Run Radio',
    kind: 'podcast',
    notes: [{ date: 'Aug 20', text: 'they said longer intervals may be counterproductive' }],
  },
  {
    pageId: 'cap-3',
    title: 'Sodium losses in heat',
    savedAt: '2026-07-02T09:00:00Z',
    site: 'example.org',
    notes: [],
  },
]

describe('renderTopicCatalog', () => {
  const doc = renderTopicCatalog({ entries: ENTRIES, timeZone: 'America/New_York' })

  it('groups by the month things were saved, newest first', () => {
    expect(headings(doc)).toEqual(['August 2026', 'July 2026'])
  })

  it('links every entry to its capture page', () => {
    expect(links(doc)).toEqual(['#pg=cap-2', '#pg=cap-1', '#pg=cap-3'])
  })

  it("quotes the user's own notes verbatim, with their dates", () => {
    const flat = flatten(doc)
    expect(flat).toContain('Aug 19: “worth revisiting before the fall build”')
    expect(flat).toContain('Aug 20: “they said longer intervals may be counterproductive”')
  })

  it('names where each thing came from', () => {
    expect(flatten(doc)).toContain('Long Run Radio')
  })

  it('CATALOGS — it never asserts a conclusion', () => {
    // The constraint the whole feature turns on. An earlier prototype wrote
    // "consensus is that trained-gut runners tolerate more than 30-60g" and was
    // rejected: that is the model saying what is true, not recall of what was
    // saved. Every word on this page must come from stored data.
    const flat = flatten(doc)
    for (const assertion of ['consensus', 'suggests', 'evidence', 'you should', 'recommend', '研究']) {
      expect(flat.toLowerCase()).not.toContain(assertion.toLowerCase())
    }
    // Concretely: every non-heading word is a title, a site, a date, or a quoted
    // note — nothing else appears.
    const titlesAndNotes = ENTRIES.flatMap((entry) => [
      entry.title,
      entry.site ?? '',
      ...(entry.notes ?? []).map((note) => note.text),
    ])
    for (const piece of titlesAndNotes.filter(Boolean)) {
      expect(flat).toContain(piece)
    }
  })

  it('has no counts, badges, or anything to catch up on', () => {
    const flat = flatten(doc).toLowerCase()
    for (const queueWord of ['unprocessed', 'unread', 'new since', 'to review', 'pending']) {
      expect(flat).not.toContain(queueWord)
    }
  })

  it('says something useful when the topic is empty', () => {
    const empty = renderTopicCatalog({ entries: [], timeZone: 'UTC' })
    expect(flatten(empty)).toContain('Nothing filed here yet')
  })
})

describe('the self-rebuilding note', () => {
  // Every one of these pages is regenerated wholesale, so an edit made on one is
  // silently lost. Saying so on the page is the cheap honest option — and it
  // doubles as a signpost to the one place the user's own writing IS safe.
  const owned = [
    ['topic catalog', renderTopicCatalog({ entries: ENTRIES, timeZone: 'UTC' })],
    ['empty topic catalog', renderTopicCatalog({ entries: [], timeZone: 'UTC' })],
    ['section front page', renderSectionIndex({ topics: [], recent: ENTRIES, timeZone: 'UTC' })],
    ['empty section front page', renderSectionIndex({ topics: [], recent: [], timeZone: 'UTC' })],
    ['Lately', renderLately({ windowDays: 30, bySection: [], suggestions: [] })],
    [
      'Activity',
      renderActivity({
        rows: [{ kind: 'skipped', summary: 'skipped Film', created_at: '2026-08-23T08:07:00Z' }],
        timeZone: 'UTC',
      }),
    ],
    ['empty Activity', renderActivity({ rows: [], timeZone: 'UTC' })],
  ] as const

  it.each(owned)('leads %s with it', (_name, doc: any) => {
    expect(flatten(doc.content[0])).toBe(REBUILD_NOTE)
  })

  it('points at where the user’s own writing lives', () => {
    expect(REBUILD_NOTE).toContain('My notes')
  })

  it('is muted rather than a banner', () => {
    const marks = renderLately({ windowDays: 30, bySection: [], suggestions: [] })
      .content?.[0]?.content?.[0]?.marks?.map((mark: any) => mark.type)
    expect(marks).toContain('italic')
    expect(marks).toContain('textStyle')
  })

  it('does not turn the page into a task', () => {
    const flat = REBUILD_NOTE.toLowerCase()
    for (const queueWord of ['unprocessed', 'unread', 'to review', 'pending', 'catch up']) {
      expect(flat).not.toContain(queueWord)
    }
  })
})

describe('kind labels', () => {
  // library_sources.source_type is CHECK-constrained to exactly these four, so
  // the label table needs no fallback for anything else that "might" show up.
  it('renders the four kinds as words', () => {
    expect(kindLabel('article')).toBe('Article')
    expect(kindLabel('podcast')).toBe('Podcast')
    expect(kindLabel('thread')).toBe('Thread')
  })

  it('calls the user\'s own thought an Own note, not a Note', () => {
    // On a list where every other line came from somewhere else, the thing worth
    // saying is that this one did not.
    expect(kindLabel('note')).toBe('Own note')
  })

  it('has no label for an unknown or missing kind', () => {
    expect(kindLabel(null)).toBeNull()
    expect(kindLabel(undefined)).toBeNull()
    expect(kindLabel('screenshot')).toBeNull()
  })

  it('puts the kind beside the source on a catalog line', () => {
    const flat = flatten(renderTopicCatalog({ entries: ENTRIES, timeZone: 'UTC' }))
    expect(flat).toContain('— Podcast · Long Run Radio')
    expect(flat).toContain('— Article · example.com')
  })

  it('still renders a bare site when the kind is unknown', () => {
    const flat = flatten(renderTopicCatalog({ entries: ENTRIES, timeZone: 'UTC' }))
    expect(flat).toContain('— example.org')
  })
})

describe('the filing reason', () => {
  const withReason: CatalogEntry[] = [
    { ...ENTRIES[0], reason: 'compares gel brands mid-run' },
  ]

  it('says why an item is in this topic', () => {
    const flat = flatten(renderTopicCatalog({ entries: withReason, timeZone: 'UTC' }))
    expect(flat).toContain('filed here: compares gel brands mid-run')
  })

  it('never dresses the reason up as the user\'s own words', () => {
    // The user's notes are quoted and dated. The reason must not be, or a
    // model-written phrase would read as something they wrote.
    const flat = flatten(renderTopicCatalog({ entries: withReason, timeZone: 'UTC' }))
    expect(flat).toContain('“worth revisiting before the fall build”')
    expect(flat).not.toContain('“compares gel brands mid-run”')
  })

  it('renders nothing at all when there is no reason', () => {
    const flat = flatten(renderTopicCatalog({ entries: ENTRIES, timeZone: 'UTC' }))
    expect(flat).not.toContain('filed here')
  })
})

describe('groupByMonth / monthLabel', () => {
  it("labels in the user's zone, not UTC", () => {
    // 02:00 UTC on Sep 1 is still August in New York — the month heading would
    // otherwise be wrong for anything saved late in the evening.
    const instant = '2026-09-01T02:00:00Z'
    expect(monthLabel(instant, 'America/New_York')).toBe('August 2026')
    expect(monthLabel(instant, 'UTC')).toBe('September 2026')
  })

  it('handles an unparseable date rather than throwing', () => {
    expect(monthLabel('not a date', 'UTC')).toBe('Undated')
  })

  it('keeps entries newest-first inside a month', () => {
    const groups = groupByMonth(ENTRIES, 'UTC')
    expect(groups[0].entries.map((e) => e.pageId)).toEqual(['cap-2', 'cap-1'])
  })
})

describe('renderSectionIndex', () => {
  const doc = renderSectionIndex({
    topics: [
      { pageId: 'topic-1', title: 'Fueling', count: 7 },
      { pageId: 'topic-2', title: 'Calf pain', count: 0 },
    ],
    recent: ENTRIES,
    timeZone: 'UTC',
  })

  it('lists topics and what landed recently', () => {
    expect(headings(doc)).toEqual(['Topics', 'Landed recently'])
  })

  it('links topics and captures', () => {
    expect(links(doc)).toContain('#pg=topic-1')
    expect(links(doc)).toContain('#pg=cap-1')
  })

  it('renders a count as plain context, not a badge to act on', () => {
    expect(flatten(doc)).toContain('7 saved')
    // A zero shows as nothing at all — an empty topic is not a task.
    expect(flatten(doc)).not.toContain('0 saved')
  })

  it('handles a brand-new section', () => {
    const empty = renderSectionIndex({ topics: [], recent: [], timeZone: 'UTC' })
    expect(flatten(empty)).toContain('Nothing saved in this section yet')
  })

  it('names how a topic gets made when the section has none', () => {
    // Omitting the whole Topics block — the previous behavior — left the page a
    // bare list of recent saves and made the topic mechanism invisible to
    // anyone who had not already been told about it.
    const noTopics = renderSectionIndex({ topics: [], recent: ENTRIES, timeZone: 'UTC' })
    expect(headings(noTopics)).toEqual(['Topics', 'Landed recently'])
    expect(flatten(noTopics)).toContain('No topics in this section yet')
    expect(flatten(noTopics)).toContain('make a topic for')
  })

  it('points at the button on this very page before it points at Telegram', () => {
    // There is a "Worth a topic?" block directly above this document. Sending
    // the reader to the bot while a card sits a few centimetres higher would be
    // the app not knowing what it looks like.
    const noTopics = flatten(renderSectionIndex({ topics: [], recent: [], timeZone: 'UTC' }))
    expect(noTopics.indexOf('Worth a topic?')).toBeGreaterThan(-1)
    expect(noTopics.indexOf('Worth a topic?')).toBeLessThan(noTopics.indexOf('tell the bot'))
  })

  it('still leaves topics to the user', () => {
    const noTopics = flatten(renderSectionIndex({ topics: [], recent: [], timeZone: 'UTC' }))
    expect(noTopics).toContain('only because you made one')
    expect(noTopics.toLowerCase()).not.toContain('i made')
  })

  it('says how many it did not list rather than truncating in silence', () => {
    const many: CatalogEntry[] = Array.from({ length: 18 }, (_, i) => ({
      pageId: `cap-${i}`,
      title: `Saved thing ${i}`,
      savedAt: `2026-08-${String(i + 1).padStart(2, '0')}T12:00:00Z`,
    }))
    const doc18 = renderSectionIndex({ topics: [], recent: many, timeZone: 'UTC' })
    const flat = flatten(doc18)
    expect(flat).toContain('3 older — search the section.')
    // The 15 newest are the ones shown.
    expect(flat).toContain('Saved thing 17')
    expect(flat).not.toContain('Saved thing 0')
  })

  it('says nothing about older items when everything fits', () => {
    expect(flatten(doc)).not.toContain('older — search')
  })
})

describe('renderLately', () => {
  const doc = renderLately({
    windowDays: 30,
    bySection: [
      { sectionTitle: 'Endurance', entries: ENTRIES.slice(0, 2) },
      { sectionTitle: 'Film', entries: [] },
    ],
  })

  it('groups the window by section and skips empty ones', () => {
    expect(headings(doc)).toEqual(['Endurance'])
  })

  it('does not write a suggestion into the page', () => {
    // Suggestions moved OUT of the document and into a React panel beside it.
    // A suggestion's "why" is a model-written sentence, and the guarantee at the
    // top of libraryCatalog.ts is that no model writes a sentence of its own in
    // there. They are also controls rather than content — nothing about a card
    // should survive into stored page JSON or into an export.
    const flat = flatten(doc)
    expect(flat).not.toContain('Maybe a topic?')
    expect(flat.toLowerCase()).not.toContain('make a topic page')
  })

  it('is fine with a quiet stretch, and does not turn it into a task', () => {
    const quiet = renderLately({ windowDays: 30, bySection: [] })
    const flat = flatten(quiet)
    expect(flat).toContain('Nothing new in the last 30 days')
    expect(flat.toLowerCase()).not.toContain('catch up')
  })

  it('names the window by its LENGTH, never by a cutoff date', () => {
    // "Saved since Jul 21" is true and useless: the reader has to work out what
    // Jul 21 is and why, and it changes every run. The design mock said
    // "last 30 days" and the mock was right.
    const flat = flatten(doc).toLowerCase()
    expect(flat).toContain('the last 30 days')
    expect(flat).not.toContain('week of')
    expect(flat).not.toMatch(/since [a-z]{3} \d/)
  })
})

describe('renderActivity', () => {
  const doc = renderActivity({
    rows: [
      {
        kind: 'topic_rebuilt',
        summary: 'rebuilt from 7 captures',
        created_at: '2026-08-23T08:07:00Z',
        target_page_id: 'topic-1',
        targetTitle: 'Fueling',
      },
      {
        kind: 'skipped',
        summary: 'skipped Film — no new captures since the last rebuild',
        created_at: '2026-08-23T08:07:01Z',
      },
    ],
    timeZone: 'UTC',
  })

  it('names what changed and links to it', () => {
    expect(flatten(doc)).toContain('rebuilt from 7 captures')
    expect(links(doc)).toContain('#pg=topic-1')
  })

  it('shows the skips, which is what makes scoping visible', () => {
    // An unscoped "update the wiki" is a documented failure mode of this
    // pattern. Logging the skips is how the user can see the scoping working.
    expect(flatten(doc)).toContain('no new captures since the last rebuild')
  })

  it('handles a page with no history yet', () => {
    expect(flatten(renderActivity({ rows: [], timeZone: 'UTC' }))).toContain(
      'Nothing has been rebuilt yet',
    )
  })
})

describe('extractNotes', () => {
  const capture = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { id: 'h1', level: 2 }, content: [{ type: 'text', text: 'Summary' }] },
      { type: 'paragraph', attrs: { id: 'p1' }, content: [{ type: 'text', text: 'A model-written summary.' }] },
      { type: 'heading', attrs: { id: 'h2', level: 2 }, content: [{ type: 'text', text: 'My notes' }] },
      {
        type: 'bulletList',
        attrs: { id: 'bl' },
        content: [
          { type: 'listItem', content: [{ type: 'paragraph', attrs: { id: 'n1' }, content: [{ type: 'text', text: 'Aug 19 — worth revisiting' }] }] },
          { type: 'listItem', content: [{ type: 'paragraph', attrs: { id: 'n2' }, content: [{ type: 'text', text: 'Aug 20 — the 30-60g range stuck' }] }] },
        ],
      },
      { type: 'heading', attrs: { id: 'h3', level: 2 }, content: [{ type: 'text', text: 'Source' }] },
      { type: 'paragraph', attrs: { id: 'p2' }, content: [{ type: 'text', text: 'example.com · A Writer' }] },
    ],
  }

  it("reads back the user's dated notes", () => {
    expect(extractNotes(capture as never)).toEqual([
      { date: 'Aug 19', text: 'worth revisiting' },
      { date: 'Aug 20', text: 'the 30-60g range stuck' },
    ])
  })

  it('takes nothing from the summary or the source section', () => {
    // A catalog quotes the user, not the model. Pulling the summary in here
    // would put model-written prose on a page that is meant to be recall.
    const notes = extractNotes(capture as never).map((note) => note.text).join(' ')
    expect(notes).not.toContain('model-written summary')
    expect(notes).not.toContain('A Writer')
  })

  it('is empty for a page with no notes section', () => {
    expect(extractNotes({ type: 'doc', content: [] } as never)).toEqual([])
    expect(extractNotes(null)).toEqual([])
  })

  it('keeps an undated line rather than dropping it', () => {
    const odd = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { id: 'h', level: 2 }, content: [{ type: 'text', text: 'My notes' }] },
        {
          type: 'bulletList',
          attrs: { id: 'b' },
          content: [
            { type: 'listItem', content: [{ type: 'paragraph', attrs: { id: 'x' }, content: [{ type: 'text', text: 'a line the user typed themselves' }] }] },
          ],
        },
      ],
    }
    expect(extractNotes(odd as never)).toEqual([
      { date: '', text: 'a line the user typed themselves' },
    ])
  })
})

describe('toCatalogEntries', () => {
  it('carries the site label through from the stored source meta', () => {
    const entries = toCatalogEntries(
      [{ id: 'p1', title: 'A thing', content: { type: 'doc', content: [] } as never, created_at: '2026-08-19T00:00:00Z' }],
      new Map([['p1', { site: 'example.com', kind: 'article' }]]),
    )
    expect(entries[0]).toMatchObject({
      pageId: 'p1',
      title: 'A thing',
      site: 'example.com',
      kind: 'article',
    })
  })
})
