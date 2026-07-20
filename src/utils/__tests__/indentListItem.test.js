import { describe, it, expect } from 'vitest'
import { Schema } from '@tiptap/pm/model'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { buildIndentWithoutChildrenTransaction } from '../indentListItem'

// Minimal ProseMirror schema mirroring the app's list node types.
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

const { doc, paragraph, bulletList, orderedList, taskList, listItem, taskItem } = schema.nodes

const p = (text) => paragraph.create(null, text ? schema.text(text) : undefined)
const li = (...blocks) => listItem.create(null, blocks)
const ti = (...blocks) => taskItem.create(null, blocks)
const ul = (...items) => bulletList.create(null, items)
const ol = (...items) => orderedList.create(null, items)
const tl = (...items) => taskList.create(null, items)

const makeState = (docNode) => EditorState.create({ doc: docNode, schema })

// Find the position just inside a text node with the given content.
const posInText = (docNode, text) => {
  let found = null
  docNode.descendants((node, pos) => {
    if (node.isText && node.text === text) {
      found = pos + 1
      return false
    }
    return true
  })
  if (found === null) throw new Error(`text "${text}" not found in doc`)
  return found
}

// Count how many list ancestors wrap the given text node — its "list depth".
const listDepthOfText = (docNode, text) => {
  const $pos = docNode.resolve(posInText(docNode, text))
  let depth = 0
  for (let d = 0; d <= $pos.depth; d += 1) {
    const name = $pos.node(d).type.name
    if (name === 'bulletList' || name === 'orderedList' || name === 'taskList') depth += 1
  }
  return depth
}

const selectInText = (state, text) => {
  const pos = posInText(state.doc, text)
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)))
}

describe('buildIndentWithoutChildrenTransaction — bullet/ordered listItem', () => {
  it('indents only the item, leaving its nested children at their original depth', () => {
    // ul > [ first, second > (childA, childB) ]
    const d = doc.create(null, [
      ul(
        li(p('first')),
        li(p('second'), ul(li(p('childA')), li(p('childB')))),
      ),
    ])
    let state = makeState(d)
    state = selectInText(state, 'second')

    const result = buildIndentWithoutChildrenTransaction(state, 'listItem')
    expect(result).toBeTruthy()
    expect(result.tr).toBeTruthy()

    const newDoc = result.tr.doc
    // 'second' moved one level deeper (was 1, now 2)
    expect(listDepthOfText(newDoc, 'second')).toBe(2)
    // Its former children stay put — NOT pushed to depth 3
    expect(listDepthOfText(newDoc, 'childA')).toBe(2)
    expect(listDepthOfText(newDoc, 'childB')).toBe(2)
    // First item stays at the top level
    expect(listDepthOfText(newDoc, 'first')).toBe(1)
  })

  it('keeps the selection inside the moved item after indenting', () => {
    const d = doc.create(null, [
      ul(
        li(p('first')),
        li(p('second'), ul(li(p('childA')))),
      ),
    ])
    let state = makeState(d)
    state = selectInText(state, 'second')

    const { tr } = buildIndentWithoutChildrenTransaction(state, 'listItem')
    const $from = tr.selection.$from
    expect($from.parent.textContent).toBe('second')
  })

  it('works for ordered lists', () => {
    const d = doc.create(null, [
      ol(
        li(p('one')),
        li(p('two'), ol(li(p('twoChild')))),
      ),
    ])
    let state = makeState(d)
    state = selectInText(state, 'two')

    const { tr } = buildIndentWithoutChildrenTransaction(state, 'listItem')
    expect(listDepthOfText(tr.doc, 'two')).toBe(2)
    expect(listDepthOfText(tr.doc, 'twoChild')).toBe(2)
  })

  it('falls back when the item has no nested child list', () => {
    const d = doc.create(null, [ul(li(p('first')), li(p('second')))])
    let state = makeState(d)
    state = selectInText(state, 'second')

    const result = buildIndentWithoutChildrenTransaction(state, 'listItem')
    expect(result).toEqual({ fallback: true })
  })

  it('returns null for the first item (nothing to indent under)', () => {
    const d = doc.create(null, [
      ul(
        li(p('first'), ul(li(p('firstChild')))),
        li(p('second')),
      ),
    ])
    let state = makeState(d)
    state = selectInText(state, 'first')

    const result = buildIndentWithoutChildrenTransaction(state, 'listItem')
    expect(result).toBeNull()
  })

  it('falls back for a non-collapsed selection', () => {
    const d = doc.create(null, [
      ul(
        li(p('first')),
        li(p('second'), ul(li(p('childA')))),
      ),
    ])
    let state = makeState(d)
    const start = posInText(state.doc, 'second')
    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, start, start + 3)),
    )

    const result = buildIndentWithoutChildrenTransaction(state, 'listItem')
    expect(result).toEqual({ fallback: true })
  })
})

describe('buildIndentWithoutChildrenTransaction — taskItem', () => {
  it('indents only the task item, leaving its nested task children at their original depth', () => {
    const d = doc.create(null, [
      tl(
        ti(p('todoA')),
        ti(p('todoB'), tl(ti(p('subtaskA')), ti(p('subtaskB')))),
      ),
    ])
    let state = makeState(d)
    state = selectInText(state, 'todoB')

    const result = buildIndentWithoutChildrenTransaction(state, 'taskItem')
    expect(result.tr).toBeTruthy()

    const newDoc = result.tr.doc
    expect(listDepthOfText(newDoc, 'todoB')).toBe(2)
    expect(listDepthOfText(newDoc, 'subtaskA')).toBe(2)
    expect(listDepthOfText(newDoc, 'subtaskB')).toBe(2)
    expect(listDepthOfText(newDoc, 'todoA')).toBe(1)
  })

  it('falls back when the task item has no nested child list', () => {
    const d = doc.create(null, [tl(ti(p('todoA')), ti(p('todoB')))])
    let state = makeState(d)
    state = selectInText(state, 'todoB')

    const result = buildIndentWithoutChildrenTransaction(state, 'taskItem')
    expect(result).toEqual({ fallback: true })
  })
})
