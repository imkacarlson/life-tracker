import { useMemo, useRef, useState } from 'react'
import { TextSelection } from '@tiptap/pm/state'
import {
  BoldIcon, ItalicIcon, UnderlineIcon, StrikethroughIcon,
  HighlightIcon,
} from '../../ToolbarIcons'
import { toggleLineStrike } from '../../../../extensions/keyboard/toggleLineStrike'
import { useEditorUIStore } from '../../../../stores/editorUIStore'
import HighlightPicker from '../HighlightPicker'
import { useOutsideClick } from '../useOutsideClick'
import { cmd } from '../toolHelpers'
import { getWordRangeAt } from '../../../../utils/wordRange'
import { isHighlightActiveForToggle } from '../../../../utils/highlightState'
import { HIGHLIGHT_COLORS, TEXT_COLORS } from '../toolConstants'
import { Btn } from './ToolButton'

// --- Inline marks ---------------------------------------------------------

export function BoldTool({ editor }) {
  return (
    <Btn
      active={editor?.isActive('bold')}
      onActivate={() => cmd(editor)?.toggleBold().run()}
      title="Bold"
    >
      <BoldIcon />
    </Btn>
  )
}

export function ItalicTool({ editor }) {
  return (
    <Btn
      active={editor?.isActive('italic')}
      onActivate={() => cmd(editor)?.toggleItalic().run()}
      title="Italic"
    >
      <ItalicIcon />
    </Btn>
  )
}

export function UnderlineTool({ editor }) {
  return (
    <Btn
      active={editor?.isActive('underline')}
      onActivate={() => cmd(editor)?.toggleUnderline().run()}
      title="Underline"
    >
      <UnderlineIcon />
    </Btn>
  )
}

export function StrikeTool({ editor }) {
  return (
    <Btn
      active={editor?.isActive('strike')}
      onActivate={() => editor && toggleLineStrike(editor)}
      title="Strikethrough"
      ariaLabel="Toggle strikethrough"
      testId="toolbar-strikethrough"
    >
      <StrikethroughIcon />
    </Btn>
  )
}

// --- Headings -------------------------------------------------------------

export function H1Tool({ editor }) {
  return (
    <Btn
      active={editor?.isActive('heading', { level: 1 })}
      onActivate={() => cmd(editor)?.toggleHeading({ level: 1 }).run()}
      title="Heading 1"
    >
      <span className="toolbar-btn-label">H1</span>
    </Btn>
  )
}

export function H2Tool({ editor }) {
  return (
    <Btn
      active={editor?.isActive('heading', { level: 2 })}
      onActivate={() => cmd(editor)?.toggleHeading({ level: 2 }).run()}
      title="Heading 2"
    >
      <span className="toolbar-btn-label">H2</span>
    </Btn>
  )
}

// --- Highlight (with picker) ---------------------------------------------

// Apply (color) or remove (color === null) the highlight on the current selection.
// With a collapsed caret, act on the whole word under the cursor WITHOUT changing
// the visible selection, so the cursor stays put and no blue overlay hides the color.
function syncSelectionFromDom(editor) {
  const selection = window.getSelection?.()
  const anchorNode = selection?.anchorNode
  const focusNode = selection?.focusNode
  if (!editor || !selection || selection.rangeCount === 0 || !anchorNode || !focusNode) return

  const root = editor.view.dom
  const anchorElement =
    anchorNode.nodeType === Node.ELEMENT_NODE ? anchorNode : anchorNode.parentElement
  const focusElement =
    focusNode.nodeType === Node.ELEMENT_NODE ? focusNode : focusNode.parentElement
  if (!anchorElement || !focusElement) return
  if (!root.contains(anchorElement) || !root.contains(focusElement)) return

  try {
    const anchorPos = editor.view.posAtDOM(anchorNode, selection.anchorOffset)
    const headPos = editor.view.posAtDOM(focusNode, selection.focusOffset)
    const nextSelection = TextSelection.create(editor.state.doc, anchorPos, headPos)
    if (!nextSelection.eq(editor.state.selection)) {
      editor.view.dispatch(editor.state.tr.setSelection(nextSelection))
    }
  } catch {
    // Ignore stale DOM selections; the ProseMirror state remains authoritative.
  }
}

function setHighlightSmart(editor, color) {
  if (!editor) return
  syncSelectionFromDom(editor)
  const markType = editor.schema.marks.highlight
  const { selection } = editor.state

  if (selection.empty) {
    const range = getWordRangeAt(editor.state)
    if (range) {
      editor.chain().focus().command(({ tr, dispatch }) => {
        if (dispatch) {
          tr.removeMark(range.from, range.to, markType)
          if (color) tr.addMark(range.from, range.to, markType.create({ color }))
        }
        return true
      }).run()
      return
    }
  }

  if (!selection.empty) {
    const tr = editor.state.tr.removeMark(selection.from, selection.to, markType)
    if (color) tr.addMark(selection.from, selection.to, markType.create({ color }))
    editor.view.dispatch(tr)
    return
  }

  // Caret on whitespace: keep today's stored-mark behavior.
  if (!color) editor.chain().focus().unsetHighlight().run()
  else editor.chain().focus().setHighlight({ color }).run()
}

export function HighlightTool({ editor }) {
  const highlightColor = useEditorUIStore((s) => s.highlightColor)
  const setHighlightColor = useEditorUIStore((s) => s.setHighlightColor)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  const pickerRef = useRef(null)
  const refs = useMemo(() => [wrapRef, pickerRef], [])
  useOutsideClick({ isOpen: open, onClose: () => setOpen(false), refs })

  // Base the decision (and the button's active state) on whether the toggle
  // target — the word under a collapsed caret, or the selection — already
  // carries the highlight. isActive('highlight') reads caret-adjacency marks,
  // which the inclusive:false mark gets wrong at word edges, so toggling off
  // failed there.
  const highlightActive = editor
    ? isHighlightActiveForToggle(editor.state, editor.schema.marks.highlight)
    : false

  const apply = () => {
    syncSelectionFromDom(editor)
    const activeNow = editor
      ? isHighlightActiveForToggle(editor.state, editor.schema.marks.highlight)
      : false
    const remove = activeNow || !highlightColor
    setHighlightSmart(editor, remove ? null : highlightColor)
  }

  const pick = (color) => {
    setHighlightColor(color || null)
    setHighlightSmart(editor, color || null)
    setOpen(false)
  }

  return (
    <div className="highlight-control" ref={wrapRef}>
      <Btn
        active={highlightActive}
        onActivate={apply}
        title="Highlight"
      >
        <HighlightIcon />
        <span
          className="toolbar-color-bar"
          style={{ backgroundColor: highlightColor ?? 'transparent' }}
        />
      </Btn>
      <Btn
        className="toolbar-btn-caret"
        onActivate={() => setOpen((prev) => !prev)}
        ariaLabel="Highlight colors"
      >
        ▾
      </Btn>
      {open && (
        <HighlightPicker
          pickerRef={pickerRef}
          colors={HIGHLIGHT_COLORS}
          onPick={pick}
        />
      )}
    </div>
  )
}

// --- Text color (split button with picker) -------------------------------

export function TextColorTool({ editor }) {
  const textColor = useEditorUIStore((s) => s.textColor)
  const setTextColor = useEditorUIStore((s) => s.setTextColor)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  const pickerRef = useRef(null)
  const refs = useMemo(() => [wrapRef, pickerRef], [])
  useOutsideClick({ isOpen: open, onClose: () => setOpen(false), refs })

  const apply = () => {
    if (!editor) return
    if (!textColor) cmd(editor)?.unsetColor().run()
    else cmd(editor)?.setColor(textColor).run()
  }

  const pick = (color) => {
    if (!editor) return
    if (!color) {
      setTextColor(null)
      cmd(editor)?.unsetColor().run()
    } else {
      setTextColor(color)
      cmd(editor)?.setColor(color).run()
    }
    setOpen(false)
  }

  return (
    <div className="text-color-control" ref={wrapRef}>
      <Btn
        active={editor?.isActive('textStyle', { color: textColor })}
        onActivate={apply}
        title="Text color"
        ariaLabel="Text color"
      >
        <span className="toolbar-btn-label">A</span>
        <span
          className="toolbar-color-bar"
          style={{ backgroundColor: textColor ?? 'transparent' }}
        />
      </Btn>
      <Btn
        className="toolbar-btn-caret"
        onActivate={() => setOpen((prev) => !prev)}
        ariaLabel="Text colors"
      >
        ▾
      </Btn>
      {open && (
        <HighlightPicker
          pickerRef={pickerRef}
          colors={TEXT_COLORS}
          onPick={pick}
        />
      )}
    </div>
  )
}
