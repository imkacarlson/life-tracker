import { describe, expect, it } from 'vitest'
import { Schema } from '@tiptap/pm/model'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { getToolbarEditorState, isTextColorActive } from '../toolbarEditorState'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    text: { group: 'inline' },
  },
  marks: {
    bold: {},
    italic: {},
    underline: {},
    highlight: { attrs: { color: { default: null } } },
    strike: {},
    textStyle: { attrs: { color: { default: null } } },
  },
})

const paragraphState = (text, markName = null) => {
  const textNode = text ? schema.text(text) : null
  let state = EditorState.create({
    schema,
    doc: schema.nodes.doc.create(null, [schema.nodes.paragraph.create(null, textNode)]),
  })
  if (markName && text) {
    state = state.apply(state.tr.addMark(1, text.length + 1, schema.marks[markName].create()))
  }
  const cursor = Math.max(1, text.length)
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, cursor)))
}

const makeEditor = (
  state,
  { active = [], headerShading = null, cellShading = null } = {},
) => {
  const activeStates = new Set(active)
  return {
    state,
    schema,
    isActive(name, attrs) {
      if (typeof name === 'object') return activeStates.has(`align:${name.textAlign}`)
      if (name === 'heading') return activeStates.has(`heading:${attrs?.level}`)
      return activeStates.has(name)
    },
    getAttributes(name) {
      if (name === 'tableHeader') return { backgroundColor: headerShading }
      if (name === 'tableCell') return { backgroundColor: cellShading }
      return {}
    },
  }
}

describe('getToolbarEditorState', () => {
  it('returns the inactive toolbar state without an editor', () => {
    expect(getToolbarEditorState(null)).toMatchObject({
      bold: false,
      highlight: false,
      bulletList: false,
      cellShading: null,
    })
  })

  it('captures every shared editor value that changes a toolbar affordance', () => {
    const editor = makeEditor(paragraphState('bold line', 'bold'), {
      active: ['strike', 'heading:1', 'bulletList', 'align:center'],
      cellShading: '#00ff00',
    })

    expect(getToolbarEditorState(editor)).toMatchObject({
      bold: true,
      strike: true,
      heading1: true,
      bulletList: true,
      alignCenter: true,
      cellShading: '#00ff00',
    })
  })

  it('stays equal across typing when visible toolbar state is unchanged', () => {
    const beforeTyping = getToolbarEditorState(makeEditor(paragraphState('a')))
    const afterTyping = getToolbarEditorState(makeEditor(paragraphState('ab')))

    expect(afterTyping).toEqual(beforeTyping)
  })

  it('changes when a visible mark or cell color changes', () => {
    const plain = getToolbarEditorState(makeEditor(paragraphState('line')))
    const bold = getToolbarEditorState(makeEditor(paragraphState('line', 'bold')))
    const shaded = getToolbarEditorState(
      makeEditor(paragraphState('line'), { headerShading: '#fef08a' }),
    )

    expect(bold).not.toEqual(plain)
    expect(shaded).not.toEqual(plain)
  })
})

describe('isTextColorActive', () => {
  it('uses the remembered color when checking the selection', () => {
    const editor = makeEditor(paragraphState('line'), { active: ['textStyle:#ff0000'] })
    editor.isActive = (name, attrs) =>
      name === 'textStyle' && attrs?.color === '#ff0000'

    expect(isTextColorActive(editor, '#ff0000')).toBe(true)
    expect(isTextColorActive(editor, '#00ff00')).toBe(false)
    expect(isTextColorActive(editor, null)).toBe(false)
  })
})
