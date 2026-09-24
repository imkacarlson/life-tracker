import { describe, expect, it } from 'vitest'

import { findPlacementPath, findSectionTitle } from './sectionTitle.ts'

type Node = {
  type?: string
  text?: string
  marks?: Array<{ type?: string; attrs?: Record<string, unknown> }>
  attrs?: Record<string, unknown>
  content?: Node[]
}

// --- fixture builders ---

const boldPara = (id: string, text: string): Node => ({
  type: 'paragraph',
  attrs: { id },
  content: [{ type: 'text', text, marks: [{ type: 'bold' }] }],
})

const para = (id: string, text: string): Node => ({
  type: 'paragraph',
  attrs: { id },
  content: text ? [{ type: 'text', text }] : [],
})

const heading = (id: string, text: string): Node => ({
  type: 'heading',
  attrs: { id, level: 2 },
  content: [{ type: 'text', text }],
})

const bulletList = (id: string, itemParas: Node[]): Node => ({
  type: 'bulletList',
  attrs: { id },
  content: itemParas.map((p) => ({ type: 'listItem', content: [p] })),
})

// A single-column category table: one cell per category, each holding a bold
// category-name paragraph followed by the bullet list (the user's common layout).
const singleColumnTable = (cells: Node[]): Node => ({
  type: 'table',
  content: cells.map((cell) => ({
    type: 'tableRow',
    content: [cell],
  })),
})

const cell = (children: Node[]): Node => ({ type: 'tableCell', content: children })

const doc = (content: Node[]): Node => ({ type: 'doc', content })

describe('findSectionTitle', () => {
  it('returns the bold category when the target is a list item paragraph in the cell', () => {
    const itemPara = para('item-1', 'buy more gels')
    const tracker = doc([
      singleColumnTable([
        cell([boldPara('cat-1', 'Running'), bulletList('list-1', [itemPara])]),
        cell([boldPara('cat-2', 'Financial Stuff'), bulletList('list-2', [para('item-2', 'pay rent')])]),
      ]),
    ])
    expect(findSectionTitle(tracker, 'item-1')).toBe('Running')
    expect(findSectionTitle(tracker, 'item-2')).toBe('Financial Stuff')
  })

  it('returns the bold category when the target is the list wrapper id (append_to_list)', () => {
    const tracker = doc([
      singleColumnTable([
        cell([boldPara('cat-1', 'Financial Stuff'), bulletList('list-1', [para('item-1', 'pay rent')])]),
      ]),
    ])
    expect(findSectionTitle(tracker, 'list-1')).toBe('Financial Stuff')
  })

  it('returns the bold category when the target is a plain paragraph after it (after_block)', () => {
    const tracker = doc([
      singleColumnTable([
        cell([boldPara('cat-1', 'Wedding'), para('note-1', 'book venue')]),
      ]),
    ])
    expect(findSectionTitle(tracker, 'note-1')).toBe('Wedding')
  })

  it('returns the category text when the target IS the bold category paragraph', () => {
    const tracker = doc([
      singleColumnTable([
        cell([boldPara('cat-1', 'Financial Stuff'), bulletList('list-1', [para('item-1', 'pay rent')])]),
      ]),
    ])
    expect(findSectionTitle(tracker, 'cat-1')).toBe('Financial Stuff')
  })

  it('returns the nearest preceding heading in a heading-organized doc', () => {
    const tracker = doc([
      heading('h-1', 'Running'),
      bulletList('list-1', [para('item-1', 'long run Saturday')]),
      heading('h-2', 'Finance'),
      bulletList('list-2', [para('item-2', 'pay rent')]),
    ])
    expect(findSectionTitle(tracker, 'item-1')).toBe('Running')
    expect(findSectionTitle(tracker, 'item-2')).toBe('Finance')
    expect(findSectionTitle(tracker, 'list-2')).toBe('Finance')
  })

  it('returns the heading text when the target IS a heading', () => {
    const tracker = doc([heading('h-1', 'Running'), para('p-1', 'note')])
    expect(findSectionTitle(tracker, 'h-1')).toBe('Running')
  })

  it('falls back to the first non-empty paragraph when the cell has no bold line', () => {
    const tracker = doc([
      singleColumnTable([
        cell([para('cat-1', 'Misc Notes'), bulletList('list-1', [para('item-1', 'random thought')])]),
      ]),
    ])
    expect(findSectionTitle(tracker, 'item-1')).toBe('Misc Notes')
  })

  it('skips a leading empty paragraph for the first-non-empty fallback', () => {
    const tracker = doc([
      singleColumnTable([
        cell([para('blank', ''), para('cat-1', 'Misc Notes'), para('item-1', 'thought')]),
      ]),
    ])
    expect(findSectionTitle(tracker, 'item-1')).toBe('Misc Notes')
  })

  it('returns null for a missing or unresolvable id', () => {
    const tracker = doc([
      singleColumnTable([cell([boldPara('cat-1', 'Running'), para('item-1', 'go run')])]),
    ])
    expect(findSectionTitle(tracker, 'does-not-exist')).toBeNull()
    expect(findSectionTitle(tracker, '')).toBeNull()
  })

  it('returns null when a heading-less, table-less target has no section', () => {
    const tracker = doc([para('p-1', 'floating note')])
    expect(findSectionTitle(tracker, 'p-1')).toBeNull()
  })

  it('returns clean plain text for categories with markdown-special characters', () => {
    const tracker = doc([
      singleColumnTable([
        cell([boldPara('cat-1', 'Rewards/Credit Cards'), para('item-1', 'redeem points')]),
        cell([boldPara('cat-2', 'Friends & Family'), para('item-2', 'call mom')]),
      ]),
    ])
    expect(findSectionTitle(tracker, 'item-1')).toBe('Rewards/Credit Cards')
    expect(findSectionTitle(tracker, 'item-2')).toBe('Friends & Family')
  })
})

describe('findPlacementPath', () => {
  const li = (p: Node, sub?: Node): Node => ({ type: 'listItem', content: sub ? [p, sub] : [p] })
  const list = (id: string, items: Node[]): Node => ({ type: 'bulletList', attrs: { id }, content: items })

  const tracker = doc([
    singleColumnTable([
      cell([
        boldPara('running', 'Running'),
        para('bg', 'Background: All things running'),
        list('next', [
          li(boldPara('cat-jerry', 'Jerry Updates'), list('jerry-list', [li(para('jerry-1', 'Update to Jerry'))])),
          li(boldPara('cat-aws', 'AWS'), list('aws-list', [li(para('aws-1', 'Upgrade AWS Instance'))])),
        ]),
      ]),
      cell([
        boldPara('apt', 'Apartment Stuff & Chores'),
        list('apt-list', [li(para('apt-1', 'Clean oven'))]),
        boldPara('work', 'Work'),
        list('work-list', [li(para('work-1', 'Double check leave balance'))]),
      ]),
    ]),
  ])

  it('names the category when the target is the category line', () => {
    expect(findPlacementPath(tracker, 'cat-jerry')).toEqual({ section: 'Running', category: 'Jerry Updates' })
  })

  it('names the category for a line or list inside it', () => {
    expect(findPlacementPath(tracker, 'jerry-1')).toEqual({ section: 'Running', category: 'Jerry Updates' })
    expect(findPlacementPath(tracker, 'aws-list')).toEqual({ section: 'Running', category: 'AWS' })
  })

  it('has no category for the list that holds the categories', () => {
    expect(findPlacementPath(tracker, 'next')).toEqual({ section: 'Running', category: null })
  })

  it('picks the right section when one cell holds two', () => {
    expect(findPlacementPath(tracker, 'work-1').section).toBe('Work')
    expect(findPlacementPath(tracker, 'apt-1').section).toBe('Apartment Stuff & Chores')
  })
})
