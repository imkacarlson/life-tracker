import { describe, expect, it } from 'vitest'

import { buildInlineRuns, buildItems, insertRelativeToBlock } from './insertContent.ts'
import type { TiptapNode } from './insertContent.ts'

const CYAN = '#67e8f9'

// The highlight mark a cyan-highlighted date run should carry.
const dateHighlight = [{ type: 'highlight', attrs: { color: CYAN } }]

// The first paragraph's inline runs for a single built item.
function runsForItem(item: string): TiptapNode[] {
  const para = buildItems('paragraphs', [item])[0]
  return para.content ?? []
}

// Find a block by id anywhere in the doc (depth-first).
function findById(node: TiptapNode, id: string): TiptapNode | null {
  if (node.attrs?.id === id) return node
  for (const child of node.content ?? []) {
    const hit = findById(child, id)
    if (hit) return hit
  }
  return null
}

// Collect the plain text of a node tree.
function textOf(node: TiptapNode): string {
  if (node.type === 'text') return node.text ?? ''
  return (node.content ?? []).map(textOf).join('')
}

const para = (id: string, text: string): TiptapNode => ({
  type: 'paragraph',
  attrs: { id },
  content: [{ type: 'text', text }],
})

describe('buildItems', () => {
  it('builds a bullet list wrapper with a fresh id and one item per line', () => {
    const nodes = buildItems('bullet_list', ['a', 'b'])
    expect(nodes).toHaveLength(1)
    expect(nodes[0].type).toBe('bulletList')
    expect(typeof nodes[0].attrs?.id).toBe('string')
    expect(nodes[0].content).toHaveLength(2)
    expect(nodes[0].content?.[0].type).toBe('listItem')
    expect(textOf(nodes[0])).toBe('ab')
  })

  it('builds a task list with unchecked items', () => {
    const nodes = buildItems('task_list', ['ship it'])
    expect(nodes[0].type).toBe('taskList')
    const item = nodes[0].content?.[0]
    expect(item?.type).toBe('taskItem')
    expect(item?.attrs?.checked).toBe(false)
  })

  it('builds one paragraph per item for the paragraphs format', () => {
    const nodes = buildItems('paragraphs', ['one', 'two', 'three'])
    expect(nodes).toHaveLength(3)
    expect(nodes.every((n) => n.type === 'paragraph')).toBe(true)
    expect(nodes.map((n) => n.attrs?.id).every((id) => typeof id === 'string')).toBe(true)
  })

  it('drops blank items and emits an empty (valid) paragraph for empties', () => {
    const nodes = buildItems('bullet_list', ['keep', '   ', ''])
    expect(nodes[0].content).toHaveLength(1)
  })

  it('gives every inserted block a distinct id', () => {
    const nodes = buildItems('paragraphs', ['x', 'y'])
    const ids = nodes.map((n) => n.attrs?.id)
    expect(new Set(ids).size).toBe(2)
  })
})

describe('buildInlineRuns — cyan date highlighting', () => {
  it('splits a {{date:…}} token into a plain run + a cyan-highlighted run', () => {
    const runs = runsForItem('renew pass {{date:6/15}}')
    expect(runs).toHaveLength(2)
    expect(runs[0]).toEqual({ type: 'text', text: 'renew pass ' })
    expect(runs[1]).toEqual({ type: 'text', text: '6/15', marks: dateHighlight })
    // Visible text is unchanged (no token, no braces).
    expect(textOf({ type: 'paragraph', content: runs })).toBe('renew pass 6/15')
  })

  it('highlights only the date, leaving qualifier words ("by EOD") plain', () => {
    // The user highlights the date alone; "by EOD" stays outside the token.
    const runs = runsForItem('finish report by EOD {{date:2/8}}')
    expect(runs[0]).toEqual({ type: 'text', text: 'finish report by EOD ' })
    expect(runs[1]).toEqual({ type: 'text', text: '2/8', marks: dateHighlight })
  })

  it('keeps a clock time inside the highlighted date ("6/16 6:59 PM")', () => {
    const runs = runsForItem('call w/ Sam {{date:6/16 6:59 PM}}')
    const highlighted = runs.find((r) => r.marks)
    expect(highlighted).toEqual({ type: 'text', text: '6/16 6:59 PM', marks: dateHighlight })
  })

  it('handles a token at the start of the item', () => {
    const runs = buildInlineRuns('{{date:3/13}} kickoff')
    expect(runs).toHaveLength(2)
    expect(runs[0]).toEqual({ type: 'text', text: '3/13', marks: dateHighlight })
    expect(runs[1]).toEqual({ type: 'text', text: ' kickoff' })
  })

  it('handles a token in the middle of the item', () => {
    const runs = buildInlineRuns('pay rent {{date:6/1}} via portal')
    expect(runs.map((r) => r.text)).toEqual(['pay rent ', '6/1', ' via portal'])
    expect(runs[1].marks).toEqual(dateHighlight)
    expect(runs[0].marks).toBeUndefined()
    expect(runs[2].marks).toBeUndefined()
  })

  it('handles a token at the end of the item', () => {
    const runs = buildInlineRuns('submit taxes {{date:4/15}}')
    expect(runs[runs.length - 1]).toEqual({ type: 'text', text: '4/15', marks: dateHighlight })
  })

  it('handles multiple tokens in one item', () => {
    const runs = buildInlineRuns('trip {{date:6/10}} to {{date:6/14}}')
    const highlighted = runs.filter((r) => r.marks)
    expect(highlighted.map((r) => r.text)).toEqual(['6/10', '6/14'])
    expect(textOf({ type: 'paragraph', content: runs })).toBe('trip 6/10 to 6/14')
  })

  it('handles an item that is only a token', () => {
    const runs = buildInlineRuns('{{date:6/15}}')
    expect(runs).toEqual([{ type: 'text', text: '6/15', marks: dateHighlight }])
  })

  it('trims whitespace inside the token', () => {
    const runs = buildInlineRuns('renew {{date:  6/15  }}')
    expect(runs[1]).toEqual({ type: 'text', text: '6/15', marks: dateHighlight })
  })

  it('leaves a no-token item as a single plain text node', () => {
    const runs = runsForItem('buy more gels')
    expect(runs).toEqual([{ type: 'text', text: 'buy more gels' }])
  })

  it('still yields content: [] for an empty item', () => {
    // Blank items are dropped by buildItems' clean step, so build the paragraph
    // path directly: an all-whitespace token leaves no runs.
    expect(buildInlineRuns('')).toEqual([])
    expect(buildInlineRuns('{{date:   }}')).toEqual([])
  })
})

describe('insertRelativeToBlock — after_block', () => {
  it('inserts after a heading and reports the inserted top-level id', () => {
    const doc: TiptapNode = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { id: 'h1', level: 2 }, content: [{ type: 'text', text: 'Running' }] },
        para('p1', 'existing'),
      ],
    }
    const nodes = buildItems('bullet_list', ['buy more gels'])
    const { doc: out, insertedBlockIds } = insertRelativeToBlock(doc, 'h1', 'after_block', nodes)

    // Order: heading, new list, existing paragraph.
    expect(out.content?.map((n) => n.type)).toEqual(['heading', 'bulletList', 'paragraph'])
    expect(insertedBlockIds).toHaveLength(1)
    expect(findById(out, insertedBlockIds[0])).not.toBeNull()
    // Original doc is untouched (immutability).
    expect(doc.content).toHaveLength(2)
  })

  it('inserts multiple paragraphs after a block and reports all ids', () => {
    const doc: TiptapNode = {
      type: 'doc',
      content: [para('anchor', 'here')],
    }
    const nodes = buildItems('paragraphs', ['first', 'second'])
    const { doc: out, insertedBlockIds } = insertRelativeToBlock(doc, 'anchor', 'after_block', nodes)

    expect(insertedBlockIds).toHaveLength(2)
    for (const id of insertedBlockIds) {
      expect(findById(out, id)).not.toBeNull()
    }
    expect(out.content).toHaveLength(3)
  })

  it('inserts under an empty section (target is a lone heading)', () => {
    const doc: TiptapNode = {
      type: 'doc',
      content: [{ type: 'heading', attrs: { id: 'finance' }, content: [{ type: 'text', text: 'Finance' }] }],
    }
    const nodes = buildItems('bullet_list', ['call accountant'])
    const { doc: out, insertedBlockIds } = insertRelativeToBlock(doc, 'finance', 'after_block', nodes)

    expect(out.content?.map((n) => n.type)).toEqual(['heading', 'bulletList'])
    expect(findById(out, insertedBlockIds[0])).not.toBeNull()
  })

  it('finds an anchor nested inside a table cell', () => {
    const doc: TiptapNode = {
      type: 'doc',
      content: [
        {
          type: 'table',
          attrs: { id: 't1' },
          content: [
            {
              type: 'tableRow',
              content: [
                { type: 'tableCell', content: [para('cellp', 'category')] },
              ],
            },
          ],
        },
      ],
    }
    const nodes = buildItems('paragraphs', ['nested add'])
    const { doc: out, insertedBlockIds } = insertRelativeToBlock(doc, 'cellp', 'after_block', nodes)

    expect(insertedBlockIds).toHaveLength(1)
    const found = findById(out, insertedBlockIds[0])
    expect(found).not.toBeNull()
    // The inserted paragraph lives inside the same cell, after the anchor.
    const cell = out.content?.[0].content?.[0].content?.[0]
    expect(cell?.content?.map((n) => n.type)).toEqual(['paragraph', 'paragraph'])
  })
})

describe('insertRelativeToBlock — append_to_list', () => {
  it('appends items into an existing bullet list and highlights only the new lines', () => {
    const doc: TiptapNode = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          attrs: { id: 'list1' },
          content: [
            { type: 'listItem', content: [para('old1', 'milk')] },
          ],
        },
      ],
    }
    const nodes = buildItems('bullet_list', ['eggs', 'bread'])
    const { doc: out, insertedBlockIds } = insertRelativeToBlock(doc, 'list1', 'append_to_list', nodes)

    const list = out.content?.[0]
    expect(list?.type).toBe('bulletList')
    expect(list?.content).toHaveLength(3) // 1 existing + 2 new
    // Highlighted ids are the new items' inner paragraphs, not the whole list.
    expect(insertedBlockIds).toHaveLength(2)
    expect(insertedBlockIds).not.toContain('list1')
    for (const id of insertedBlockIds) {
      expect(findById(out, id)).not.toBeNull()
    }
  })

  it('coerces items to task items when the target is a task list', () => {
    const doc: TiptapNode = {
      type: 'doc',
      content: [
        {
          type: 'taskList',
          attrs: { id: 'tl' },
          content: [{ type: 'taskItem', attrs: { checked: false }, content: [para('t0', 'done?')] }],
        },
      ],
    }
    // Proposer passed bullet_list, but the target is a task list — coerce.
    const nodes = buildItems('bullet_list', ['new task'])
    const { doc: out } = insertRelativeToBlock(doc, 'tl', 'append_to_list', nodes)

    const list = out.content?.[0]
    expect(list?.content).toHaveLength(2)
    expect(list?.content?.[1].type).toBe('taskItem')
    expect(list?.content?.[1].attrs?.checked).toBe(false)
  })

  it('falls back to inserting a new list after the target when it is not a list', () => {
    const doc: TiptapNode = {
      type: 'doc',
      content: [para('p1', 'not a list')],
    }
    const nodes = buildItems('bullet_list', ['x'])
    const { doc: out, insertedBlockIds } = insertRelativeToBlock(doc, 'p1', 'append_to_list', nodes)

    expect(out.content?.map((n) => n.type)).toEqual(['paragraph', 'bulletList'])
    expect(insertedBlockIds).toHaveLength(1) // the new list wrapper id
  })
})

describe('insertRelativeToBlock — edge cases', () => {
  it('returns empty insertedBlockIds when the anchor is gone', () => {
    const doc: TiptapNode = { type: 'doc', content: [para('p1', 'hi')] }
    const nodes = buildItems('bullet_list', ['x'])
    const { doc: out, insertedBlockIds } = insertRelativeToBlock(doc, 'missing', 'after_block', nodes)
    expect(insertedBlockIds).toEqual([])
    expect(out).toBe(doc) // unchanged reference
  })

  it('appends to the end of the doc when targetBlockId is null', () => {
    const doc: TiptapNode = { type: 'doc', content: [para('p1', 'hi')] }
    const nodes = buildItems('paragraphs', ['tail'])
    const { doc: out, insertedBlockIds } = insertRelativeToBlock(doc, null, 'after_block', nodes)
    expect(out.content).toHaveLength(2)
    expect(out.content?.[1].attrs?.id).toBe(insertedBlockIds[0])
  })
})

// --- category layout (the user's tracker after the Sept 2026 reorg) ---
//
// Next steps list ("next"):
//   - **Clubs XC**              (category, has a nested list)
//       - Happening on 12/26
//   - **Jerry Updates**         (category, has a nested list)
//       - Update to Jerry 9/20
//       - Update to Jerry 9/27
//   - **Working with a doctor** (category, empty)

const boldPara = (id: string, text: string): TiptapNode => ({
  type: 'paragraph',
  attrs: { id },
  content: [{ type: 'text', text, marks: [{ type: 'bold' }] }],
})

const li = (p: TiptapNode, sub?: TiptapNode): TiptapNode => ({
  type: 'listItem',
  content: sub ? [p, sub] : [p],
})

const bullets = (id: string, items: TiptapNode[]): TiptapNode => ({ type: 'bulletList', attrs: { id }, content: items })

function categoryDoc(): TiptapNode {
  return {
    type: 'doc',
    content: [
      bullets('next', [
        li(boldPara('cat-clubs', 'Clubs XC'), bullets('clubs-list', [li(para('clubs-1', 'Happening on 12/26'))])),
        li(
          boldPara('cat-jerry', 'Jerry Updates'),
          bullets('jerry-list', [li(para('jerry-1', 'Update to Jerry 9/20')), li(para('jerry-2', 'Update to Jerry 9/27'))]),
        ),
        li(boldPara('cat-doctor', 'Working with a doctor')),
      ]),
    ],
  }
}

// Titles of the category list, in order.
const categoryTitles = (doc: TiptapNode): string[] =>
  (findById(doc, 'next')?.content ?? []).map((item) => textOf(item.content?.[0] ?? {}))

// Text of the lines nested directly under a category.
const linesUnder = (doc: TiptapNode, categoryParaId: string): string[] => {
  const item = (findById(doc, 'next')?.content ?? []).find((i) => i.content?.[0]?.attrs?.id === categoryParaId)
  const sub = item?.content?.find((c) => c.type === 'bulletList')
  return (sub?.content ?? []).map((i) => textOf(i.content?.[0] ?? {}))
}

describe('insertRelativeToBlock — after_block on a list line (indentation fix)', () => {
  it('adds a sibling at the same level instead of nesting under the line', () => {
    const nodes = buildItems('bullet_list', ['Update to Jerry 10/4'])
    const { doc: out, insertedBlockIds } = insertRelativeToBlock(categoryDoc(), 'jerry-2', 'after_block', nodes)

    expect(linesUnder(out, 'cat-jerry')).toEqual(['Update to Jerry 9/20', 'Update to Jerry 9/27', 'Update to Jerry 10/4'])
    // The anchored line gained no child list.
    const jerry2 = (findById(out, 'jerry-list')?.content ?? [])[1]
    expect(jerry2.content?.map((c) => c.type)).toEqual(['paragraph'])
    expect(insertedBlockIds).toHaveLength(1)
    expect(textOf(findById(out, insertedBlockIds[0]) ?? {})).toBe('Update to Jerry 10/4')
  })

  it('adds the sibling right after the anchor, not at the end of the list', () => {
    const nodes = buildItems('bullet_list', ['middle'])
    const { doc: out } = insertRelativeToBlock(categoryDoc(), 'jerry-1', 'after_block', nodes)
    expect(linesUnder(out, 'cat-jerry')).toEqual(['Update to Jerry 9/20', 'middle', 'Update to Jerry 9/27'])
  })

  it('puts a plain bullet after a checkbox list (same level) rather than inside it', () => {
    const doc: TiptapNode = {
      type: 'doc',
      content: [
        {
          type: 'taskList',
          attrs: { id: 'tasks' },
          content: [{ type: 'taskItem', attrs: { checked: false }, content: [para('t1', 'task one')] }],
        },
      ],
    }
    const nodes = buildItems('bullet_list', ['plain bullet'])
    const { doc: out, insertedBlockIds } = insertRelativeToBlock(doc, 't1', 'after_block', nodes)

    expect(out.content?.map((n) => n.type)).toEqual(['taskList', 'bulletList'])
    expect(out.content?.[0].content).toHaveLength(1)
    expect(findById(out, insertedBlockIds[0])?.type).toBe('bulletList')
  })
})

describe('insertRelativeToBlock — into_category', () => {
  it('appends to the bottom of the category', () => {
    const nodes = buildItems('bullet_list', ['Update to Jerry 10/4'])
    const { doc: out, insertedBlockIds } = insertRelativeToBlock(categoryDoc(), 'cat-jerry', 'into_category', nodes)

    expect(linesUnder(out, 'cat-jerry')).toEqual(['Update to Jerry 9/20', 'Update to Jerry 9/27', 'Update to Jerry 10/4'])
    expect(categoryTitles(out)).toEqual(['Clubs XC', 'Jerry Updates', 'Working with a doctor'])
    expect(textOf(findById(out, insertedBlockIds[0]) ?? {})).toBe('Update to Jerry 10/4')
  })

  it('starts the list under an empty category', () => {
    const nodes = buildItems('bullet_list', ['Book appointment'])
    const { doc: out, insertedBlockIds } = insertRelativeToBlock(categoryDoc(), 'cat-doctor', 'into_category', nodes)

    expect(linesUnder(out, 'cat-doctor')).toEqual(['Book appointment'])
    expect(insertedBlockIds).toHaveLength(1)
  })

  it('appends when pointed at the category list itself', () => {
    const nodes = buildItems('bullet_list', ['Flights booked'])
    const { doc: out } = insertRelativeToBlock(categoryDoc(), 'clubs-list', 'into_category', nodes)
    expect(linesUnder(out, 'cat-clubs')).toEqual(['Happening on 12/26', 'Flights booked'])
  })
})

describe('insertRelativeToBlock — new_category', () => {
  it('creates a bold category in alphabetical position with the items under it', () => {
    const nodes = buildItems('bullet_list', ['Buy new shoes'])
    const { doc: out, insertedBlockIds, createdCategory } = insertRelativeToBlock(
      categoryDoc(),
      'next',
      'new_category',
      nodes,
      { category: 'Other' },
    )

    expect(createdCategory).toBe(true)
    expect(categoryTitles(out)).toEqual(['Clubs XC', 'Jerry Updates', 'Other', 'Working with a doctor'])
    const heading = findById(out, insertedBlockIds[0])
    expect(textOf(heading ?? {})).toBe('Other')
    expect(heading?.content?.[0].marks).toEqual([{ type: 'bold' }])
    expect(textOf(findById(out, insertedBlockIds[1]) ?? {})).toBe('Buy new shoes')
  })

  it('appends to an existing category with the same name instead of duplicating it', () => {
    const nodes = buildItems('bullet_list', ['Update to Jerry 10/4'])
    const { doc: out, createdCategory } = insertRelativeToBlock(categoryDoc(), 'next', 'new_category', nodes, {
      category: 'jerry updates',
    })

    expect(createdCategory).toBeUndefined()
    expect(categoryTitles(out)).toEqual(['Clubs XC', 'Jerry Updates', 'Working with a doctor'])
    expect(linesUnder(out, 'cat-jerry')).toHaveLength(3)
  })

  it('goes last when it sorts after every existing category', () => {
    const nodes = buildItems('bullet_list', ['x'])
    const { doc: out } = insertRelativeToBlock(categoryDoc(), 'next', 'new_category', nodes, { category: 'Zoo' })
    expect(categoryTitles(out).at(-1)).toBe('Zoo')
  })
})
