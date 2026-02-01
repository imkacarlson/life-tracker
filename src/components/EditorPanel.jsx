import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent } from '@tiptap/react'

function EditorPanel({
  editor,
  title,
  onTitleChange,
  onDelete,
  saveStatus,
  onImageUpload,
  hasTracker,
  message,
  notebookId,
  sectionId,
  trackerId,
  onNavigateHash,
}) {
  const fileInputRef = useRef(null)
  const tableButtonRef = useRef(null)
  const tablePickerRef = useRef(null)
  const highlightButtonRef = useRef(null)
  const highlightPickerRef = useRef(null)
  const shadingButtonRef = useRef(null)
  const shadingPickerRef = useRef(null)
  const shadingInputRef = useRef(null)
  const contextMenuRef = useRef(null)
  const submenuRef = useRef(null)
  const longPressTimerRef = useRef(null)
  const [tablePickerOpen, setTablePickerOpen] = useState(false)
  const [tableSize, setTableSize] = useState({ rows: 2, cols: 2 })
  const [highlightPickerOpen, setHighlightPickerOpen] = useState(false)
  const [highlightColor, setHighlightColor] = useState('#fef08a')
  const [shadingPickerOpen, setShadingPickerOpen] = useState(false)
  const [shadingColor, setShadingColor] = useState(null)
  const [inTable, setInTable] = useState(false)
  const [contextMenu, setContextMenu] = useState({
    open: false,
    x: 0,
    y: 0,
    blockId: null,
    inTable: false,
  })
  const [submenuOpen, setSubmenuOpen] = useState(false)
  const [submenuDirection, setSubmenuDirection] = useState('right')
  const gridSize = 5

  const handlePickImage = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = (event) => {
    const file = event.target.files?.[0]
    if (file) {
      onImageUpload?.(file)
    }
    event.target.value = ''
  }

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

  const handleSetTextAlign = (alignment) => {
    editor?.chain().focus().setTextAlign(alignment).run()
  }

  const handleExportText = () => {
    if (!editor || !hasTracker) return
    const rawTitle = title?.trim() || 'Untitled'
    const safeTitle = rawTitle.replace(/[\\/:*?"<>|]+/g, '').trim() || 'Untitled'
    const doc = editor.getJSON()
    const lines = []

    const serializeInline = (content) => {
      if (!content) return ''
      return content
        .map((node) => {
          if (node.type === 'text') {
            let text = node.text || ''
            const marks = node.marks || []
            const hasBold = marks.some((m) => m.type === 'bold')
            const hasItalic = marks.some((m) => m.type === 'italic')
            const hasStrike = marks.some((m) => m.type === 'strike')
            const hasHighlight = marks.some((m) => m.type === 'highlight')
            if (hasBold) text = `**${text}**`
            if (hasItalic) text = `_${text}_`
            if (hasStrike) text = `~~${text}~~`
            if (hasHighlight) text = `[${text}]`
            return text
          }
          if (node.type === 'hardBreak') return '\n'
          if (node.type === 'image') return '[image]'
          return ''
        })
        .join('')
    }

    const serializeNode = (node, indent = 0, listIndex = null) => {
      const prefix = '  '.repeat(indent)

      switch (node.type) {
        case 'doc':
          node.content?.forEach((child) => serializeNode(child, indent))
          break

        case 'paragraph': {
          const text = serializeInline(node.content)
          lines.push(prefix + text)
          break
        }

        case 'heading': {
          const text = serializeInline(node.content)
          if (lines.length > 0) lines.push('')
          lines.push(prefix + text.toUpperCase())
          lines.push('')
          break
        }

        case 'bulletList':
          node.content?.forEach((child) => serializeNode(child, indent, 'bullet'))
          break

        case 'orderedList': {
          let counter = 1
          node.content?.forEach((child) => {
            serializeNode(child, indent, counter)
            counter += 1
          })
          break
        }

        case 'taskList':
          node.content?.forEach((child) => serializeNode(child, indent, 'task'))
          break

        case 'listItem':
        case 'taskItem': {
          const marker =
            listIndex === 'bullet'
              ? '- '
              : listIndex === 'task'
                ? node.attrs?.checked
                  ? '[x] '
                  : '[ ] '
                : `${listIndex}. `
          const children = node.content || []
          children.forEach((child, i) => {
            if (i === 0 && child.type === 'paragraph') {
              lines.push(prefix + marker + serializeInline(child.content))
            } else {
              serializeNode(child, indent + 1)
            }
          })
          break
        }

        case 'table':
          node.content?.forEach((row, rowIdx) => {
            row.content?.forEach((cell) => {
              cell.content?.forEach((child) => serializeNode(child, indent))
            })
            if (rowIdx < (node.content?.length || 0) - 1) {
              const cellText =
                row.content
                  ?.map((c) => c.content?.map((n) => serializeInline(n.content)).join(''))
                  .join('') || ''
              if (cellText.trim()) lines.push(prefix + '---')
            }
          })
          break

        case 'tableRow':
        case 'tableCell':
        case 'tableHeader':
          node.content?.forEach((child) => serializeNode(child, indent))
          break

        case 'blockquote':
          node.content?.forEach((child) => serializeNode(child, indent + 1))
          break

        case 'codeBlock': {
          lines.push(prefix + '```')
          const text = node.content?.map((n) => n.text || '').join('') || ''
          text.split('\n').forEach((line) => lines.push(prefix + line))
          lines.push(prefix + '```')
          break
        }

        case 'horizontalRule':
          lines.push(prefix + '---')
          break

        default:
          if (node.content) {
            node.content.forEach((child) => serializeNode(child, indent))
          }
          break
      }
    }

    serializeNode(doc)

    const text = lines
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+\n/g, '\n')
      .trim()

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

  const openContextMenu = useCallback((next) => {
    setTablePickerOpen(false)
    setContextMenu({
      open: true,
      x: next.x,
      y: next.y,
      blockId: next.blockId ?? null,
      inTable: next.inTable ?? false,
    })
    setSubmenuOpen(false)
  }, [])

  const closeContextMenu = useCallback(() => {
    setContextMenu((prev) => (prev.open ? { ...prev, open: false } : prev))
    setSubmenuOpen(false)
  }, [])

  const closeTablePicker = useCallback(() => {
    setTablePickerOpen(false)
  }, [])

  const closeHighlightPicker = useCallback(() => {
    setHighlightPickerOpen(false)
  }, [])

  const closeShadingPicker = useCallback(() => {
    setShadingPickerOpen(false)
  }, [])

  const getCellFromEvent = (event) => {
    const target = event.target
    if (!target?.closest) return null
    return target.closest('td, th')
  }

  const focusCellFromEvent = (event) => {
    if (!editor) return
    const cell = getCellFromEvent(event)
    if (!cell) return
    const pos = editor.view?.posAtDOM(cell, 0)
    if (pos !== null && pos !== undefined) {
      try {
        editor.chain().focus().setTextSelection(pos + 2).run()
      } catch {
        editor.chain().focus().setTextSelection(pos).run()
      }
    }
  }

  const focusFromCoords = (coords) => {
    if (!editor) return
    const pos = editor.view?.posAtCoords(coords)
    if (pos?.pos !== undefined) {
      editor.chain().focus().setTextSelection(pos.pos).run()
    }
  }

  const getActiveBlockId = () => {
    if (!editor) return null
    const { $from } = editor.state.selection
    let fallbackId = null
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      const node = $from.node(depth)
      const id = node?.attrs?.id
      if (!id) continue
      const type = node.type?.name
      if (type === 'paragraph' || type === 'heading') {
        return id
      }
      if (!fallbackId) fallbackId = id
    }
    return fallbackId
  }

  useEffect(() => {
    if (!editor) return
    const dom = editor.view.dom

    const handleContextMenu = (event) => {
      if (event.shiftKey) return
      event.preventDefault()
      focusFromCoords({ left: event.clientX, top: event.clientY })
      const inTable = Boolean(getCellFromEvent(event))
      const blockId = getActiveBlockId()
      openContextMenu({ x: event.clientX, y: event.clientY, blockId, inTable })
    }

    const handleTouchStart = (event) => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current)
      }
      const touch = event.touches?.[0]
      if (!touch) return
      const inTable = Boolean(getCellFromEvent(event))
      longPressTimerRef.current = setTimeout(() => {
        if (inTable) {
          focusCellFromEvent(event)
        } else {
          focusFromCoords({ left: touch.clientX, top: touch.clientY })
        }
        const blockId = getActiveBlockId()
        openContextMenu({ x: touch.clientX, y: touch.clientY, blockId, inTable })
      }, 550)
    }

    const cancelLongPress = () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current)
        longPressTimerRef.current = null
      }
    }

    dom.addEventListener('contextmenu', handleContextMenu)
    dom.addEventListener('touchstart', handleTouchStart, { passive: true })
    dom.addEventListener('touchmove', cancelLongPress, { passive: true })
    dom.addEventListener('touchend', cancelLongPress)
    dom.addEventListener('touchcancel', cancelLongPress)

    return () => {
      dom.removeEventListener('contextmenu', handleContextMenu)
      dom.removeEventListener('touchstart', handleTouchStart)
      dom.removeEventListener('touchmove', cancelLongPress)
      dom.removeEventListener('touchend', cancelLongPress)
      dom.removeEventListener('touchcancel', cancelLongPress)
    }
  }, [editor, openContextMenu])

  useEffect(() => {
    if (!contextMenu.open) return
    const menu = contextMenuRef.current
    if (!menu) return
    const padding = 8
    const rect = menu.getBoundingClientRect()
    let nextX = Math.min(contextMenu.x, window.innerWidth - rect.width - padding)
    let nextY = Math.min(contextMenu.y, window.innerHeight - rect.height - padding)
    nextX = Math.max(padding, nextX)
    nextY = Math.max(padding, nextY)
    if (nextX !== contextMenu.x || nextY !== contextMenu.y) {
      setContextMenu((prev) => ({ ...prev, x: nextX, y: nextY }))
    }
  }, [contextMenu.open, contextMenu.x, contextMenu.y])

  useEffect(() => {
    if (!submenuOpen) return
    const menu = contextMenuRef.current
    const submenu = submenuRef.current
    if (!menu || !submenu) return
    const padding = 12
    const menuRect = menu.getBoundingClientRect()
    const submenuRect = submenu.getBoundingClientRect()
    const openRight = menuRect.right + submenuRect.width + padding < window.innerWidth
    setSubmenuDirection(openRight ? 'right' : 'left')
  }, [submenuOpen])

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (tablePickerOpen) {
        const picker = tablePickerRef.current
        const button = tableButtonRef.current
        if (picker?.contains(event.target) || button?.contains(event.target)) return
        setTablePickerOpen(false)
      }
      if (highlightPickerOpen) {
        const picker = highlightPickerRef.current
        const button = highlightButtonRef.current
        if (picker?.contains(event.target) || button?.contains(event.target)) return
        setHighlightPickerOpen(false)
      }
      if (shadingPickerOpen) {
        const picker = shadingPickerRef.current
        const button = shadingButtonRef.current
        if (picker?.contains(event.target) || button?.contains(event.target)) return
        setShadingPickerOpen(false)
      }
      if (contextMenu.open) {
        const menu = contextMenuRef.current
        if (menu?.contains(event.target)) return
        closeContextMenu()
      }
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setTablePickerOpen(false)
        setHighlightPickerOpen(false)
        setShadingPickerOpen(false)
        closeContextMenu()
      }
    }

    document.addEventListener('mousedown', handleOutsideClick)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [tablePickerOpen, highlightPickerOpen, shadingPickerOpen, contextMenu.open, closeContextMenu])

  const tableGrid = useMemo(() => {
    return Array.from({ length: gridSize }, (_, rowIndex) =>
      Array.from({ length: gridSize }, (_, colIndex) => ({
        row: rowIndex + 1,
        col: colIndex + 1,
      })),
    )
  }, [gridSize])

  const handleInsertTable = (rows, cols) => {
    if (!editor) return
    editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run()
    closeTablePicker()
  }

  const handleApplyShading = () => {
    if (!editor) return
    if (!shadingColor) {
      editor.chain().focus().setCellAttribute('backgroundColor', null).run()
      return
    }
    editor.chain().focus().setCellAttribute('backgroundColor', shadingColor).run()
  }

  const handlePickShading = (color) => {
    if (!editor) return
    if (!color) {
      setShadingColor(null)
      editor.chain().focus().setCellAttribute('backgroundColor', null).run()
    } else {
      setShadingColor(color)
      editor.chain().focus().setCellAttribute('backgroundColor', color).run()
    }
    closeShadingPicker()
  }

  const handleCustomShading = (event) => {
    const color = event.target.value
    if (!color) return
    handlePickShading(color)
  }

  const openCustomShading = () => {
    shadingInputRef.current?.click()
  }

  const hexToRgb = (hex) => {
    const normalized = hex.replace('#', '')
    const value =
      normalized.length === 3
        ? normalized
            .split('')
            .map((char) => char + char)
            .join('')
        : normalized
    const intValue = parseInt(value, 16)
    return {
      r: (intValue >> 16) & 255,
      g: (intValue >> 8) & 255,
      b: intValue & 255,
    }
  }

  const toHex = (value) => value.toString(16).padStart(2, '0')

  const mixColors = (base, mixWith, amount) => {
    const a = hexToRgb(base)
    const b = hexToRgb(mixWith)
    const mix = (start, end) => Math.round(start * (1 - amount) + end * amount)
    return `#${toHex(mix(a.r, b.r))}${toHex(mix(a.g, b.g))}${toHex(mix(a.b, b.b))}`
  }

  const themeBaseColors = useMemo(
    () => [
      { label: 'White', value: '#ffffff' },
      { label: 'Black', value: '#000000' },
      { label: 'Dark Blue-Gray', value: '#1f2937' },
      { label: 'Dark Blue', value: '#1e3a8a' },
      { label: 'Medium Blue', value: '#2563eb' },
      { label: 'Red', value: '#ef4444' },
      { label: 'Dark Red', value: '#7f1d1d' },
      { label: 'Orange', value: '#f97316' },
      { label: 'Gold/Yellow', value: '#f59e0b' },
      { label: 'Green', value: '#16a34a' },
    ],
    [],
  )

  const themeRows = useMemo(() => {
    const lightSteps = [0.2, 0.4, 0.6, 0.8]
    return [
      themeBaseColors.map((color) => color.value),
      ...lightSteps.map((amount) =>
        themeBaseColors.map((color) => {
          const base = color.value.toLowerCase()
          if (base === '#ffffff') {
            return mixColors(base, '#000000', amount)
          }
          if (base === '#000000') {
            return mixColors(base, '#ffffff', amount)
          }
          return mixColors(base, '#ffffff', amount)
        }),
      ),
    ]
  }, [themeBaseColors])

  const standardColors = useMemo(
    () => [
      '#7f1d1d',
      '#ef4444',
      '#f97316',
      '#f59e0b',
      '#22c55e',
      '#0f766e',
      '#3b82f6',
      '#1e3a8a',
      '#0f172a',
      '#7c3aed',
    ],
    [],
  )

  useEffect(() => {
    if (!editor) return
    const syncTableState = () => {
      const nextInTable =
        editor.isActive('table') || editor.isActive('tableCell') || editor.isActive('tableHeader')
      setInTable(nextInTable)
      if (!nextInTable) return
      const headerColor = editor.getAttributes('tableHeader')?.backgroundColor
      const cellColor = editor.getAttributes('tableCell')?.backgroundColor
      setShadingColor(headerColor || cellColor || null)
    }
    syncTableState()
    editor.on('selectionUpdate', syncTableState)
    editor.on('transaction', syncTableState)
    return () => {
      editor.off('selectionUpdate', syncTableState)
      editor.off('transaction', syncTableState)
    }
  }, [editor])

  const handleApplyHighlight = () => {
    if (!editor) return
    if (!highlightColor) {
      editor.chain().focus().unsetHighlight().run()
      return
    }
    editor.chain().focus().setHighlight({ color: highlightColor }).run()
  }

  const handlePickHighlight = (color) => {
    if (!editor) return
    if (!color) {
      setHighlightColor(null)
      editor.chain().focus().unsetHighlight().run()
    } else {
      setHighlightColor(color)
      editor.chain().focus().setHighlight({ color }).run()
    }
    closeHighlightPicker()
  }

  const highlightColors = useMemo(
    () => [
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
    ],
    [],
  )

  useEffect(() => {
    if (!editor) return
    const syncHighlight = () => {
      const color = editor.getAttributes('highlight')?.color
      if (color) setHighlightColor(color)
    }
    editor.on('selectionUpdate', syncHighlight)
    editor.on('transaction', syncHighlight)
    return () => {
      editor.off('selectionUpdate', syncHighlight)
      editor.off('transaction', syncHighlight)
    }
  }, [editor])

  useEffect(() => {
    if (!editor) return
    editor.storage.highlightColor = highlightColor ?? null
  }, [editor, highlightColor])

  const contextMenuItems = useMemo(
    () => [
      { label: 'Insert row above', action: () => editor?.chain().focus().addRowBefore().run() },
      { label: 'Insert row below', action: () => editor?.chain().focus().addRowAfter().run() },
      { label: 'Insert column left', action: () => editor?.chain().focus().addColumnBefore().run() },
      { label: 'Insert column right', action: () => editor?.chain().focus().addColumnAfter().run() },
      { label: 'Delete row', action: () => editor?.chain().focus().deleteRow().run() },
      { label: 'Delete column', action: () => editor?.chain().focus().deleteColumn().run() },
      { label: 'Delete table', action: () => editor?.chain().focus().deleteTable().run() },
    ],
    [editor],
  )

  const deepLinkHash = useMemo(() => {
    if (!contextMenu.blockId || !notebookId || !sectionId || !trackerId) return null
    return `#nb=${notebookId}&sec=${sectionId}&pg=${trackerId}&block=${contextMenu.blockId}`
  }, [contextMenu.blockId, notebookId, sectionId, trackerId])

  const handleCopyLink = async () => {
    if (!deepLinkHash) return
    await navigator.clipboard.writeText(deepLinkHash)
    closeContextMenu()
  }

  useEffect(() => {
    if (!editor) return
    if (typeof onNavigateHash === 'function') {
      // no-op: handled by Link extension plugin
    }
  }, [editor, onNavigateHash])

  return (
    <section className="editor-panel">
      <div className="editor-header">
        <div className="title-row">
          <input
            className="title-input"
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
            placeholder="Tracker title"
            disabled={!hasTracker}
          />
          <button className="ghost" onClick={onDelete} disabled={!hasTracker}>
            Delete
          </button>
        </div>
        <div className="status-row">
          <span className="subtle">{hasTracker ? saveStatus : 'No tracker selected'}</span>
          {message && <span className="message-inline">{message}</span>}
        </div>
      </div>

      <div className={`toolbar ${!hasTracker ? 'disabled' : ''}`}>
        <button
          type="button"
          className={editor?.isActive('bold') ? 'active' : ''}
          onClick={() => editor?.chain().focus().toggleBold().run()}
          disabled={!hasTracker}
        >
          B
        </button>
        <button
          type="button"
          className={editor?.isActive('italic') ? 'active' : ''}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
          disabled={!hasTracker}
        >
          I
        </button>
        <button
          type="button"
          className={editor?.isActive('underline') ? 'active' : ''}
          onClick={() => editor?.chain().focus().toggleUnderline().run()}
          disabled={!hasTracker}
        >
          U
        </button>
        <button
          type="button"
          className={editor?.isActive('strike') ? 'active' : ''}
          onClick={() => editor?.chain().focus().toggleStrike().run()}
          disabled={!hasTracker}
        >
          S
        </button>
        <div className="highlight-control" ref={highlightButtonRef}>
          <button
            type="button"
            className={editor?.isActive('highlight') ? 'active' : ''}
            onClick={handleApplyHighlight}
            disabled={!hasTracker}
          >
            <span className="highlight-icon">
              HL
              <span
                className="highlight-indicator"
                style={{ backgroundColor: highlightColor ?? 'transparent' }}
              />
            </span>
          </button>
          <button
            type="button"
            className="highlight-dropdown"
            onClick={() => setHighlightPickerOpen((prev) => !prev)}
            disabled={!hasTracker}
            aria-label="Highlight colors"
          >
            ▾
          </button>
          {highlightPickerOpen && (
            <div className="highlight-picker" ref={highlightPickerRef}>
              <div className="highlight-grid">
                {highlightColors.flatMap((row) =>
                  row.map((swatch) => (
                    <button
                      key={swatch.label}
                      type="button"
                      className="highlight-swatch"
                      style={{ backgroundColor: swatch.value }}
                      onClick={() => handlePickHighlight(swatch.value)}
                      aria-label={swatch.label}
                    />
                  )),
                )}
              </div>
              <button type="button" className="highlight-none" onClick={() => handlePickHighlight(null)}>
                No Color
              </button>
            </div>
          )}
        </div>
        <input
          type="color"
          aria-label="Text color"
          onChange={(event) => editor?.chain().focus().setColor(event.target.value).run()}
          disabled={!hasTracker}
        />

        <div className="toolbar-divider" />

        <button
          type="button"
          className={editor?.isActive('heading', { level: 1 }) ? 'active' : ''}
          onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
          disabled={!hasTracker}
        >
          H1
        </button>
        <button
          type="button"
          className={editor?.isActive('heading', { level: 2 }) ? 'active' : ''}
          onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
          disabled={!hasTracker}
        >
          H2
        </button>
        <button
          type="button"
          className={editor?.isActive('bulletList') ? 'active' : ''}
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
          disabled={!hasTracker}
        >
          • List
        </button>
        <button
          type="button"
          className={editor?.isActive('orderedList') ? 'active' : ''}
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          disabled={!hasTracker}
        >
          1. List
        </button>
        <button
          type="button"
          className={editor?.isActive('taskList') ? 'active' : ''}
          onClick={() => editor?.chain().focus().toggleTaskList().run()}
          disabled={!hasTracker}
        >
          ☑ List
        </button>

        <div className="toolbar-divider" />

        <button
          type="button"
          className={editor?.isActive({ textAlign: 'left' }) ? 'active' : ''}
          onClick={() => handleSetTextAlign('left')}
          disabled={!hasTracker}
        >
          Left
        </button>
        <button
          type="button"
          className={editor?.isActive({ textAlign: 'center' }) ? 'active' : ''}
          onClick={() => handleSetTextAlign('center')}
          disabled={!hasTracker}
        >
          Center
        </button>
        <button
          type="button"
          className={editor?.isActive({ textAlign: 'right' }) ? 'active' : ''}
          onClick={() => handleSetTextAlign('right')}
          disabled={!hasTracker}
        >
          Right
        </button>

        <div className="toolbar-divider" />

        <button type="button" onClick={handleSetLink} disabled={!hasTracker}>
          Link
        </button>
        <button type="button" onClick={() => editor?.chain().focus().unsetLink().run()} disabled={!hasTracker}>
          Unlink
        </button>
        <button type="button" onClick={() => editor?.chain().focus().undo().run()} disabled={!hasTracker}>
          Undo
        </button>
        <button type="button" onClick={() => editor?.chain().focus().redo().run()} disabled={!hasTracker}>
          Redo
        </button>
        <button type="button" onClick={handleExportText} disabled={!hasTracker}>
          Export
        </button>

        <div className="toolbar-divider" />

        <div className="table-picker-wrap">
          <button
            type="button"
            ref={tableButtonRef}
            onClick={() => setTablePickerOpen((prev) => !prev)}
            disabled={!hasTracker}
          >
            Table
          </button>
          {tablePickerOpen && (
            <div
              className="table-picker-backdrop"
              onClick={closeTablePicker}
              aria-hidden="true"
            />
          )}
          {tablePickerOpen && (
            <div className="table-picker" ref={tablePickerRef}>
              <div className="table-picker-grid">
                {tableGrid.map((row) =>
                  row.map((cell) => {
                    const isActive =
                      cell.row <= tableSize.rows && cell.col <= tableSize.cols
                    return (
                      <div
                        key={`${cell.row}-${cell.col}`}
                        className={`table-picker-cell ${isActive ? 'active' : ''}`}
                        onMouseEnter={() => setTableSize({ rows: cell.row, cols: cell.col })}
                        onClick={() => handleInsertTable(cell.row, cell.col)}
                      />
                    )
                  }),
                )}
              </div>
              <div className="table-picker-label">
                {tableSize.rows} × {tableSize.cols}
              </div>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => editor?.chain().focus().addRowAfter().run()}
          disabled={!hasTracker}
        >
          + Row
        </button>
        <button
          type="button"
          onClick={() => editor?.chain().focus().addColumnAfter().run()}
          disabled={!hasTracker}
        >
          + Col
        </button>
        {inTable && (
          <div className="shading-control" ref={shadingButtonRef}>
            <button
              type="button"
              className={shadingColor ? 'active' : ''}
              onClick={handleApplyShading}
              disabled={!hasTracker}
            >
              Shading
            </button>
            <button
              type="button"
              className="shading-dropdown"
              onClick={() => setShadingPickerOpen((prev) => !prev)}
              disabled={!hasTracker}
              aria-label="Shading colors"
            >
              ▾
            </button>
            {shadingPickerOpen && (
              <div className="shading-picker" ref={shadingPickerRef}>
                <div className="shading-section">
                  <p className="shading-header">Theme Colors</p>
                  <div className="shading-grid">
                    {themeRows.map((row, rowIndex) =>
                      row.map((color, colIndex) => (
                        <button
                          key={`theme-${rowIndex}-${colIndex}`}
                          type="button"
                          className={`shading-swatch ${
                            shadingColor?.toLowerCase() === color.toLowerCase() ? 'active' : ''
                          }`}
                          style={{ backgroundColor: color }}
                          onClick={() => handlePickShading(color)}
                          aria-label={`Theme color ${rowIndex + 1}-${colIndex + 1}`}
                        />
                      )),
                    )}
                  </div>
                </div>
                <div className="shading-section">
                  <p className="shading-header">Standard Colors</p>
                  <div className="shading-grid shading-grid-standard">
                    {standardColors.map((color, index) => (
                      <button
                        key={`standard-${color}`}
                        type="button"
                        className={`shading-swatch ${
                          shadingColor?.toLowerCase() === color.toLowerCase() ? 'active' : ''
                        }`}
                        style={{ backgroundColor: color }}
                        onClick={() => handlePickShading(color)}
                        aria-label={`Standard color ${index + 1}`}
                      />
                    ))}
                  </div>
                </div>
                <div className="shading-actions">
                  <button type="button" className="shading-action" onClick={() => handlePickShading(null)}>
                    <span className="shading-icon" aria-hidden="true" />
                    No Color
                  </button>
                  <button type="button" className="shading-action" onClick={openCustomShading}>
                    <span className="shading-icon palette" aria-hidden="true" />
                    More Colors...
                  </button>
                  <input
                    ref={shadingInputRef}
                    type="color"
                    className="shading-input"
                    onChange={handleCustomShading}
                    aria-label="Custom shading color"
                  />
                </div>
              </div>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={() => editor?.chain().focus().deleteTable().run()}
          disabled={!hasTracker}
        >
          Delete table
        </button>

        <div className="toolbar-divider" />

        <button type="button" onClick={handlePickImage} disabled={!hasTracker}>
          Image
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          className="file-input"
        />
      </div>

      <div className="editor-shell">
        {hasTracker ? (
          <EditorContent editor={editor} />
        ) : (
          <div className="editor-empty">
            <p>Select a tracker or create a new one to start writing.</p>
          </div>
        )}
      </div>

      {contextMenu.open && (
        <div
          ref={contextMenuRef}
          className="table-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            type="button"
            className={`table-context-item ${!deepLinkHash ? 'disabled' : ''}`}
            onClick={handleCopyLink}
            disabled={!deepLinkHash}
          >
            Copy link to paragraph
          </button>
          {contextMenu.inTable && (
            <div
              className="table-context-parent"
              onMouseEnter={() => setSubmenuOpen(true)}
              onMouseLeave={() => setSubmenuOpen(false)}
            >
              <button
                type="button"
                className="table-context-item"
                onClick={() => setSubmenuOpen((prev) => !prev)}
              >
                Table
              </button>
              {submenuOpen && (
                <div
                  ref={submenuRef}
                  className={`table-submenu ${submenuDirection === 'left' ? 'left' : 'right'}`}
                >
                  {contextMenuItems.map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      className="table-context-item"
                      onClick={() => {
                        item.action()
                        closeContextMenu()
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

export default EditorPanel
