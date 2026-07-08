import { describe, it, expect } from 'vitest'
import { Schema } from '@tiptap/pm/model'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { getBlockTextRange } from '../blockRange'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    heading: { group: 'block', content: 'inline*', attrs: { level: { default: 1 } } },
    text: { group: 'inline' },
    bulletList: { group: 'block', content: 'listItem+' },
    taskList: { group: 'block', content: 'taskItem+' },
    listItem: { content: 'block+', defining: true },
    taskItem: {
      content: 'block+',
      defining: true,
      attrs: { checked: { default: false } },
    },
  },
})

const { doc, paragraph, heading, bulletList, taskList, listItem, taskItem } = schema.nodes

const p = (text) => paragraph.create(null, text ? schema.text(text) : null)
const h = (text) => heading.create({ level: 2 }, text ? schema.text(text) : null)
const li = (...blocks) => listItem.create(null, blocks)
const ti = (...blocks) => taskItem.create(null, blocks)
const ul = (...items) => bulletList.create(null, items)
const tl = (...items) => taskList.create(null, items)

const stateWithCursorInText = (docNode, text, offset = 0) => {
  let textPos = null
  docNode.descendants((node, pos) => {
    if (textPos !== null) return false
    if (node.isText && node.text === text) {
      textPos = pos
      return false
    }
    return true
  })

  if (textPos === null) throw new Error(`Could not find text "${text}"`)
  const state = EditorState.create({ doc: docNode, schema })
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, textPos + offset)))
}

describe('getBlockTextRange', () => {
  it('returns the current paragraph text range', () => {
    const state = stateWithCursorInText(doc.create(null, [p('plain line')]), 'plain line', 5)
    expect(getBlockTextRange(state)).toEqual({ from: 1, to: 11 })
  })

  it('returns the current heading text range', () => {
    const state = stateWithCursorInText(doc.create(null, [h('heading line')]), 'heading line', 4)
    expect(getBlockTextRange(state)).toEqual({ from: 1, to: 13 })
  })

  it('returns the paragraph range inside a list item', () => {
    const d = doc.create(null, [ul(li(p('list line')))])
    const state = stateWithCursorInText(d, 'list line', 4)
    expect(getBlockTextRange(state)).toEqual({ from: 3, to: 12 })
  })

  it('returns the paragraph range inside a task item', () => {
    const d = doc.create(null, [tl(ti(p('task line')))])
    const state = stateWithCursorInText(d, 'task line', 4)
    expect(getBlockTextRange(state)).toEqual({ from: 3, to: 12 })
  })
})
