import { useMemo, useRef, useState } from 'react'
import {
  BoldIcon, ItalicIcon, UnderlineIcon, StrikethroughIcon,
  HighlightIcon,
} from '../../ToolbarIcons'
import { toggleLineStrike } from '../../../../extensions/keyboard/toggleLineStrike'
import { useEditorUIStore } from '../../../../stores/editorUIStore'
import HighlightPicker from '../HighlightPicker'
import { useOutsideClick } from '../useOutsideClick'
import { cmd } from '../toolHelpers'
import {
  applyMarkSmart,
  toggleMarkSmart,
  isMarkActiveForBlockToggle,
  isMarkActiveForToggle,
  syncSelectionFromDom,
} from '../../../../utils/smartMark'
import { HIGHLIGHT_COLORS, TEXT_COLORS } from '../toolConstants'
import { Btn } from './ToolButton'

// --- Inline marks ---------------------------------------------------------

// Bold/Italic/Underline use the user's line-level cursor behavior: a collapsed
// caret formats the current paragraph/list item AND arms continued typing.
// Highlight is the exception and remains word-level below. On an empty block /
// whitespace caret, there's nothing to grab, so toggleMarkSmart just arms the
// next typed characters.
function toggleInlineMark(editor, markName) {
  const markType = editor?.schema.marks[markName]
  if (!editor || !markType) return
  toggleMarkSmart(editor, markType, { level: 'block' })
}

function isInlineMarkActive(editor, markName) {
  const markType = editor?.schema.marks[markName]
  return editor && markType ? isMarkActiveForBlockToggle(editor.state, markType) : false
}

export function BoldTool({ editor }) {
  return (
    <Btn
      active={isInlineMarkActive(editor, 'bold')}
      onActivate={() => toggleInlineMark(editor, 'bold')}
      title="Bold"
    >
      <BoldIcon />
    </Btn>
  )
}

export function ItalicTool({ editor }) {
  return (
    <Btn
      active={isInlineMarkActive(editor, 'italic')}
      onActivate={() => toggleInlineMark(editor, 'italic')}
      title="Italic"
    >
      <ItalicIcon />
    </Btn>
  )
}

export function UnderlineTool({ editor }) {
  return (
    <Btn
      active={isInlineMarkActive(editor, 'underline')}
      onActivate={() => toggleInlineMark(editor, 'underline')}
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

// Apply (color) or remove (color === null) the highlight via the shared smart-mark
// core at word level. A collapsed caret in a word marks the WHOLE word (and arms
// continued typing) without changing the visible selection, so the cursor stays
// put and no blue overlay hides the color. A whitespace caret just arms.
function setHighlightSmart(editor, color) {
  if (!editor) return
  const markType = editor.schema.marks.highlight
  applyMarkSmart(editor, markType, {
    level: 'word',
    attrs: color ? { color } : null,
    remove: !color,
  })
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
    ? isMarkActiveForToggle(editor.state, editor.schema.marks.highlight)
    : false

  const apply = () => {
    syncSelectionFromDom(editor)
    const activeNow = editor
      ? isMarkActiveForToggle(editor.state, editor.schema.marks.highlight)
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

  // Text color is the attribute-mark sibling of Highlight: the textStyle mark
  // carries a `color` attr. It follows the regular formatting tools, so a
  // collapsed caret colors the current paragraph/list item (and arms continued
  // typing). An empty block / whitespace caret just arms.
  const setColorSmart = (color) => {
    if (!editor) return
    const markType = editor.schema.marks.textStyle
    applyMarkSmart(editor, markType, {
      level: 'block',
      attrs: color ? { color } : null,
      remove: !color,
    })
  }

  const apply = () => setColorSmart(textColor || null)

  const pick = (color) => {
    setTextColor(color || null)
    setColorSmart(color || null)
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
