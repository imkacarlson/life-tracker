import { describe, expect, it } from 'vitest'

import {
  buildCandidates,
  buildDaily,
  buildTrackerContext,
  extractDateTokens,
  parseDateResolutions,
  resolveFinalDate,
  resolveTokenDate,
  resolveTrackerAnchor,
  serializeTrackerToMarkdown,
  type DateCandidate,
  type DateResolutions,
  type InlineSegment,
} from './dailyHelpers.ts'

const hl = (text: string): InlineSegment => ({ text, highlighted: true })
const plain = (text: string): InlineSegment => ({ text, highlighted: false })

// A DateResolutions with no AI enrichment — the deterministic list alone.
const emptyResolutions = (): DateResolutions => ({
  resolutions: new Map(),
  flagged: [],
  format: 'empty',
})

describe('serializeTrackerToMarkdown', () => {
  it('emits a stable cid anchor per block that has an id and resolves it to the block id', () => {
    const content = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { id: 'h1', level: 2 },
          content: [{ type: 'text', text: 'Running' }],
        },
        {
          type: 'paragraph',
          attrs: { id: 'p1' },
          content: [{ type: 'text', text: 'Book flights' }],
        },
      ],
    }

    const { markdown, cidToBlockId, cidToText } = serializeTrackerToMarkdown(content)

    // One anchor per id-bearing block.
    const anchors = [...markdown.matchAll(/⟦(c\d+)⟧/g)].map((m) => m[1])
    expect(anchors).toEqual(['c1', 'c2'])
    expect(cidToBlockId.get('c1')).toBe('h1')
    expect(cidToBlockId.get('c2')).toBe('p1')
    expect(cidToText.get('c2')).toBe('Book flights')
  })

  it('preserves list nesting and highlight formatting', () => {
    const content = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          attrs: { id: 'bl1' },
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  attrs: { id: 'li-p1' },
                  content: [
                    { type: 'text', text: 'Pay taxes ' },
                    { type: 'text', text: '4/15', marks: [{ type: 'highlight' }] },
                  ],
                },
                {
                  type: 'bulletList',
                  attrs: { id: 'bl2' },
                  content: [
                    {
                      type: 'listItem',
                      content: [
                        {
                          type: 'paragraph',
                          attrs: { id: 'li-p2' },
                          content: [{ type: 'text', text: 'Gather receipts' }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }

    const { markdown, cidToBlockId } = serializeTrackerToMarkdown(content)

    // The anchored line carries the inner paragraph id (the deep-link target),
    // not the list container id.
    expect(cidToBlockId.get('c1')).toBe('li-p1')
    expect(cidToBlockId.get('c2')).toBe('li-p2')

    const lines = markdown.split('\n')
    const topLine = lines.find((l) => l.includes('Pay taxes')) || ''
    const nestedLine = lines.find((l) => l.includes('Gather receipts')) || ''
    // Highlight rendered as [text]; nested item indented under the parent.
    expect(topLine).toContain('- Pay taxes [4/15]')
    expect(nestedLine.indexOf('-')).toBeGreaterThan(topLine.indexOf('-'))
  })
})

describe('buildCandidates', () => {
  const today = '2026-07-01'

  it('only yields a candidate for a highlighted MM/DD token', () => {
    const cidSegments = new Map<string, InlineSegment[]>([
      ['c1', [plain('Bachelor party '), hl('7/1')]],
      ['c2', [plain('Background: written on 4/15 as a log note')]],
      ['c3', [plain('No dates at all here')]],
    ])
    const candidates = buildCandidates(cidSegments, today)
    expect(candidates.map((c) => c.cid)).toEqual(['c1'])
  })

  it('drops struck / completed lines before they become candidates (via segment filter)', () => {
    // collectInlineSegments removes struck text, so a struck date never reaches
    // buildCandidates as a highlighted segment. Simulate the post-filter input.
    const cidSegments = new Map<string, InlineSegment[]>([
      ['c1', [plain('Done thing ')]], // date was struck out and dropped
    ])
    expect(buildCandidates(cidSegments, today)).toEqual([])
  })

  it('sets deterministicIso from an explicit slash-year and marks needsAiYear false', () => {
    const cidSegments = new Map<string, InlineSegment[]>([
      ['c1', [plain('Due '), hl('4/15/2030'), plain(' (of 2027)')]],
    ])
    const [candidate] = buildCandidates(cidSegments, today)
    expect(candidate.deterministicIso).toBe('2030-04-15')
    expect(candidate.month).toBe(4)
    expect(candidate.day).toBe(15)
    expect(candidate.needsAiYear).toBe(false)
  })

  it('uses a written digit year on the line and marks needsAiYear false (4/15 of 2027)', () => {
    const cidSegments = new Map<string, InlineSegment[]>([
      ['c1', [plain('They are due by '), hl('4/15'), plain(' (of 2027)')]],
    ])
    const [candidate] = buildCandidates(cidSegments, today)
    expect(candidate.deterministicIso).toBe('2027-04-15')
    expect(candidate.needsAiYear).toBe(false)
  })

  it('defaults a bare highlighted date to the current year and marks needsAiYear true', () => {
    const cidSegments = new Map<string, InlineSegment[]>([
      ['c1', [plain('Bachelor party '), hl('7/1')]],
    ])
    const [candidate] = buildCandidates(cidSegments, today)
    expect(candidate.deterministicIso).toBe('2026-07-01')
    expect(candidate.needsAiYear).toBe(true)
  })

  describe('anchoring bare dates to the tracker month', () => {
    const augustAnchor = new Date(Date.UTC(2026, 7, 1))
    const augustToday = '2026-08-08'

    it('rolls a bare date earlier than the anchor month to the next year', () => {
      const cidSegments = new Map<string, InlineSegment[]>([
        ['c1', [plain('Hotel cancel deadline '), hl('1/10')]],
      ])
      const [candidate] = buildCandidates(cidSegments, augustToday, augustAnchor)
      expect(candidate.deterministicIso).toBe('2027-01-10')
      expect(candidate.needsAiYear).toBe(true)
    })

    it('leaves a bare date inside the anchor month alone (still overdue)', () => {
      const cidSegments = new Map<string, InlineSegment[]>([
        ['c1', [plain('Overdue thing '), hl('8/1')]],
      ])
      const [candidate] = buildCandidates(cidSegments, augustToday, augustAnchor)
      expect(candidate.deterministicIso).toBe('2026-08-01')
    })

    it('never touches an explicit slash-year', () => {
      const cidSegments = new Map<string, InlineSegment[]>([
        ['c1', [plain('Due '), hl('4/15/2030')]],
      ])
      const [candidate] = buildCandidates(cidSegments, augustToday, augustAnchor)
      expect(candidate.deterministicIso).toBe('2030-04-15')
    })

    it('never touches a written year on the line', () => {
      const cidSegments = new Map<string, InlineSegment[]>([
        ['c1', [plain('They are due by '), hl('4/15'), plain(' (of 2027)')]],
      ])
      const [candidate] = buildCandidates(cidSegments, augustToday, augustAnchor)
      expect(candidate.deterministicIso).toBe('2027-04-15')
      expect(candidate.needsAiYear).toBe(false)
    })

    it('picks the truly earliest token after rolling (12/26 before 1/10)', () => {
      const cidSegments = new Map<string, InlineSegment[]>([
        ['c1', [plain('Window '), hl('1/10'), plain(' to '), hl('12/26')]],
      ])
      const [candidate] = buildCandidates(cidSegments, augustToday, augustAnchor)
      expect(candidate.deterministicIso).toBe('2026-12-26')
      expect(candidate.dateText).toBe('12/26')
    })

    it('defaults the anchor to the first of today’s month', () => {
      const cidSegments = new Map<string, InlineSegment[]>([
        ['c1', [plain('Deadline '), hl('1/10')]],
      ])
      const [candidate] = buildCandidates(cidSegments, augustToday)
      expect(candidate.deterministicIso).toBe('2027-01-10')
    })

    it('still lets the AI year override a rolled candidate', () => {
      const cidSegments = new Map<string, InlineSegment[]>([
        ['c1', [plain('Deadline '), hl('1/10')]],
      ])
      const [candidate] = buildCandidates(cidSegments, augustToday, augustAnchor)
      const date = resolveFinalDate(candidate, '2029-01-10', augustToday)
      expect(date.toISOString().slice(0, 10)).toBe('2029-01-10')
    })
  })
})

describe('resolveTrackerAnchor', () => {
  const today = '2026-08-08'
  const iso = (date: Date) => date.toISOString().slice(0, 10)

  it('reads a full month name and year from the title', () => {
    expect(iso(resolveTrackerAnchor('August 2026 Tracker', today))).toBe('2026-08-01')
  })

  it('reads a 3-letter abbreviation', () => {
    expect(iso(resolveTrackerAnchor('Aug 2026', today))).toBe('2026-08-01')
  })

  it('reads the month and year in either order', () => {
    expect(iso(resolveTrackerAnchor('2027 September notes', today))).toBe('2027-09-01')
  })

  it('falls back to the first of the current month for an unparseable title', () => {
    expect(iso(resolveTrackerAnchor('Untitled Tracker', today))).toBe('2026-08-01')
    // A word that merely starts with a month abbreviation is not a month.
    expect(iso(resolveTrackerAnchor('Marathon Tracker 2026', today))).toBe('2026-08-01')
  })

  it('falls back for a missing or empty title', () => {
    expect(iso(resolveTrackerAnchor(undefined, today))).toBe('2026-08-01')
    expect(iso(resolveTrackerAnchor('', today))).toBe('2026-08-01')
  })
})

describe('buildTrackerContext — highlightedCids', () => {
  const today = '2026-07-01'

  it('includes highlighted lines (incl. a highlighted typo) and excludes plain lines', () => {
    const trackerPages = [
      {
        title: 'July 2026 Tracker',
        content: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              attrs: { id: 'p-cand' },
              content: [
                { type: 'text', text: 'File form ' },
                { type: 'text', text: '4/15', marks: [{ type: 'highlight' }] },
              ],
            },
            {
              type: 'paragraph',
              attrs: { id: 'p-typo' },
              content: [
                { type: 'text', text: 'Renew pass ' },
                { type: 'text', text: '4/l5', marks: [{ type: 'highlight' }] },
              ],
            },
            {
              type: 'paragraph',
              attrs: { id: 'p-plain' },
              content: [{ type: 'text', text: 'Background note' }],
            },
          ],
        },
      },
    ]

    const { candidates, highlightedCids, cidToBlockId } = buildTrackerContext(trackerPages, today)

    const candBlockIds = candidates.map((c) => cidToBlockId.get(c.cid))
    // Only the well-formed MM/DD line is a candidate; the typo is not.
    expect(candBlockIds).toEqual(['p-cand'])

    const highlightedBlockIds = [...highlightedCids].map((cid) => cidToBlockId.get(cid)).sort()
    expect(highlightedBlockIds).toEqual(['p-cand', 'p-typo'])
    // The plain line is never highlighted.
    expect(highlightedBlockIds).not.toContain('p-plain')
  })

  it('yields no candidates and no highlighted cids for an all-undated tracker', () => {
    const trackerPages = [
      {
        title: 'Empty',
        content: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              attrs: { id: 'p1' },
              content: [{ type: 'text', text: 'Just a note' }],
            },
          ],
        },
      },
    ]
    const { candidates, highlightedCids } = buildTrackerContext(trackerPages, today)
    expect(candidates).toEqual([])
    expect(highlightedCids.size).toBe(0)
  })

  it('anchors each page to its own month', () => {
    const datedPage = (title: string, id: string) => ({
      title,
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            attrs: { id },
            content: [
              { type: 'text', text: 'Deadline ' },
              { type: 'text', text: '1/10', marks: [{ type: 'highlight' }] },
            ],
          },
        ],
      },
    })

    const { candidates, cidToBlockId } = buildTrackerContext(
      [datedPage('August 2026 Tracker', 'p-aug'), datedPage('February 2027 Tracker', 'p-feb')],
      '2026-08-08',
    )

    const byBlock = new Map(
      candidates.map((c) => [cidToBlockId.get(c.cid), c.deterministicIso]),
    )
    // 1/10 is before August 2026 -> next year; 1/10 is before Feb 2027 -> 2028.
    expect(byBlock.get('p-aug')).toBe('2027-01-10')
    expect(byBlock.get('p-feb')).toBe('2028-01-10')
  })
})

describe('resolveFinalDate', () => {
  const today = '2026-07-01'

  const bareCandidate: DateCandidate = {
    cid: 'c1',
    dateText: '4/15',
    month: 4,
    day: 15,
    deterministicIso: '2026-04-15',
    needsAiYear: true,
  }

  it('recombines the AI-resolved year with the deterministic month/day', () => {
    const date = resolveFinalDate(bareCandidate, '2028-01-01', today)
    // Only the year (2028) is taken; month/day stay 4/15.
    expect(date.toISOString().slice(0, 10)).toBe('2028-04-15')
  })

  it('ignores the AI year when the year is already explicit (needsAiYear false)', () => {
    const explicit: DateCandidate = { ...bareCandidate, deterministicIso: '2027-04-15', needsAiYear: false }
    const date = resolveFinalDate(explicit, '2099-01-01', today)
    expect(date.toISOString().slice(0, 10)).toBe('2027-04-15')
  })

  it('falls back to the deterministic date when the AI iso_date is invalid', () => {
    const date = resolveFinalDate(bareCandidate, 'not-a-date', today)
    expect(date.toISOString().slice(0, 10)).toBe('2026-04-15')
  })

  it('keeps the current-year default when the AI returns null', () => {
    const date = resolveFinalDate(bareCandidate, null, today)
    expect(date.toISOString().slice(0, 10)).toBe('2026-04-15')
  })
})

describe('parseDateResolutions', () => {
  it('parses a fenced JSON object with resolutions and flagged', () => {
    const raw = [
      'Here you go:',
      '```json',
      '{"resolutions":[{"cid":"c1","iso_date":null,"task":"File form"}],',
      '"flagged":[{"cid":"c9","iso_date":"2026-03-15","task":"Renew pass"}]}',
      '```',
    ].join('\n')
    const parsed = parseDateResolutions(raw)
    expect(parsed.format).toBe('resolved')
    expect(parsed.resolutions.get('c1')).toEqual({ iso_date: null, task: 'File form' })
    expect(parsed.flagged).toEqual([{ cid: 'c9', iso_date: '2026-03-15', task: 'Renew pass' }])
  })

  it('ignores entries missing a cid and flagged entries missing an iso_date', () => {
    const raw = JSON.stringify({
      resolutions: [{ iso_date: '2027-01-01', task: 'no cid' }, { cid: 'c2', task: 'ok' }],
      flagged: [{ cid: 'c3', task: 'no date' }],
    })
    const parsed = parseDateResolutions(raw)
    expect(parsed.resolutions.has('c2')).toBe(true)
    expect(parsed.resolutions.size).toBe(1)
    expect(parsed.flagged).toEqual([])
  })

  it('returns empty format on unparseable text', () => {
    const parsed = parseDateResolutions('total nonsense, no json')
    expect(parsed.format).toBe('empty')
    expect(parsed.resolutions.size).toBe(0)
    expect(parsed.flagged).toEqual([])
  })
})

describe('buildDaily — candidates decide the list', () => {
  const today = '2026-07-01'
  const cidToBlockId = new Map<string, string>([
    ['c1', 'block-1'],
    ['c2', 'block-2'],
    ['c3', 'block-3'],
  ])
  const cidToText = new Map<string, string>([
    ['c1', 'Pay taxes'],
    ['c2', 'Book venue'],
    ['c3', 'Distant thing'],
  ])
  const highlightedCids = new Set(['c1', 'c2', 'c3'])

  const candidate = (cid: string, iso: string, needsAiYear = false): DateCandidate => ({
    cid,
    dateText: iso.slice(5).replace('-', '/'),
    month: Number(iso.slice(5, 7)),
    day: Number(iso.slice(8, 10)),
    deterministicIso: iso,
    needsAiYear,
  })

  it('guarantees an overdue highlighted date lands in ASAP', () => {
    const candidates = [candidate('c1', '2026-03-15')] // months before today
    const { asap, fyi } = buildDaily(candidates, emptyResolutions(), cidToBlockId, cidToText, highlightedCids, today)
    expect(asap).toEqual([{ task: 'Pay taxes', block_ids: ['block-1'], priority: 'high' }])
    expect(fyi).toEqual([])
  })

  it('routes a soon (<=2d) date to FYI with medium priority', () => {
    const candidates = [candidate('c2', '2026-07-02')]
    const { asap, fyi } = buildDaily(candidates, emptyResolutions(), cidToBlockId, cidToText, highlightedCids, today)
    expect(asap).toEqual([])
    expect(fyi).toEqual([{ task: 'Book venue', block_ids: ['block-2'], priority: 'medium' }])
  })

  it('drops a far-future (later) candidate', () => {
    const candidates = [candidate('c3', '2026-12-31')]
    const { asap, fyi } = buildDaily(candidates, emptyResolutions(), cidToBlockId, cidToText, highlightedCids, today)
    expect(asap).toEqual([])
    expect(fyi).toEqual([])
  })

  it('prefers the AI-phrased task but falls back to cidToText', () => {
    const candidates = [candidate('c1', '2026-07-01')]
    const parsed: DateResolutions = {
      resolutions: new Map([['c1', { iso_date: null, task: 'Finance: File taxes' }]]),
      flagged: [],
      format: 'resolved',
    }
    const { asap } = buildDaily(candidates, parsed, cidToBlockId, cidToText, highlightedCids, today)
    expect(asap[0].task).toBe('Finance: File taxes')

    const { asap: fallback } = buildDaily(candidates, emptyResolutions(), cidToBlockId, cidToText, highlightedCids, today)
    expect(fallback[0].task).toBe('Pay taxes')
  })

  it('applies an AI-resolved year to a needsAiYear candidate before bucketing', () => {
    // Bare 4/15 defaults to 2026 (overdue), but the AI resolves 2028 → later → dropped.
    const candidates = [candidate('c1', '2026-04-15', true)]
    const parsed: DateResolutions = {
      resolutions: new Map([['c1', { iso_date: '2028-04-15', task: 'Pay taxes' }]]),
      flagged: [],
      format: 'resolved',
    }
    const { asap, fyi } = buildDaily(candidates, parsed, cidToBlockId, cidToText, highlightedCids, today)
    expect(asap).toEqual([])
    expect(fyi).toEqual([])
  })
})

describe('buildDaily — flagged extras (additive only)', () => {
  const today = '2026-07-01'
  const cidToBlockId = new Map<string, string>([
    ['c1', 'block-1'],
    ['c9', 'block-9'],
  ])
  const cidToText = new Map<string, string>([
    ['c1', 'Pay taxes'],
    ['c9', 'Renew pass'],
  ])
  const highlightedCids = new Set(['c1', 'c9'])

  const flaggedParsed = (flagged: DateResolutions['flagged']): DateResolutions => ({
    resolutions: new Map(),
    flagged,
    format: 'resolved',
  })

  it('adds a highlighted non-candidate overdue flag and reports feedback', () => {
    const parsed = flaggedParsed([{ cid: 'c9', iso_date: '2026-03-15', task: 'Renew pass' }])
    const { asap, feedback } = buildDaily([], parsed, cidToBlockId, cidToText, highlightedCids, today)
    expect(asap).toEqual([{ task: 'Renew pass', block_ids: ['block-9'], priority: 'high' }])
    expect(feedback).toHaveLength(1)
    expect(feedback[0]).toContain('Renew pass')
  })

  it('rejects a flagged cid that is not highlighted', () => {
    const notHighlighted = new Set(['c1']) // c9 absent
    const parsed = flaggedParsed([{ cid: 'c9', iso_date: '2026-03-15', task: 'Renew pass' }])
    const { asap, fyi, feedback } = buildDaily([], parsed, cidToBlockId, cidToText, notHighlighted, today)
    expect(asap).toEqual([])
    expect(fyi).toEqual([])
    expect(feedback).toEqual([])
  })

  it('never lets a flagged entry override a candidate on the same cid', () => {
    const candidates: DateCandidate[] = [
      { cid: 'c1', dateText: '3/15', month: 3, day: 15, deterministicIso: '2026-03-15', needsAiYear: false },
    ]
    // Flag tries to move c1 to a far-future date; it must be ignored.
    const parsed = flaggedParsed([{ cid: 'c1', iso_date: '2030-03-15', task: 'Hijacked' }])
    const { asap, feedback } = buildDaily(candidates, parsed, cidToBlockId, cidToText, highlightedCids, today)
    expect(asap).toEqual([{ task: 'Pay taxes', block_ids: ['block-1'], priority: 'high' }])
    expect(feedback).toEqual([])
  })

  it('drops a flagged far-future date via bucketForDate', () => {
    const parsed = flaggedParsed([{ cid: 'c9', iso_date: '2030-01-01', task: 'Renew pass' }])
    const { asap, fyi, feedback } = buildDaily([], parsed, cidToBlockId, cidToText, highlightedCids, today)
    expect(asap).toEqual([])
    expect(fyi).toEqual([])
    expect(feedback).toEqual([])
  })

  it('rejects a flagged entry with an invalid iso_date', () => {
    const parsed = flaggedParsed([{ cid: 'c9', iso_date: '2026-13-40', task: 'Renew pass' }])
    const { asap, fyi } = buildDaily([], parsed, cidToBlockId, cidToText, highlightedCids, today)
    expect(asap).toEqual([])
    expect(fyi).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Multi-column tables. Every highlighted date must be reachable: these rows used
// to be anchor-suppressed entirely, so 24 real dates in the user's tracker were
// invisible to the daily list. The row — not the cell — is the addressable unit.
// ---------------------------------------------------------------------------
describe('serializeTrackerToMarkdown — multi-column tables', () => {
  const cell = (id: string, text: string, highlighted = false) => ({
    type: 'tableCell',
    content: [
      {
        type: 'paragraph',
        attrs: { id },
        content: [{ type: 'text', text, ...(highlighted ? { marks: [{ type: 'highlight' }] } : {}) }],
      },
    ],
  })

  const rewardsTable = {
    type: 'doc',
    content: [
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              { type: 'tableHeader', content: [{ type: 'paragraph', attrs: { id: 'h-a' }, content: [{ type: 'text', text: 'Reward' }] }] },
              { type: 'tableHeader', content: [{ type: 'paragraph', attrs: { id: 'h-b' }, content: [{ type: 'text', text: 'Use-By Date' }] }] },
              { type: 'tableHeader', content: [{ type: 'paragraph', attrs: { id: 'h-c' }, content: [{ type: 'text', text: 'Notes' }] }] },
            ],
          },
          {
            type: 'tableRow',
            content: [cell('r1-a', 'Chase Ultimate Rewards'), cell('r1-b', '3/2/27', true), cell('r1-c', 'book flights')],
          },
          {
            type: 'tableRow',
            content: [cell('r2-a', 'Airline credit'), cell('r2-b', '4/5', true), cell('r2-c', '')],
          },
        ],
      },
    ],
  }

  it('anchors each body row once, to the first block id in the row', () => {
    const { markdown, cidToBlockId } = serializeTrackerToMarkdown(rewardsTable)
    const lines = markdown.split('\n')

    const headerLine = lines.find((l) => l.includes('Reward')) || ''
    const row1 = lines.find((l) => l.includes('Chase')) || ''
    const row2 = lines.find((l) => l.includes('Airline')) || ''

    // Header row is column labels, never an item.
    expect(headerLine).not.toMatch(/⟦c\d+⟧/)
    // One anchor per body row, appended after the closing pipe.
    expect(row1).toMatch(/\|\s⟦c1⟧$/)
    expect(row2).toMatch(/\|\s⟦c2⟧$/)
    expect(cidToBlockId.get('c1')).toBe('r1-a')
    expect(cidToBlockId.get('c2')).toBe('r2-a')
  })

  it('keeps cell interiors free of anchors', () => {
    const { markdown } = serializeTrackerToMarkdown(rewardsTable)
    const row1 = markdown.split('\n').find((l) => l.includes('Chase')) || ''
    expect([...row1.matchAll(/⟦c\d+⟧/g)]).toHaveLength(1)
  })

  it("reads the row's cells as one line of text, joined by ·", () => {
    const { cidToText } = serializeTrackerToMarkdown(rewardsTable)
    expect(cidToText.get('c1')).toBe('Chase Ultimate Rewards · 3/2/27 · book flights')
  })

  it('makes a highlighted date in a table row a real daily-list candidate', () => {
    const { candidates, cidToBlockId } = buildTrackerContext(
      [{ id: 'page-1', title: 'August 2026 Tracker', content: rewardsTable }],
      '2026-08-09',
    )
    const airline = candidates.find((c) => c.deterministicIso.endsWith('-04-05'))
    expect(airline).toBeDefined()
    expect(cidToBlockId.get(airline!.cid)).toBe('r2-a')
    // Bare 4/5 on an August 2026 page rolls forward to the next April.
    expect(airline!.deterministicIso).toBe('2027-04-05')
  })
})

describe('single-column tables are unchanged', () => {
  it('still preserves inner structure and its own anchors', () => {
    const content = {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  content: [
                    { type: 'paragraph', attrs: { id: 'c-p1' }, content: [{ type: 'text', text: 'RUNNING' }] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }
    const { markdown, cidToBlockId } = serializeTrackerToMarkdown(content)
    expect(markdown).toContain('RUNNING ⟦c1⟧')
    expect(markdown).not.toContain('|')
    expect(cidToBlockId.get('c1')).toBe('c-p1')
  })
})

describe('resolveTokenDate', () => {
  const anchor = new Date(Date.UTC(2026, 7, 1)) // August 2026 tracker
  const tokenFor = (text: string) => extractDateTokens(text, 2026)[0]

  it('lets an explicit slash-year win outright', () => {
    const result = resolveTokenDate(tokenFor('3/2/27'), '3/2/27', anchor)
    expect(result.date.toISOString().slice(0, 10)).toBe('2027-03-02')
    expect(result.needsAiYear).toBe(false)
  })

  it('uses a written 20xx year found elsewhere on the line', () => {
    const line = 'Renew 1/5 (of 2028)'
    const result = resolveTokenDate(tokenFor(line), line, anchor)
    expect(result.date.toISOString().slice(0, 10)).toBe('2028-01-05')
    expect(result.needsAiYear).toBe(false)
  })

  it('rolls a bare date forward past the tracker anchor', () => {
    const result = resolveTokenDate(tokenFor('1/5'), '1/5', anchor)
    expect(result.date.toISOString().slice(0, 10)).toBe('2027-01-05')
    expect(result.needsAiYear).toBe(true)
  })

  it('keeps a bare date in the anchor year when it is not yet past', () => {
    const result = resolveTokenDate(tokenFor('9/26'), '9/26', anchor)
    expect(result.date.toISOString().slice(0, 10)).toBe('2026-09-26')
  })

  it('resolves each token on a two-date line independently', () => {
    const line = '8/17 and 1/5'
    const [first, second] = extractDateTokens(line, 2026)
    expect(resolveTokenDate(first, line, anchor).date.toISOString().slice(0, 10)).toBe('2026-08-17')
    expect(resolveTokenDate(second, line, anchor).date.toISOString().slice(0, 10)).toBe('2027-01-05')
  })
})
