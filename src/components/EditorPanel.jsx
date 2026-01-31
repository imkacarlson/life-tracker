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
  const contextMenuRef = useRef(null)
  const submenuRef = useRef(null)
  const longPressTimerRef = useRef(null)
  const [tablePickerOpen, setTablePickerOpen] = useState(false)
  const [tableSize, setTableSize] = useState({ rows: 2, cols: 2 })
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
      editor.chain().focus().setTextSelection(pos).run()
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
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      const node = $from.node(depth)
      if (node?.attrs?.id) {
        return node.attrs.id
      }
    }
    return null
  }

  useEffect(() => {
    if (!editor) return
    const dom = editor.view.dom

    const handleContextMenu = (event) => {
      event.preventDefault()
      const inTable = Boolean(getCellFromEvent(event))
      if (inTable) {
        focusCellFromEvent(event)
      } else {
        focusFromCoords({ left: event.clientX, top: event.clientY })
      }
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
      if (contextMenu.open) {
        const menu = contextMenuRef.current
        if (menu?.contains(event.target)) return
        closeContextMenu()
      }
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setTablePickerOpen(false)
        closeContextMenu()
      }
    }

    document.addEventListener('mousedown', handleOutsideClick)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [tablePickerOpen, contextMenu.open, closeContextMenu])

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
    const dom = editor.view.dom
    const handleClick = (event) => {
      const link = event.target.closest?.('a')
      if (!link) return
      const href = link.getAttribute('href')
      if (!href || !href.startsWith('#nb=')) return
      event.preventDefault()
      onNavigateHash?.(href)
    }
    dom.addEventListener('click', handleClick)
    return () => dom.removeEventListener('click', handleClick)
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
        <button
          type="button"
          className={editor?.isActive('highlight') ? 'active' : ''}
          onClick={() => editor?.chain().focus().toggleHighlight({ color: '#fff3a3' }).run()}
          disabled={!hasTracker}
        >
          Highlight
        </button>
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
        <input
          type="color"
          aria-label="Cell color"
          onChange={(event) =>
            editor?.chain().focus().setCellAttribute('backgroundColor', event.target.value).run()
          }
          disabled={!hasTracker}
        />
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
