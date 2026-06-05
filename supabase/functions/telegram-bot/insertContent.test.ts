import { describe, expect, it } from 'vitest'

import { buildItems, insertRelativeToBlock } from './insertContent.ts'
import type { TiptapNode } from './insertContent.ts'

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
