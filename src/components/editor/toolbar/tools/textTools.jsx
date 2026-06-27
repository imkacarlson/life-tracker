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
import { getWordRangeAt } from '../../../../utils/wordRange'
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

export function HighlightTool({ editor }) {
  const highlightColor = useEditorUIStore((s) => s.highlightColor)
  const setHighlightColor = useEditorUIStore((s) => s.setHighlightColor)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  const pickerRef = useRef(null)
  const refs = useMemo(() => [wrapRef, pickerRef], [])
  useOutsideClick({ isOpen: open, onClose: () => setOpen(false), refs })

  const apply = () => {
    if (!editor) return
    const { selection } = editor.state
    if (selection.empty) {
      const range = getWordRangeAt(editor.state)
      if (range) {
        const chain = editor.chain().focus().setTextSelection(range)
        // Toggle: already highlighted -> remove; otherwise apply current color.
        if (editor.isActive('highlight') || !highlightColor) chain.unsetHighlight().run()
        else chain.setHighlight({ color: highlightColor }).run()
        return
      }
    }
    // Unchanged: explicit selection (or no word under cursor) keeps today's behavior.
    if (!highlightColor) cmd(editor)?.unsetHighlight().run()
    else cmd(editor)?.setHighlight({ color: highlightColor }).run()
  }

  const pick = (color) => {
    if (!editor) return
    if (!color) {
      setHighlightColor(null)
      cmd(editor)?.unsetHighlight().run()
    } else {
      setHighlightColor(color)
      cmd(editor)?.setHighlight({ color }).run()
    }
    setOpen(false)
  }

  return (
    <div className="highlight-control" ref={wrapRef}>
      <Btn
        active={editor?.isActive('highlight')}
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
