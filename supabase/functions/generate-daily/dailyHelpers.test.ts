import { describe, expect, it } from 'vitest'

import {
  buildDateHints,
  buildTrackerContext,
  mapTasksByBucket,
  serializeTrackerToMarkdown,
  type InlineSegment,
} from './dailyHelpers.ts'

const hl = (text: string): InlineSegment => ({ text, highlighted: true })
const plain = (text: string): InlineSegment => ({ text, highlighted: false })

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

describe('buildDateHints — year inference', () => {
  const today = '2026-07-01'

  it('uses a written year in the line for a bare highlighted date (4/15 of 2027 → later)', () => {
    const cidSegments = new Map<string, InlineSegment[]>([
      ['c1', [plain('They are due by '), hl('4/15'), plain(' (of 2027)')]],
    ])
    const hints = buildDateHints(cidSegments, today)
    expect(hints).toHaveLength(1)
    expect(hints[0].cid).toBe('c1')
    expect(hints[0].parsedIso).toBe('2027-04-15')
    expect(hints[0].bucket).toBe('later')
  })

  it('handles a far-future written year (7/1 of 2028 → later)', () => {
    const cidSegments = new Map<string, InlineSegment[]>([
      ['c2', [plain('might come up around '), hl('7/1'), plain(' (of 2028)')]],
    ])
    const hints = buildDateHints(cidSegments, today)
    expect(hints).toHaveLength(1)
    expect(hints[0].parsedIso).toBe('2028-07-01')
    expect(hints[0].bucket).toBe('later')
  })

  it('defaults a bare highlighted date to the current year (7/1 → today)', () => {
    const cidSegments = new Map<string, InlineSegment[]>([
      ['c3', [plain('Bachelor party '), hl('7/1')]],
    ])
    const hints = buildDateHints(cidSegments, today)
    expect(hints).toHaveLength(1)
    expect(hints[0].parsedIso).toBe('2026-07-01')
    expect(hints[0].bucket).toBe('today')
  })

  it('lets an explicit slash-year win over the written year', () => {
    const cidSegments = new Map<string, InlineSegment[]>([
      ['c4', [plain('Due '), hl('4/15/2030'), plain(' (of 2027)')]],
    ])
    const hints = buildDateHints(cidSegments, today)
    expect(hints[0].parsedIso).toBe('2030-04-15')
  })

  it('emits no hint for lines without a highlighted date', () => {
    const cidSegments = new Map<string, InlineSegment[]>([
      ['c5', [plain('Background: written on 4/15 as a log note')]],
      ['c6', [plain('No dates at all here')]],
    ])
    expect(buildDateHints(cidSegments, today)).toEqual([])
  })
})

describe('mapTasksByBucket', () => {
  const cidToBlockId = new Map<string, string>([
    ['c1', 'block-1'],
    ['c2', 'block-2'],
    ['c3', 'block-3'],
  ])
  const cidToText = new Map<string, string>([
    ['c1', 'First task'],
    ['c2', 'Second task'],
    ['c3', 'Third task'],
  ])

  it('honors the AI asap/fyi placement without re-routing', () => {
    const parsed = {
      asap: [{ task: 'Do first', cids: ['c1'], priority: 'high' }],
      fyi: [{ task: 'Heads up on second', cids: ['c2'], priority: 'low' }],
      format: 'asap_fyi' as const,
    }
    const { asap, fyi } = mapTasksByBucket(parsed, cidToBlockId, cidToText)
    expect(asap).toEqual([{ task: 'Do first', block_ids: ['block-1'], priority: 'high' }])
    expect(fyi).toEqual([{ task: 'Heads up on second', block_ids: ['block-2'], priority: 'low' }])
  })

  it('drops invented / unknown cids and skips tasks left with no real block', () => {
    const parsed = {
      asap: [{ task: 'Hallucinated', cids: ['cX', 'cY'], priority: 'high' }],
      fyi: [],
      format: 'asap_fyi' as const,
    }
    const { asap, fyi, droppedUnknownCids } = mapTasksByBucket(parsed, cidToBlockId, cidToText)
    expect(asap).toEqual([])
    expect(fyi).toEqual([])
    expect(droppedUnknownCids).toBe(2)
  })

  it('falls back to candidate text and defaults priority when the AI omits them', () => {
    const parsed = {
      asap: [{ task: '   ', cids: ['c3'], priority: 'nonsense' }],
      fyi: [],
      format: 'asap_fyi' as const,
    }
    const { asap } = mapTasksByBucket(parsed, cidToBlockId, cidToText)
    expect(asap).toEqual([{ task: 'Third task', block_ids: ['block-3'], priority: 'medium' }])
  })

  it('returns empty arrays when the AI returns nothing due', () => {
    const parsed = { asap: [], fyi: [], format: 'empty' as const }
    const { asap, fyi } = mapTasksByBucket(parsed, cidToBlockId, cidToText)
    expect(asap).toEqual([])
    expect(fyi).toEqual([])
  })
})

describe('buildTrackerContext', () => {
  const today = '2026-07-01'

  it('serializes every page and only emits hints for highlighted dates', () => {
    const trackerPages = [
      {
        title: 'July 2026 Tracker',
        pageId: 'page-1',
        content: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              attrs: { id: 'p-future' },
              content: [
                { type: 'text', text: 'File form ' },
                { type: 'text', text: '4/15', marks: [{ type: 'highlight' }] },
                { type: 'text', text: ' (of 2027)' },
              ],
            },
            {
              type: 'paragraph',
              attrs: { id: 'p-note' },
              content: [{ type: 'text', text: 'Background: nothing due here' }],
            },
          ],
        },
      },
    ]

    const { markdown, cidToBlockId, dateHints } = buildTrackerContext(trackerPages, today)
    expect(markdown).toContain('JULY 2026 TRACKER')
    expect(cidToBlockId.size).toBe(2)
    // Only the highlighted-date line yields a hint, and year inference pushes it out.
    expect(dateHints).toHaveLength(1)
    expect(dateHints[0].bucket).toBe('later')
    expect(cidToBlockId.get(dateHints[0].cid)).toBe('p-future')
  })

  it('yields empty hints for an all-undated tracker', () => {
    const trackerPages = [
      {
        title: 'Empty',
        pageId: 'page-1',
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
    const { dateHints } = buildTrackerContext(trackerPages, today)
    expect(dateHints).toEqual([])
  })
})
