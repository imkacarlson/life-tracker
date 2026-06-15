import { useMemo, useRef, useState } from 'react'
import {
  LinkIcon, UnlinkIcon, ImageIcon,
  TableIcon, AddRowIcon, AddColIcon, DeleteTableIcon, ShadingIcon,
} from '../../ToolbarIcons'
import { useEditorUIStore } from '../../../../stores/editorUIStore'
import ShadingPicker from '../ShadingPicker'
import TablePicker from '../TablePicker'
import { useToolbarContext } from '../ToolbarContext'
import { useOutsideClick } from '../useOutsideClick'
import { cmd, buildThemeRows } from '../toolHelpers'
import { STANDARD_SHADING_COLORS } from '../toolConstants'
import { Btn } from './ToolButton'

// --- Link / Unlink --------------------------------------------------------

export function LinkTool({ editor }) {
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

export function UnlinkTool({ editor }) {
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

// --- Image (button + hidden file input) ----------------------------------

export function ImageTool() {
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

export function TableTool({ editor }) {
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

export function AddRowTool({ editor }) {
  return (
    <Btn
      onActivate={() => cmd(editor)?.addRowAfter().run()}
      title="Add row"
    >
      <AddRowIcon />
    </Btn>
  )
}

export function AddColTool({ editor }) {
  return (
    <Btn
      onActivate={() => cmd(editor)?.addColumnAfter().run()}
      title="Add column"
    >
      <AddColIcon />
    </Btn>
  )
}

export function DeleteTableTool({ editor }) {
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
export function ShadingTool({ editor }) {
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
