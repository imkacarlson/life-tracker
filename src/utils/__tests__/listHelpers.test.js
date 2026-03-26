import { describe, it, expect } from 'vitest'
import { Schema } from '@tiptap/pm/model'
import { EditorState } from '@tiptap/pm/state'
import { getListDepthAt, getListItemTypeAt } from '../listHelpers'

// Minimal ProseMirror schema with the node types getListDepthAt checks for.
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    text: { group: 'inline' },
    bulletList: { group: 'block', content: 'listItem+' },
    orderedList: { group: 'block', content: 'listItem+' },
    taskList: { group: 'block', content: 'taskItem+' },
    listItem: { content: 'block+', defining: true },
    taskItem: {
      content: 'block+',
      defining: true,
      attrs: { checked: { default: false } },
    },
  },
})

const { doc, paragraph, text, bulletList, orderedList, taskList, listItem, taskItem } = schema.nodes

// Helpers to build doc fragments concisely
const p = (...children) =>
  children.length > 0
    ? paragraph.create(null, children.map((c) => (typeof c === 'string' ? schema.text(c) : c)))
    : paragraph.create()

const li = (...blocks) => listItem.create(null, blocks)
const ti = (...blocks) => taskItem.create(null, blocks)
const ul = (...items) => bulletList.create(null, items)
const ol = (...items) => orderedList.create(null, items)
const tl = (...items) => taskList.create(null, items)

const makeState = (docNode) => EditorState.create({ doc: docNode, schema })

describe('getListDepthAt', () => {
  it('returns 0 for position inside a flat paragraph', () => {
    const d = doc.create(null, [p('hello')])
    const state = makeState(d)
    // pos 1 is inside the paragraph text
    expect(getListDepthAt(state, 1)).toBe(0)
  })

  it('returns 1 for position inside a top-level list item', () => {
    const d = doc.create(null, [ul(li(p('item')))])
    const state = makeState(d)
    // doc(0) > bulletList(1) > listItem(2) > paragraph(3) > text(4)
    expect(getListDepthAt(state, 4)).toBe(1)
  })

  it('returns 2 for position inside a nested list item', () => {
    const d = doc.create(null, [
      ul(li(p('outer'), ul(li(p('inner'))))),
    ])
    const state = makeState(d)
    // Find a position inside 'inner' text
    // Structure: doc > bulletList > listItem > [paragraph("outer"), bulletList > listItem > paragraph("inner")]
    const innerText = 'inner'
    let innerPos = null
    d.descendants((node, pos) => {
      if (node.isText && node.text === innerText) {
        innerPos = pos
      }
    })
    expect(innerPos).not.toBeNull()
    expect(getListDepthAt(state, innerPos)).toBe(2)
  })

  it('returns 1 for orderedList', () => {
    const d = doc.create(null, [ol(li(p('numbered')))])
    const state = makeState(d)
    expect(getListDepthAt(state, 4)).toBe(1)
  })

  it('returns 1 for taskList', () => {
    const d = doc.create(null, [tl(ti(p('task')))])
    const state = makeState(d)
    expect(getListDepthAt(state, 4)).toBe(1)
  })

  it('returns same depth at start and end of list item text', () => {
    const d = doc.create(null, [ul(li(p('hello')))])
    const state = makeState(d)
    // Start of text
    expect(getListDepthAt(state, 4)).toBe(1)
    // End of text (pos 4 + 5 chars = 9, but let's use nodeSize)
    expect(getListDepthAt(state, 8)).toBe(1)
  })
})

describe('getListItemTypeAt', () => {
  it('returns null for position outside any list', () => {
    const d = doc.create(null, [p('plain')])
    const state = makeState(d)
    expect(getListItemTypeAt(state, 1)).toBeNull()
  })

  it('returns "listItem" inside a bullet list', () => {
    const d = doc.create(null, [ul(li(p('bullet')))])
    const state = makeState(d)
    expect(getListItemTypeAt(state, 4)).toBe('listItem')
  })

  it('returns "taskItem" inside a task list', () => {
    const d = doc.create(null, [tl(ti(p('task')))])
    const state = makeState(d)
    expect(getListItemTypeAt(state, 4)).toBe('taskItem')
  })

  it('returns "listItem" inside an ordered list', () => {
    const d = doc.create(null, [ol(li(p('ordered')))])
    const state = makeState(d)
    expect(getListItemTypeAt(state, 4)).toBe('listItem')
  })
})
