import {
  isMarkActiveForBlockToggle,
  isMarkActiveForToggle,
} from '../../../utils/smartMark'

const isBlockMarkActive = (editor, markName) => {
  const markType = editor?.schema?.marks?.[markName]
  return markType ? isMarkActiveForBlockToggle(editor.state, markType) : false
}

const isToggleMarkActive = (editor, markName) => {
  const markType = editor?.schema?.marks?.[markName]
  return markType ? isMarkActiveForToggle(editor.state, markType) : false
}

/**
 * Capture editor state used by tools that rely on the parent toolbar refresh.
 * Tiptap evaluates this after every transaction, but its deep-equality check
 * re-renders the toolbar only when one of these values actually changes. Text
 * color has its own selector because its active state also depends on a
 * remembered color from the UI store.
 */
export function getToolbarEditorState(editor) {
  if (!editor) {
    return {
      bold: false,
      italic: false,
      underline: false,
      highlight: false,
      strike: false,
      heading1: false,
      heading2: false,
      bulletList: false,
      orderedList: false,
      taskList: false,
      alignLeft: false,
      alignCenter: false,
      alignRight: false,
      cellShading: null,
    }
  }

  return {
    bold: isBlockMarkActive(editor, 'bold'),
    italic: isBlockMarkActive(editor, 'italic'),
    underline: isBlockMarkActive(editor, 'underline'),
    highlight: isToggleMarkActive(editor, 'highlight'),
    strike: editor.isActive('strike'),
    heading1: editor.isActive('heading', { level: 1 }),
    heading2: editor.isActive('heading', { level: 2 }),
    bulletList: editor.isActive('bulletList'),
    orderedList: editor.isActive('orderedList'),
    taskList: editor.isActive('taskList'),
    alignLeft: editor.isActive({ textAlign: 'left' }),
    alignCenter: editor.isActive({ textAlign: 'center' }),
    alignRight: editor.isActive({ textAlign: 'right' }),
    cellShading:
      editor.getAttributes('tableHeader')?.backgroundColor ||
      editor.getAttributes('tableCell')?.backgroundColor ||
      null,
  }
}

export const selectToolbarEditorState = ({ editor }) => getToolbarEditorState(editor)

export const isTextColorActive = (editor, color) =>
  Boolean(editor && color && editor.isActive('textStyle', { color }))
