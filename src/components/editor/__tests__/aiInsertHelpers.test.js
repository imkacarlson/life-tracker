import { describe, expect, it, vi } from 'vitest'
import { Schema } from '@tiptap/pm/model'
import { EditorState } from '@tiptap/pm/state'
import {
  findTargetBlockMatch,
  normalizeAiInsertResponse,
  resolveFallbackInsertPos,
  resolveInsertPosCandidatesFromTargetMatch,
  resolveListInsertPlan,
} from '../aiInsertHelpers'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      group: 'block',
      content: 'inline*',
      attrs: { id: { default: null }, created_at: { default: null } },
    },
    heading: {
      group: 'block',
      content: 'inline*',
      attrs: { id: { default: null }, created_at: { default: null }, level: { default: 1 } },
    },
    bulletList: {
      group: 'block',
      content: 'listItem+',
      attrs: { id: { default: null }, created_at: { default: null } },
    },
    listItem: { content: 'block+', defining: true },
    taskList: {
      group: 'block',
      content: 'taskItem+',
      attrs: { id: { default: null }, created_at: { default: null } },
    },
    taskItem: {
      content: 'block+',
      defining: true,
      attrs: { checked: { default: false } },
    },
    text: { group: 'inline' },
  },
  marks: {
    bold: {},
  },
})

const { doc, paragraph, bulletList, listItem } = schema.nodes
const text = (value, marks = null) => schema.text(value, marks)
const p = (id, value = '') => paragraph.create({ id }, value ? text(value) : null)
const li = (...blocks) => listItem.create(null, blocks)
const ul = (id, ...items) => bulletList.create({ id }, items)

const makeEditor = (docNode) => ({
  state: EditorState.create({ doc: docNode, schema }),
  schema,
})

describe('AI Insert target resolution', () => {
  it('finds a block by id and builds the direct after-block candidate first', () => {
    const editor = makeEditor(doc.create(null, [p('before', 'Before'), p('target', 'Target')]))
    const match = findTargetBlockMatch(editor, 'target')
    const candidates = resolveInsertPosCandidatesFromTargetMatch(editor, match)

    expect(match.node.attrs.id).toBe('target')
    expect(candidates[0]).toBe(match.pos + match.node.nodeSize)
    expect(new Set(candidates).size).toBe(candidates.length)
  })

  it('returns an insertion plan containing list items when the target is inside a list', () => {
    const editor = makeEditor(doc.create(null, [ul('list', li(p('target', 'Existing')))]))
    const match = findTargetBlockMatch(editor, 'target')
    const insertedItems = [
      { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'New' }] }] },
    ]
    const plan = resolveListInsertPlan(editor, match, [
      { type: 'bulletList', content: insertedItems },
    ])

    expect(plan).not.toBeNull()
    expect(plan.content).toBe(insertedItems)
    expect(plan.pos).toBeGreaterThan(match.pos)
    expect(plan.pos).toBeLessThanOrEqual(editor.state.doc.content.size)
  })

  it('rejects incompatible or empty inserted content', () => {
    const editor = makeEditor(doc.create(null, [p('target', 'Target')]))
    const match = findTargetBlockMatch(editor, 'target')

    expect(resolveListInsertPlan(editor, match, [])).toBeNull()
    expect(resolveListInsertPlan(editor, match, [{ type: 'paragraph' }])).toBeNull()
    expect(resolveListInsertPlan(editor, match, [{ type: 'bulletList', content: [] }])).toBeNull()
  })
})

describe('AI Insert fallback and response normalization', () => {
  it('inserts an Uncategorized header and returns the position after it', () => {
    const editor = makeEditor(doc.create(null, [p('body', 'Body')]))
    const run = vi.fn(() => true)
    const insertContentAt = vi.fn(() => ({ run }))
    const focus = vi.fn(() => ({ insertContentAt }))
    editor.chain = vi.fn(() => ({ focus }))

    const position = resolveFallbackInsertPos(editor)

    expect(position).toBeGreaterThan(0)
    expect(insertContentAt).toHaveBeenCalledWith(
      0,
      expect.objectContaining({ type: 'paragraph' }),
    )
  })

  it('normalizes items and falls back to bullet_list for unknown formats', () => {
    expect(
      normalizeAiInsertResponse({
        targetBlockId: '  block-1 ',
        format: 'unknown',
        items: [' first ', '', null, 'second'],
      }),
    ).toEqual({
      targetBlockId: 'block-1',
      format: 'bullet_list',
      items: ['first', 'second'],
    })
  })

  it('rejects an empty response', () => {
    expect(() => normalizeAiInsertResponse({ items: [] })).toThrow(
      'AI Insert returned no content to insert.',
    )
  })
})
