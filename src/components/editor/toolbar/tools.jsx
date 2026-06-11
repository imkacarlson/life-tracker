import { useCallback, useMemo, useRef, useState } from 'react'
import { mixColors } from '../../../utils/colorUtils'
import { serializeDocForExport } from '../../../lib/serializeDocForExport'
import { toggleLineStrike } from '../../../extensions/keyboard/toggleLineStrike'
import { getListItemInfo } from '../../../utils/listHelpers'
import { useEditorUIStore } from '../../../stores/editorUIStore'
import ToolButton from '../ToolButton'
import HighlightPicker from './HighlightPicker'
import ShadingPicker from './ShadingPicker'
import TablePicker from './TablePicker'
import AiDailyPicker from './AiDailyPicker'
import MoreMenu from './MoreMenu'
import { useToolbarContext } from './ToolbarContext'
import { useOutsideClick } from './useOutsideClick'
import { TextSelection } from '@tiptap/pm/state'
import {
  BoldIcon, ItalicIcon, UnderlineIcon, StrikethroughIcon,
  HighlightIcon,
  BulletListIcon, OrderedListIcon, TaskListIcon,
  AlignLeftIcon, AlignCenterIcon, AlignRightIcon,
  LinkIcon, UnlinkIcon, ImageIcon,
  TableIcon, AddRowIcon, AddColIcon, DeleteTableIcon, ShadingIcon,
  UndoIcon, RedoIcon,
  SearchIcon, ExportIcon, CopyIcon, MoreIcon, AiIcon,
  IndentIcon, OutdentIcon,
} from '../ToolbarIcons'

// --- Shared helpers -------------------------------------------------------

const cmd = (editor) => editor?.chain().focus() ?? null

/** Thin ToolButton wrapper that injects ctx-driven defaults. */
function Btn({ disabled, ...rest }) {
  const { isTouchOnly, hasTracker } = useToolbarContext()
  return (
    <ToolButton
      isTouchOnly={isTouchOnly}
      disabled={disabled ?? !hasTracker}
      {...rest}
    />
  )
}

// --- Inline marks ---------------------------------------------------------

function BoldTool({ editor }) {
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

function ItalicTool({ editor }) {
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

function UnderlineTool({ editor }) {
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

function StrikeTool({ editor }) {
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

function H1Tool({ editor }) {
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

function H2Tool({ editor }) {
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

// --- Lists ----------------------------------------------------------------

function BulletListTool({ editor }) {
  return (
    <Btn
      active={editor?.isActive('bulletList')}
      onActivate={() => cmd(editor)?.toggleBulletList().run()}
      title="Bullet list"
    >
      <BulletListIcon />
    </Btn>
  )
}

function OrderedListTool({ editor }) {
  return (
    <Btn
      active={editor?.isActive('orderedList')}
      onActivate={() => cmd(editor)?.toggleOrderedList().run()}
      title="Numbered list"
    >
      <OrderedListIcon />
    </Btn>
  )
}

function TaskListTool({ editor }) {
  return (
    <Btn
      active={editor?.isActive('taskList')}
      onActivate={() => cmd(editor)?.toggleTaskList().run()}
      title="Task list"
    >
      <TaskListIcon />
    </Btn>
  )
}

// Mobile-only indent/outdent. On touch, the editor selection often lives in
// the DOM only (no focus); we sync it into ProseMirror before dispatching.
function useIndentOutdent(editor) {
  const syncSelectionFromDom = useCallback(() => {
    if (!editor || editor.isDestroyed || editor.view.hasFocus()) return
    const selection = window.getSelection?.()
    const anchorNode = selection?.anchorNode
    const focusNode = selection?.focusNode
    if (!selection || selection.rangeCount === 0 || !anchorNode || !focusNode) return
    const root = editor.view.dom
    const anchorElement =
      anchorNode.nodeType === Node.ELEMENT_NODE ? anchorNode : anchorNode.parentElement
    const focusElement =
      focusNode.nodeType === Node.ELEMENT_NODE ? focusNode : focusNode.parentElement
    const selectionInEditor =
      (anchorElement && root.contains(anchorElement)) ||
      (focusElement && root.contains(focusElement))
    if (!selectionInEditor) return
    try {
      const anchorPos = editor.view.posAtDOM(anchorNode, selection.anchorOffset)
      const headPos = editor.view.posAtDOM(focusNode, selection.focusOffset)
      const nextSelection = TextSelection.create(editor.state.doc, anchorPos, headPos)
      if (nextSelection.eq(editor.state.selection)) return
      editor.view.dispatch(editor.state.tr.setSelection(nextSelection))
    } catch {
      // Ignore DOM-to-state selection sync failures
    }
  }, [editor])

  const handleIndent = useCallback(() => {
    if (!editor) return
    syncSelectionFromDom()
    const info = getListItemInfo(editor)
    if (!info || info.index === 0) return
    editor.chain().focus().sinkListItem(info.itemTypeName).run()
  }, [editor, syncSelectionFromDom])

  const handleOutdent = useCallback(() => {
    if (!editor) return
    syncSelectionFromDom()
    const info = getListItemInfo(editor)
    if (!info || !info.isNested) return
    editor.chain().focus().liftListItem(info.itemTypeName).run()
  }, [editor, syncSelectionFromDom])

  return { handleIndent, handleOutdent }
}

function isInAnyList(editor) {
  return Boolean(
    editor?.isActive('bulletList') ||
    editor?.isActive('orderedList') ||
    editor?.isActive('taskList'),
  )
}

function OutdentTool({ editor }) {
  const { hasTracker } = useToolbarContext()
  const { handleOutdent } = useIndentOutdent(editor)
  return (
    <Btn
      disabled={!hasTracker || !isInAnyList(editor)}
      onActivate={handleOutdent}
      title="Outdent"
      ariaLabel="Outdent list item"
      testId="toolbar-outdent"
    >
      <OutdentIcon />
    </Btn>
  )
}

function IndentTool({ editor }) {
  const { hasTracker } = useToolbarContext()
  const { handleIndent } = useIndentOutdent(editor)
  return (
    <Btn
      disabled={!hasTracker || !isInAnyList(editor)}
      onActivate={handleIndent}
      title="Indent"
      ariaLabel="Indent list item"
      testId="toolbar-indent"
    >
      <IndentIcon />
    </Btn>
  )
}

// --- Link / Unlink --------------------------------------------------------

function LinkTool({ editor }) {
  const handleSetLink = () => {
    if (!editor) return
    const previousUrl = editor.getAttributes('link').href
    const url = window.prompt('Paste a link URL', previousUrl || '')
    if (url === null) return
    if (url === '') {
      editor.chain().focus().unsetLink().run()
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }
  return (
    <Btn onActivate={handleSetLink} title="Link" ariaLabel="Insert link">
      <LinkIcon />
    </Btn>
  )
}

function UnlinkTool({ editor }) {
  return (
    <Btn
      onActivate={() => cmd(editor)?.unsetLink().run()}
      title="Unlink"
      ariaLabel="Remove link"
    >
      <UnlinkIcon />
    </Btn>
  )
}

// --- Highlight (with picker) ---------------------------------------------

const HIGHLIGHT_COLORS = [
  [
    { label: 'Yellow', value: '#fef08a' },
    { label: 'Green', value: '#86efac' },
    { label: 'Cyan', value: '#67e8f9' },
    { label: 'Magenta', value: '#f0abfc' },
    { label: 'Blue', value: '#93c5fd' },
  ],
  [
    { label: 'Red', value: '#fca5a5' },
    { label: 'Dark Navy', value: '#0f172a' },
    { label: 'Teal', value: '#0d9488' },
    { label: 'Dark Green', value: '#166534' },
    { label: 'Purple', value: '#7c3aed' },
  ],
  [
    { label: 'Dark Maroon', value: '#7f1d1d' },
    { label: 'Olive', value: '#a16207' },
    { label: 'Gray', value: '#6b7280' },
    { label: 'Light Gray', value: '#d1d5db' },
    { label: 'Black', value: '#000000' },
  ],
  [
    { label: 'Light Yellow', value: '#fef9c3' },
    { label: 'Light Green', value: '#dcfce7' },
    { label: 'Light Cyan', value: '#cffafe' },
    { label: 'Pink', value: '#fbcfe8' },
    { label: 'Light Blue', value: '#dbeafe' },
  ],
  [
    { label: 'Orange', value: '#fdba74' },
    { label: 'Medium Light Green', value: '#bbf7d0' },
    { label: 'Medium Cyan', value: '#99f6e4' },
    { label: 'Lavender', value: '#e9d5ff' },
    { label: 'Bright Cyan', value: '#22d3ee' },
  ],
  [
    { label: 'Light Orange', value: '#fed7aa' },
    { label: 'Pale Green', value: '#ecfccb' },
    { label: 'Pale Teal', value: '#ccfbf1' },
    { label: 'Pale Lavender', value: '#f3e8ff' },
    { label: 'Pale Blue', value: '#e0f2fe' },
  ],
]

function HighlightTool({ editor }) {
  const highlightColor = useEditorUIStore((s) => s.highlightColor)
  const setHighlightColor = useEditorUIStore((s) => s.setHighlightColor)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  const pickerRef = useRef(null)
  const refs = useMemo(() => [wrapRef, pickerRef], [])
  useOutsideClick({ isOpen: open, onClose: () => setOpen(false), refs })

  const apply = () => {
    if (!editor) return
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

// Text-appropriate colors (readable as letterforms, not pale highlight tints).
const TEXT_COLORS = [
  [
    { label: 'Black', value: '#000000' },
    { label: 'Dark Gray', value: '#374151' },
    { label: 'Gray', value: '#6b7280' },
    { label: 'Red', value: '#dc2626' },
    { label: 'Orange', value: '#ea580c' },
  ],
  [
    { label: 'Amber', value: '#b45309' },
    { label: 'Green', value: '#16a34a' },
    { label: 'Teal', value: '#0d9488' },
    { label: 'Blue', value: '#2563eb' },
    { label: 'Navy', value: '#1e3a8a' },
  ],
  [
    { label: 'Indigo', value: '#4f46e5' },
    { label: 'Purple', value: '#7c3aed' },
    { label: 'Magenta', value: '#c026d3' },
    { label: 'Pink', value: '#db2777' },
    { label: 'Maroon', value: '#7f1d1d' },
  ],
]

function TextColorTool({ editor }) {
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

// --- Alignment ------------------------------------------------------------

function AlignLeftTool({ editor }) {
  return (
    <Btn
      active={editor?.isActive({ textAlign: 'left' })}
      onActivate={() => cmd(editor)?.setTextAlign('left').run()}
      title="Align left"
    >
      <AlignLeftIcon />
    </Btn>
  )
}

function AlignCenterTool({ editor }) {
  return (
    <Btn
      active={editor?.isActive({ textAlign: 'center' })}
      onActivate={() => cmd(editor)?.setTextAlign('center').run()}
      title="Align center"
    >
      <AlignCenterIcon />
    </Btn>
  )
}

function AlignRightTool({ editor }) {
  return (
    <Btn
      active={editor?.isActive({ textAlign: 'right' })}
      onActivate={() => cmd(editor)?.setTextAlign('right').run()}
      title="Align right"
    >
      <AlignRightIcon />
    </Btn>
  )
}

// --- Image (button + hidden file input) ----------------------------------

function ImageTool() {
  const { onImageUpload } = useToolbarContext()
  const inputRef = useRef(null)
  const handleFileChange = (event) => {
    const file = event.target.files?.[0]
    if (file) onImageUpload?.(file)
    event.target.value = ''
  }
  return (
    <>
      <Btn
        onActivate={() => inputRef.current?.click()}
        title="Image"
        ariaLabel="Insert image"
      >
        <ImageIcon />
      </Btn>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        className="file-input"
      />
    </>
  )
}

// --- Table (insert picker + row/col/delete + shading) --------------------

function TableTool({ editor }) {
  const [open, setOpen] = useState(false)
  const [size, setSize] = useState({ rows: 2, cols: 2 })
  const wrapRef = useRef(null)
  const pickerRef = useRef(null)
  const refs = useMemo(() => [wrapRef, pickerRef], [])
  useOutsideClick({ isOpen: open, onClose: () => setOpen(false), refs })

  const insert = (rows, cols) => {
    cmd(editor)?.insertTable({ rows, cols, withHeaderRow: false }).run()
    setOpen(false)
  }

  return (
    <div className="table-picker-wrap" ref={wrapRef}>
      <Btn
        onActivate={() => setOpen((prev) => !prev)}
        title="Table"
        ariaLabel="Insert table"
      >
        <TableIcon />
      </Btn>
      {open && (
        <TablePicker
          pickerRef={pickerRef}
          size={size}
          setSize={setSize}
          onInsert={insert}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}

function AddRowTool({ editor }) {
  return (
    <Btn
      onActivate={() => cmd(editor)?.addRowAfter().run()}
      title="Add row"
    >
      <AddRowIcon />
    </Btn>
  )
}

function AddColTool({ editor }) {
  return (
    <Btn
      onActivate={() => cmd(editor)?.addColumnAfter().run()}
      title="Add column"
    >
      <AddColIcon />
    </Btn>
  )
}

function DeleteTableTool({ editor }) {
  return (
    <Btn
      onActivate={() => cmd(editor)?.deleteTable().run()}
      title="Delete table"
    >
      <DeleteTableIcon />
    </Btn>
  )
}

// Shading is conditional: only rendered when the selection is inside a table.
// Theme palette mirrors the original derived swatches (10 base × 5 brightness).
const THEME_BASE_COLORS = [
  '#ffffff', '#000000', '#1f2937', '#1e3a8a', '#2563eb',
  '#ef4444', '#7f1d1d', '#f97316', '#f59e0b', '#16a34a',
]
const STANDARD_SHADING_COLORS = [
  '#7f1d1d', '#ef4444', '#f97316', '#f59e0b', '#22c55e',
  '#0f766e', '#3b82f6', '#1e3a8a', '#0f172a', '#7c3aed',
]

function buildThemeRows() {
  const lightSteps = [0.2, 0.4, 0.6, 0.8]
  return [
    THEME_BASE_COLORS.slice(),
    ...lightSteps.map((amount) =>
      THEME_BASE_COLORS.map((base) => {
        const lower = base.toLowerCase()
        if (lower === '#ffffff') return mixColors(lower, '#000000', amount)
        return mixColors(lower, '#ffffff', amount)
      }),
    ),
  ]
}

function ShadingTool({ editor }) {
  const inTable = useEditorUIStore((s) => s.inTable)
  const shadingColor = useEditorUIStore((s) => s.shadingColor)
  const setShadingColor = useEditorUIStore((s) => s.setShadingColor)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  const pickerRef = useRef(null)
  const customInputRef = useRef(null)
  const refs = useMemo(() => [wrapRef, pickerRef], [])
  useOutsideClick({ isOpen: open, onClose: () => setOpen(false), refs })

  const themeRows = useMemo(() => buildThemeRows(), [])

  if (!inTable) return null

  // The remembered/persisted color drives the swatch and the main-button apply.
  // The active (pressed) affordance should reflect the *current* cell's actual
  // background instead, so the button isn't permanently "pressed" once a color
  // is remembered. This stays fresh because the toolbar re-renders on every
  // selection update.
  const currentCellShading =
    editor?.getAttributes('tableHeader')?.backgroundColor ||
    editor?.getAttributes('tableCell')?.backgroundColor ||
    null

  const apply = () => {
    if (!editor) return
    const nextColor = currentCellShading ? null : shadingColor || null
    cmd(editor)?.setCellAttribute('backgroundColor', nextColor).run()
  }

  const pick = (color) => {
    if (!editor) return
    setShadingColor(color || null)
    cmd(editor)?.setCellAttribute('backgroundColor', color || null).run()
    setOpen(false)
  }

  const handleCustom = (event) => {
    const color = event.target.value
    if (!color) return
    pick(color)
  }

  return (
    <div className="shading-control" ref={wrapRef}>
      <Btn
        active={Boolean(currentCellShading)}
        onActivate={apply}
        title="Shading"
        ariaLabel="Cell shading"
      >
        <ShadingIcon />
        <span
          className="toolbar-color-bar"
          style={{ backgroundColor: shadingColor ?? 'transparent' }}
        />
      </Btn>
      <Btn
        className="toolbar-btn-caret"
        onActivate={() => setOpen((prev) => !prev)}
        ariaLabel="Shading colors"
      >
        ▾
      </Btn>
      {open && (
        <ShadingPicker
          pickerRef={pickerRef}
          themeRows={themeRows}
          standardColors={STANDARD_SHADING_COLORS}
          shadingColor={shadingColor}
          customInputRef={customInputRef}
          onPick={pick}
          onOpenCustom={() => customInputRef.current?.click()}
          onCustomChange={handleCustom}
        />
      )}
    </div>
  )
}

// --- History --------------------------------------------------------------

function UndoTool({ editor }) {
  return (
    <Btn
      onActivate={() => cmd(editor)?.undo().run()}
      title="Undo"
      testId="toolbar-undo"
    >
      <UndoIcon />
    </Btn>
  )
}

function RedoTool({ editor }) {
  return (
    <Btn
      onActivate={() => cmd(editor)?.redo().run()}
      title="Redo"
    >
      <RedoIcon />
    </Btn>
  )
}

// --- Export / Copy --------------------------------------------------------

function ExportTool({ editor }) {
  const { hasTracker, title } = useToolbarContext()
  const handleExport = () => {
    if (!editor || !hasTracker) return
    const rawTitle = title?.trim() || 'Untitled'
    const safeTitle = rawTitle.replace(/[\\/:*?"<>|]+/g, '').trim() || 'Untitled'
    const doc = editor.getJSON()
    const text = serializeDocForExport(doc, rawTitle)
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${safeTitle}.txt`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }
  return (
    <Btn onActivate={handleExport} title="Export">
      <ExportIcon />
    </Btn>
  )
}

function CopyTool({ editor }) {
  const { hasTracker, title } = useToolbarContext()
  const copyLabel = useEditorUIStore((s) => s.copyLabel)
  const setCopyLabel = useEditorUIStore((s) => s.setCopyLabel)
  const handleCopy = async () => {
    if (!editor || !hasTracker) return
    const rawTitle = title?.trim() || 'Untitled'
    const doc = editor.getJSON()
    const text = serializeDocForExport(doc, rawTitle)
    try {
      await navigator.clipboard.writeText(text)
      setCopyLabel('Copied!')
      setTimeout(() => setCopyLabel('Copy'), 2000)
    } catch {
      window.alert('Failed to copy to clipboard.')
    }
  }
  return (
    <Btn onActivate={handleCopy} title={copyLabel} ariaLabel="Copy text">
      <CopyIcon />
    </Btn>
  )
}

// --- AI group -------------------------------------------------------------

function AiDailyTool() {
  const { hasTracker, onAiDailyGenerate } = useToolbarContext()
  const aiLoading = useEditorUIStore((s) => s.aiLoading)
  const aiInsertLoading = useEditorUIStore((s) => s.aiInsertLoading)
  const aiDailyDate = useEditorUIStore((s) => s.aiDailyDate)
  const setAiDailyDate = useEditorUIStore((s) => s.setAiDailyDate)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  const pickerRef = useRef(null)
  const refs = useMemo(() => [wrapRef, pickerRef], [])
  useOutsideClick({ isOpen: open, onClose: () => setOpen(false), refs })

  const shiftDay = (delta) => {
    setAiDailyDate((prev) => {
      const next = new Date(prev)
      next.setDate(next.getDate() + delta)
      return next
    })
  }

  const onDateChange = (dateString) => {
    const parsed = new Date(dateString + 'T00:00:00')
    if (!isNaN(parsed.getTime())) setAiDailyDate(parsed)
  }

  const disabled = !hasTracker || aiLoading || aiInsertLoading

  return (
    <div className="ai-daily-control" ref={wrapRef}>
      <Btn
        disabled={disabled}
        className="toolbar-btn-ai"
        onActivate={onAiDailyGenerate}
        title={aiLoading ? 'Generating...' : 'AI Daily'}
        ariaLabel="AI Daily"
      >
        <AiIcon />
        <span className="toolbar-btn-label toolbar-btn-ai-label">
          {aiLoading ? '...' : 'AI'}
        </span>
      </Btn>
      <Btn
        disabled={disabled}
        className="toolbar-btn-caret"
        onActivate={() => setOpen((prev) => !prev)}
        ariaLabel="Pick date for AI Daily"
      >
        ▾
      </Btn>
      {open && (
        <AiDailyPicker
          pickerRef={pickerRef}
          date={aiDailyDate}
          onPrevDay={() => shiftDay(-1)}
          onNextDay={() => shiftDay(1)}
          onDateChange={onDateChange}
        />
      )}
    </div>
  )
}

function AiInsertTool() {
  const { hasTracker, showAiInsert } = useToolbarContext()
  const aiLoading = useEditorUIStore((s) => s.aiLoading)
  const aiInsertLoading = useEditorUIStore((s) => s.aiInsertLoading)
  const setAiInsertOpen = useEditorUIStore((s) => s.setAiInsertOpen)
  if (!showAiInsert) return null
  return (
    <Btn
      disabled={!hasTracker || aiLoading || aiInsertLoading}
      className="toolbar-btn-ai"
      onActivate={() => setAiInsertOpen(true)}
      title={aiInsertLoading ? 'Inserting...' : 'AI Insert'}
      ariaLabel="AI Insert"
    >
      <AiIcon />
      <span className="toolbar-btn-label toolbar-btn-ai-label">
        {aiInsertLoading ? '...' : '⊕'}
      </span>
    </Btn>
  )
}

// --- Find -----------------------------------------------------------------

function FindTool() {
  const { openFind } = useToolbarContext()
  return (
    <Btn
      onActivate={openFind}
      title="Find"
      ariaLabel="Find in page"
    >
      <SearchIcon />
    </Btn>
  )
}

// --- More menu ------------------------------------------------------------

function MoreTool() {
  const ctx = useToolbarContext()
  const {
    hasTracker,
    toolbarDeepLinkHash,
    isCurrentPageTracker,
    trackerPageSaving,
    onSetTrackerPage,
    handleSetTrackerFromToolbar,
    contextMenuItems,
  } = ctx
  const inTable = useEditorUIStore((s) => s.inTable)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  const refs = useMemo(() => [wrapRef], [])
  useOutsideClick({ isOpen: open, onClose: () => setOpen(false), refs })

  const onCopyLink = async () => {
    if (toolbarDeepLinkHash) await navigator.clipboard.writeText(toolbarDeepLinkHash)
    setOpen(false)
  }

  const onSetTracker = async () => {
    await handleSetTrackerFromToolbar()
    setOpen(false)
  }

  return (
    <div className="more-menu-wrap" ref={wrapRef}>
      <Btn
        onActivate={() => setOpen((prev) => !prev)}
        title="More"
        ariaLabel="More actions"
      >
        <MoreIcon />
      </Btn>
      {open && (
        <MoreMenu
          onClose={() => setOpen(false)}
          onCopyLink={onCopyLink}
          copyLinkDisabled={!toolbarDeepLinkHash}
          onSetTrackerPage={onSetTracker}
          setTrackerLabel={
            isCurrentPageTracker
              ? 'This page is the tracker page'
              : trackerPageSaving
              ? 'Setting tracker page...'
              : 'Set this page as tracker'
          }
          setTrackerDisabled={
            !hasTracker || isCurrentPageTracker || trackerPageSaving || !onSetTrackerPage
          }
          inTable={inTable}
          contextMenuItems={contextMenuItems}
        />
      )}
    </div>
  )
}

// --- Registry -------------------------------------------------------------

export const TOOL_DEFINITIONS = {
  bold:        { Component: BoldTool },
  italic:      { Component: ItalicTool },
  underline:   { Component: UnderlineTool },
  strike:      { Component: StrikeTool },
  h1:          { Component: H1Tool },
  h2:          { Component: H2Tool },
  bulletList:  { Component: BulletListTool },
  orderedList: { Component: OrderedListTool },
  taskList:    { Component: TaskListTool },
  outdent:     { Component: OutdentTool, mobileOnly: true },
  indent:      { Component: IndentTool, mobileOnly: true },
  link:        { Component: LinkTool },
  unlink:      { Component: UnlinkTool },
  highlight:   { Component: HighlightTool },
  textColor:   { Component: TextColorTool },
  alignLeft:   { Component: AlignLeftTool },
  alignCenter: { Component: AlignCenterTool },
  alignRight:  { Component: AlignRightTool },
  image:       { Component: ImageTool },
  table:       { Component: TableTool },
  addRow:      { Component: AddRowTool },
  addCol:      { Component: AddColTool },
  shading:     { Component: ShadingTool },
  deleteTable: { Component: DeleteTableTool },
  undo:        { Component: UndoTool },
  redo:        { Component: RedoTool },
  export:      { Component: ExportTool },
  copy:        { Component: CopyTool },
  aiDaily:     { Component: AiDailyTool },
  aiInsert:    { Component: AiInsertTool },
  find:        { Component: FindTool },
  more:        { Component: MoreTool },
}

/**
 * Groups rendered inside `.toolbar-core` (always visible, even on mobile
 * collapsed state). Mobile-only tools (indent/outdent) are filtered out on
 * desktop by the renderer.
 */
export const CORE_GROUPS = [
  { id: 'core-inline', tools: ['bold', 'italic', 'strike', 'h1', 'bulletList', 'outdent', 'indent'] },
  { id: 'core-link-undo', tools: ['link', 'find', 'undo'] },
]

/**
 * Groups rendered inside `.toolbar-extra` (hidden on mobile when collapsed).
 * Order is verbatim from the legacy Toolbar.jsx render path.
 */
export const EXTRA_GROUPS = [
  { id: 'extra-text', tools: ['underline', 'highlight', 'textColor'] },
  { id: 'extra-headings', tools: ['h2', 'orderedList', 'taskList'] },
  { id: 'extra-align', tools: ['alignLeft', 'alignCenter', 'alignRight'] },
  { separator: true, id: 'sep-1' },
  { id: 'extra-insert', tools: ['unlink', 'image', 'table', 'addRow', 'addCol', 'shading', 'deleteTable'] },
  { separator: true, id: 'sep-2' },
  { id: 'extra-utility', tools: ['redo', 'export', 'copy'] },
  { id: 'extra-ai', tools: ['aiDaily', 'aiInsert'], visible: (ctx) => Boolean(ctx.showAiDaily) },
  { id: 'extra-more', tools: ['more'] },
]
