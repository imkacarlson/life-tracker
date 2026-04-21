import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TextSelection } from '@tiptap/pm/state'
import { isTouchOnlyDevice } from '../../utils/device'
import { mixColors } from '../../utils/colorUtils'
import { serializeDocForExport } from '../../lib/serializeDocForExport'
import { findInDocPluginKey } from '../../extensions/findInDoc'
import { toggleLineStrike } from '../../extensions/keyboard/toggleLineStrike'
import { useKeepCursorVisible } from '../../hooks/useKeepCursorVisible'
import { useEditorUIStore } from '../../stores/editorUIStore'
import FindBar from './FindBar'
import {
  BoldIcon, ItalicIcon, UnderlineIcon, StrikethroughIcon,
  HighlightIcon, TextColorIcon,
  BulletListIcon, OrderedListIcon, TaskListIcon,
  AlignLeftIcon, AlignCenterIcon, AlignRightIcon,
  LinkIcon, UnlinkIcon, ImageIcon,
  TableIcon, AddRowIcon, AddColIcon, DeleteTableIcon, ShadingIcon,
  UndoIcon, RedoIcon,
  SearchIcon, ExportIcon, CopyIcon, MoreIcon, AiIcon,
  IndentIcon, OutdentIcon,
} from './ToolbarIcons'

function Toolbar({
  editor,
  controlsDisabled,
  hasTracker,
  isTouchOnly,
  toolbarRef,
  editorPanelRef,
  onImageUpload,
  onAiDailyGenerate,
  showAiDaily,
  showAiInsert,
  title,
  toolbarDeepLinkHash,
  isCurrentPageTracker,
  trackerPageSaving,
  onSetTrackerPage,
  handleSetTrackerFromToolbar,
  contextMenuItems,
}) {
  const {
    toolbarExpanded, setToolbarExpanded,
    findOpen, setFindOpen,
    findQuery, setFindQuery,
    findStatus, setFindStatus,
    aiInsertOpen, setAiInsertOpen,
    aiInsertLoading,
    aiLoading,
    aiDailyDate, setAiDailyDate,
    inTable,
    highlightColor, setHighlightColor,
    shadingColor, setShadingColor,
    copyLabel, setCopyLabel,
  } = useEditorUIStore()

  // Refs local to Toolbar
  const fileInputRef = useRef(null)
  const shadingInputRef = useRef(null)
  const findInputRef = useRef(null)
  const highlightButtonRef = useRef(null)
  const highlightPickerRef = useRef(null)
  const shadingButtonRef = useRef(null)
  const shadingPickerRef = useRef(null)
  const tableButtonRef = useRef(null)
  const tablePickerRef = useRef(null)
  const aiDailyButtonRef = useRef(null)
  const aiDailyPickerRef = useRef(null)
  const moreMenuRef = useRef(null)

  // Purely local UI state (not shared, no need for store)
  const [highlightPickerOpen, setHighlightPickerOpen] = useState(false)
  const [shadingPickerOpen, setShadingPickerOpen] = useState(false)
  const [tablePickerOpen, setTablePickerOpen] = useState(false)
  const [tableSize, setTableSize] = useState({ rows: 2, cols: 2 })
  const [aiDailyPickerOpen, setAiDailyPickerOpen] = useState(false)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const gridSize = 5

  // On touch devices, avoid calling .focus() when the editor isn't already
  // focused — that would open the virtual keyboard.
  const editorCmd = useCallback(() => {
    if (!editor) return null
    return (isTouchOnly && !editor.view.hasFocus())
      ? editor.chain()
      : editor.chain().focus()
  }, [editor, isTouchOnly])

  const isInList = editor?.isActive('bulletList') || editor?.isActive('orderedList') || editor?.isActive('taskList')

  // --- Find handlers ---

  const openFind = useCallback(() => {
    if (!editor || !hasTracker) return
    setFindOpen(true)
    requestAnimationFrame(() => {
      findInputRef.current?.focus()
      findInputRef.current?.select()
    })
  }, [editor, hasTracker, setFindOpen])

  const closeFind = useCallback(() => {
    setFindOpen(false)
    setFindQuery('')
    editor?.commands?.clearFind?.()
    if (!editor || controlsDisabled) return
    requestAnimationFrame(() => {
      editor.chain().focus().run()
    })
  }, [editor, controlsDisabled, setFindOpen, setFindQuery])

  const handleFindQueryChange = (value) => {
    setFindQuery(value)
    editor?.commands?.setFindQuery?.(value)
  }

  const scrollMatchIntoView = useCallback(() => {
    if (!editor) return
    requestAnimationFrame(() => {
      const container = editorPanelRef?.current
      if (!container) return
      const { view } = editor
      const { from } = view.state.selection
      const coords = view.coordsAtPos(from)
      const containerRect = container.getBoundingClientRect()
      const toolbarEl = container.querySelector('.toolbar')
      const bottomPadding = 50

      const isScrollContainer =
        container.scrollHeight > container.clientHeight &&
        getComputedStyle(container).overflowY !== 'visible'

      if (isScrollContainer) {
        const toolbarBottom = toolbarEl ? toolbarEl.getBoundingClientRect().bottom : containerRect.top
        if (coords.top < toolbarBottom) {
          container.scrollBy({ top: -(toolbarBottom - coords.top + 20), behavior: 'instant' })
        } else if (coords.bottom > containerRect.bottom - bottomPadding) {
          container.scrollBy({ top: coords.bottom - containerRect.bottom + bottomPadding + 20, behavior: 'instant' })
        }
      } else {
        const toolbarBottom = toolbarEl ? toolbarEl.getBoundingClientRect().bottom : 0
        if (coords.top < toolbarBottom) {
          window.scrollBy({ top: -(toolbarBottom - coords.top + 20), behavior: 'instant' })
        } else if (coords.bottom > window.innerHeight - bottomPadding) {
          window.scrollBy({ top: coords.bottom - window.innerHeight + bottomPadding + 20, behavior: 'instant' })
        }
      }
    })
  }, [editor, editorPanelRef])

  const handleFindNext = () => {
    editor?.commands?.findNext?.()
    scrollMatchIntoView()
  }

  const handleFindPrev = () => {
    editor?.commands?.findPrev?.()
    scrollMatchIntoView()
  }

  // Wire openFind/closeFind into editor storage so the extension can trigger them
  useEffect(() => {
    if (!editor) return undefined
    const findStorage = editor.storage.findInDoc
    if (!findStorage) return undefined
    findStorage.open = openFind
    findStorage.close = closeFind
    return () => {
      if (editor.storage?.findInDoc) {
        editor.storage.findInDoc.open = null
        editor.storage.findInDoc.close = null
      }
    }
  }, [editor, openFind, closeFind])

  // Sync find plugin state → store
  useEffect(() => {
    if (!editor) return undefined
    const syncFindState = () => {
      const pluginState = findInDocPluginKey.getState(editor.state)
      if (!pluginState) return
      setFindStatus(pluginState)
      setFindQuery(pluginState.query || '')
    }
    syncFindState()
    editor.on('transaction', syncFindState)
    return () => editor.off('transaction', syncFindState)
  }, [editor, setFindStatus, setFindQuery])

  // --- Selection sync helpers for indent/outdent ---

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

  const getListItemInfo = useCallback(() => {
    if (!editor) return null
    const { $from } = editor.state.selection
    const itemTypeName = editor.isActive('taskList') || editor.isActive('taskItem') ? 'taskItem' : 'listItem'
    let itemDepth = null
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      const node = $from.node(depth)
      if (node.type?.name === 'listItem' || node.type?.name === 'taskItem') {
        itemDepth = depth
        break
      }
    }
    if (!itemDepth) return null
    const listDepth = itemDepth - 1
    const index = $from.index(listDepth)
    const listParentDepth = listDepth - 1
    const listParent = listParentDepth > 0 ? $from.node(listParentDepth) : null
    const isNested = listParent?.type?.name === 'listItem' || listParent?.type?.name === 'taskItem'
    return { itemTypeName, itemDepth, listDepth, index, isNested }
  }, [editor])

  const handleIndent = useCallback(() => {
    if (!editor) return
    syncSelectionFromDom()
    const info = getListItemInfo()
    if (!info || info.index === 0) return
    editor.chain().focus().sinkListItem(info.itemTypeName).run()
  }, [editor, getListItemInfo, syncSelectionFromDom])

  const handleOutdent = useCallback(() => {
    if (!editor) return
    syncSelectionFromDom()
    const info = getListItemInfo()
    if (!info || !info.isNested) return
    editor.chain().focus().liftListItem(info.itemTypeName).run()
  }, [editor, getListItemInfo, syncSelectionFromDom])

  // --- Editor command handlers (moved from EditorPanel) ---

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
    editorCmd()?.setTextAlign(alignment).run()
  }

  const handleExportText = () => {
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

  const handleCopyText = async () => {
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

  const handleInsertTable = (rows, cols) => {
    if (!editor) return
    editorCmd()?.insertTable({ rows, cols, withHeaderRow: false }).run()
  }

  const handleApplyHighlight = () => {
    if (!editor) return
    if (!highlightColor) {
      editorCmd()?.unsetHighlight().run()
      return
    }
    editorCmd()?.setHighlight({ color: highlightColor }).run()
  }

  const handlePickHighlight = (color) => {
    if (!editor) return
    if (!color) {
      setHighlightColor(null)
      editorCmd()?.unsetHighlight().run()
    } else {
      setHighlightColor(color)
      editorCmd()?.setHighlight({ color }).run()
    }
  }

  const handleApplyShading = () => {
    if (!editor) return
    if (!shadingColor) {
      editorCmd()?.setCellAttribute('backgroundColor', null).run()
      return
    }
    editorCmd()?.setCellAttribute('backgroundColor', shadingColor).run()
  }

  const handlePickShading = (color) => {
    if (!editor) return
    if (!color) {
      setShadingColor(null)
      editorCmd()?.setCellAttribute('backgroundColor', null).run()
    } else {
      setShadingColor(color)
      editorCmd()?.setCellAttribute('backgroundColor', color).run()
    }
  }

  const openCustomShading = () => {
    shadingInputRef.current?.click()
  }

  const handleCustomShading = (event) => {
    const color = event.target.value
    if (!color) return
    handlePickShading(color)
  }

  // AI Daily date navigation
  const handleAiDailyPrevDay = () => {
    setAiDailyDate((prev) => {
      const next = new Date(prev)
      next.setDate(next.getDate() - 1)
      return next
    })
  }

  const handleAiDailyNextDay = () => {
    setAiDailyDate((prev) => {
      const next = new Date(prev)
      next.setDate(next.getDate() + 1)
      return next
    })
  }

  const handleAiDailyDateChange = (dateString) => {
    const parsed = new Date(dateString + 'T00:00:00')
    if (!isNaN(parsed.getTime())) {
      setAiDailyDate(parsed)
    }
  }

  const handleCopyLinkFromToolbar = async () => {
    if (!toolbarDeepLinkHash) return
    await navigator.clipboard.writeText(toolbarDeepLinkHash)
  }

  // --- Color data (theme palette for shading/highlight pickers) ---

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
          if (base === '#ffffff') return mixColors(base, '#000000', amount)
          return mixColors(base, '#ffffff', amount)
        }),
      ),
    ]
  }, [themeBaseColors])

  const standardColors = useMemo(
    () => [
      '#7f1d1d', '#ef4444', '#f97316', '#f59e0b', '#22c55e',
      '#0f766e', '#3b82f6', '#1e3a8a', '#0f172a', '#7c3aed',
    ],
    [],
  )

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

  // --- Lifecycle effects ---

  // Publish toolbar height as CSS custom property for mobile padding
  useEffect(() => {
    if (!isTouchOnly || !toolbarRef?.current) return
    const el = toolbarRef.current
    const publishHeight = () => {
      const height = Math.ceil(el.getBoundingClientRect().height)
      document.documentElement.style.setProperty('--toolbar-height', `${height}px`)
    }
    const ro = new ResizeObserver((entries) => {
      if (!entries[0]) return
      publishHeight()
    })
    publishHeight()
    ro.observe(el)
    return () => {
      ro.disconnect()
      document.documentElement.style.removeProperty('--toolbar-height')
    }
  }, [isTouchOnly, toolbarRef])

  // When the toolbar expands on mobile, scroll so the cursor stays visible above it.
  useKeepCursorVisible({ enabled: isTouchOnly, editor, toolbarExpanded, toolbarRef })

  // Outside click and escape handlers for pickers
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
      if (aiDailyPickerOpen) {
        const picker = aiDailyPickerRef.current
        const button = aiDailyButtonRef.current
        if (picker?.contains(event.target) || button?.contains(event.target)) return
        setAiDailyPickerOpen(false)
      }
      if (moreMenuOpen && moreMenuRef.current && !moreMenuRef.current.contains(event.target)) {
        setMoreMenuOpen(false)
      }
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setTablePickerOpen(false)
        setHighlightPickerOpen(false)
        setShadingPickerOpen(false)
        setAiDailyPickerOpen(false)
        setMoreMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', handleOutsideClick)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [tablePickerOpen, highlightPickerOpen, shadingPickerOpen, aiDailyPickerOpen, moreMenuOpen])

  const tableGrid = useMemo(() => {
    return Array.from({ length: gridSize }, (_, rowIndex) =>
      Array.from({ length: gridSize }, (_, colIndex) => ({
        row: rowIndex + 1,
        col: colIndex + 1,
      })),
    )
  }, [gridSize])

  const closeTablePicker = useCallback(() => setTablePickerOpen(false), [])

  const onInsertTable = (rows, cols) => {
    handleInsertTable(rows, cols)
    closeTablePicker()
  }

  const onPickHighlight = (color) => {
    handlePickHighlight(color)
    setHighlightPickerOpen(false)
  }

  const onPickShading = (color) => {
    handlePickShading(color)
    setShadingPickerOpen(false)
  }

  const onCopyLinkFromToolbar = async () => {
    await handleCopyLinkFromToolbar()
    setMoreMenuOpen(false)
  }

  const onSetTrackerFromToolbar = async () => {
    await handleSetTrackerFromToolbar()
    setMoreMenuOpen(false)
  }

  return (
    <div
      ref={toolbarRef}
      className={`toolbar${controlsDisabled ? ' disabled' : ''}${isTouchOnly && !toolbarExpanded ? ' toolbar-collapsed' : ''}`}
      data-expanded={!isTouchOnly || toolbarExpanded ? 'true' : 'false'}
      onMouseDownCapture={(event) => {
        if (event.target instanceof HTMLElement && event.target.closest('button')) {
          event.preventDefault()
        }
      }}
    >
      <div className="toolbar-core">
        {/* Text formatting group */}
        <div className="toolbar-group">
          <button
            type="button"
            className={`toolbar-btn${editor?.isActive('bold') ? ' active' : ''}`}
            onClick={() => editorCmd().toggleBold().run()}
            disabled={!hasTracker}
            title="Bold"
            aria-label="Bold"
          >
            <BoldIcon />
          </button>
          <button
            type="button"
            className={`toolbar-btn${editor?.isActive('italic') ? ' active' : ''}`}
            onClick={() => editorCmd().toggleItalic().run()}
            disabled={!hasTracker}
            title="Italic"
            aria-label="Italic"
          >
            <ItalicIcon />
          </button>
          <button
            type="button"
            className={`toolbar-btn${editor?.isActive('heading', { level: 1 }) ? ' active' : ''}`}
            onClick={() => editorCmd().toggleHeading({ level: 1 }).run()}
            disabled={!hasTracker}
            title="Heading 1"
            aria-label="Heading 1"
          >
            <span className="toolbar-btn-label">H1</span>
          </button>
          <button
            type="button"
            className={`toolbar-btn${editor?.isActive('bulletList') ? ' active' : ''}`}
            onClick={() => editorCmd().toggleBulletList().run()}
            disabled={!hasTracker}
            title="Bullet list"
            aria-label="Bullet list"
          >
            <BulletListIcon />
          </button>
          {isTouchOnly && (
            <>
              <button
                type="button"
                className="toolbar-btn"
                onClick={handleOutdent}
                disabled={!hasTracker || !isInList}
                title="Outdent"
                aria-label="Outdent list item"
                data-testid="toolbar-outdent"
              >
                <OutdentIcon />
              </button>
              <button
                type="button"
                className="toolbar-btn"
                onClick={handleIndent}
                disabled={!hasTracker || !isInList}
                title="Indent"
                aria-label="Indent list item"
                data-testid="toolbar-indent"
              >
                <IndentIcon />
              </button>
            </>
          )}
        </div>

        {/* Link + Undo group */}
        <div className="toolbar-group">
          <button
            type="button"
            className="toolbar-btn"
            onClick={handleSetLink}
            disabled={!hasTracker}
            title="Link"
            aria-label="Insert link"
          >
            <LinkIcon />
          </button>
          <button
            type="button"
            className="toolbar-btn"
            onClick={() => editorCmd().undo().run()}
            disabled={!hasTracker}
            title="Undo"
            aria-label="Undo"
            data-testid="toolbar-undo"
          >
            <UndoIcon />
          </button>
        </div>

        {/* Mobile expand toggle */}
        {isTouchOnly && (
          <button
            type="button"
            className="toolbar-expand-toggle"
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => setToolbarExpanded((prev) => !prev)}
            aria-label={toolbarExpanded ? 'Collapse toolbar' : 'Expand toolbar'}
            data-testid="toolbar-expand-toggle"
          >
            {toolbarExpanded ? '▴' : '▾'}
          </button>
        )}
      </div>

      <div className="toolbar-extra">
        {/* Extended text formatting */}
        <div className="toolbar-group">
          <button
            type="button"
            className={`toolbar-btn${editor?.isActive('underline') ? ' active' : ''}`}
            onClick={() => editorCmd().toggleUnderline().run()}
            disabled={!hasTracker}
            title="Underline"
            aria-label="Underline"
          >
            <UnderlineIcon />
          </button>
          <button
            type="button"
            className={`toolbar-btn${editor?.isActive('strike') ? ' active' : ''}`}
            onClick={() => editor && toggleLineStrike(editor)}
            disabled={!hasTracker}
            title="Strikethrough"
            aria-label="Toggle strikethrough"
            data-testid="toolbar-strikethrough"
          >
            <StrikethroughIcon />
          </button>
          <div className="highlight-control" ref={highlightButtonRef}>
            <button
              type="button"
              className={`toolbar-btn${editor?.isActive('highlight') ? ' active' : ''}`}
              onClick={handleApplyHighlight}
              disabled={!hasTracker}
              title="Highlight"
              aria-label="Highlight"
            >
              <HighlightIcon />
              <span
                className="toolbar-color-bar"
                style={{ backgroundColor: highlightColor ?? 'transparent' }}
              />
            </button>
            <button
              type="button"
              className="toolbar-btn toolbar-btn-caret"
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
                        onClick={() => onPickHighlight(swatch.value)}
                        aria-label={swatch.label}
                      />
                    )),
                  )}
                </div>
                <button type="button" className="highlight-none" onClick={() => onPickHighlight(null)}>
                  No Color
                </button>
              </div>
            )}
          </div>
          <input
            type="color"
            aria-label="Text color"
            className="toolbar-color-input"
            onChange={(event) => editorCmd().setColor(event.target.value).run()}
            disabled={!hasTracker}
          />
        </div>

        {/* Headings + Lists */}
        <div className="toolbar-group">
          <button
            type="button"
            className={`toolbar-btn${editor?.isActive('heading', { level: 2 }) ? ' active' : ''}`}
            onClick={() => editorCmd().toggleHeading({ level: 2 }).run()}
            disabled={!hasTracker}
            title="Heading 2"
            aria-label="Heading 2"
          >
            <span className="toolbar-btn-label">H2</span>
          </button>
          <button
            type="button"
            className={`toolbar-btn${editor?.isActive('orderedList') ? ' active' : ''}`}
            onClick={() => editorCmd().toggleOrderedList().run()}
            disabled={!hasTracker}
            title="Numbered list"
            aria-label="Numbered list"
          >
            <OrderedListIcon />
          </button>
          <button
            type="button"
            className={`toolbar-btn${editor?.isActive('taskList') ? ' active' : ''}`}
            onClick={() => editorCmd().toggleTaskList().run()}
            disabled={!hasTracker}
            title="Task list"
            aria-label="Task list"
          >
            <TaskListIcon />
          </button>
        </div>

        {/* Alignment */}
        <div className="toolbar-group">
          <button
            type="button"
            className={`toolbar-btn${editor?.isActive({ textAlign: 'left' }) ? ' active' : ''}`}
            onClick={() => handleSetTextAlign('left')}
            disabled={!hasTracker}
            title="Align left"
            aria-label="Align left"
          >
            <AlignLeftIcon />
          </button>
          <button
            type="button"
            className={`toolbar-btn${editor?.isActive({ textAlign: 'center' }) ? ' active' : ''}`}
            onClick={() => handleSetTextAlign('center')}
            disabled={!hasTracker}
            title="Align center"
            aria-label="Align center"
          >
            <AlignCenterIcon />
          </button>
          <button
            type="button"
            className={`toolbar-btn${editor?.isActive({ textAlign: 'right' }) ? ' active' : ''}`}
            onClick={() => handleSetTextAlign('right')}
            disabled={!hasTracker}
            title="Align right"
            aria-label="Align right"
          >
            <AlignRightIcon />
          </button>
        </div>

        <div className="toolbar-separator" />

        {/* Insert group */}
        <div className="toolbar-group">
          <button
            type="button"
            className="toolbar-btn"
            onClick={() => editorCmd().unsetLink().run()}
            disabled={!hasTracker}
            title="Unlink"
            aria-label="Remove link"
          >
            <UnlinkIcon />
          </button>
          <button
            type="button"
            className="toolbar-btn"
            onClick={handlePickImage}
            disabled={!hasTracker}
            title="Image"
            aria-label="Insert image"
          >
            <ImageIcon />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className="file-input"
          />
          <div className="table-picker-wrap">
            <button
              type="button"
              className="toolbar-btn"
              ref={tableButtonRef}
              onClick={() => setTablePickerOpen((prev) => !prev)}
              disabled={!hasTracker}
              title="Table"
              aria-label="Insert table"
            >
              <TableIcon />
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
                          onClick={() => onInsertTable(cell.row, cell.col)}
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
            className="toolbar-btn"
            onClick={() => editorCmd().addRowAfter().run()}
            disabled={!hasTracker}
            title="Add row"
            aria-label="Add row"
          >
            <AddRowIcon />
          </button>
          <button
            type="button"
            className="toolbar-btn"
            onClick={() => editorCmd().addColumnAfter().run()}
            disabled={!hasTracker}
            title="Add column"
            aria-label="Add column"
          >
            <AddColIcon />
          </button>
          {inTable && (
            <div className="shading-control" ref={shadingButtonRef}>
              <button
                type="button"
                className={`toolbar-btn${shadingColor ? ' active' : ''}`}
                onClick={handleApplyShading}
                disabled={!hasTracker}
                title="Shading"
                aria-label="Cell shading"
              >
                <ShadingIcon />
              </button>
              <button
                type="button"
                className="toolbar-btn toolbar-btn-caret"
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
                            onClick={() => onPickShading(color)}
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
                          onClick={() => onPickShading(color)}
                          aria-label={`Standard color ${index + 1}`}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="shading-actions">
                    <button type="button" className="shading-action" onClick={() => onPickShading(null)}>
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
            className="toolbar-btn"
            onClick={() => editorCmd().deleteTable().run()}
            disabled={!hasTracker}
            title="Delete table"
            aria-label="Delete table"
          >
            <DeleteTableIcon />
          </button>
        </div>

        <div className="toolbar-separator" />

        {/* Undo/Redo + utilities */}
        <div className="toolbar-group">
          <button
            type="button"
            className="toolbar-btn"
            onClick={() => editorCmd().redo().run()}
            disabled={!hasTracker}
            title="Redo"
            aria-label="Redo"
          >
            <RedoIcon />
          </button>
          <button
            type="button"
            className="toolbar-btn"
            onClick={handleExportText}
            disabled={!hasTracker}
            title="Export"
            aria-label="Export"
          >
            <ExportIcon />
          </button>
          <button
            type="button"
            className="toolbar-btn"
            onClick={handleCopyText}
            disabled={!hasTracker}
            title={copyLabel}
            aria-label="Copy text"
          >
            <CopyIcon />
          </button>
        </div>

        {/* AI group */}
        {showAiDaily && (
          <div className="toolbar-group">
            <div className="ai-daily-control" ref={aiDailyButtonRef}>
              <button
                type="button"
                className="toolbar-btn toolbar-btn-ai"
                onClick={onAiDailyGenerate}
                disabled={!hasTracker || aiLoading || aiInsertLoading}
                title={aiLoading ? 'Generating...' : 'AI Daily'}
                aria-label="AI Daily"
              >
                <AiIcon />
                <span className="toolbar-btn-label toolbar-btn-ai-label">
                  {aiLoading ? '...' : 'AI'}
                </span>
              </button>
              <button
                type="button"
                className="toolbar-btn toolbar-btn-caret"
                onClick={() => setAiDailyPickerOpen((prev) => !prev)}
                disabled={!hasTracker || aiLoading || aiInsertLoading}
                aria-label="Pick date for AI Daily"
              >
                ▾
              </button>
              {aiDailyPickerOpen && (
                <div className="ai-daily-picker" ref={aiDailyPickerRef}>
                  <div className="ai-daily-date-nav">
                    <button type="button" onClick={handleAiDailyPrevDay}>&#8249;</button>
                    <span className="ai-daily-date-label">
                      {aiDailyDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
                    <button type="button" onClick={handleAiDailyNextDay}>&#8250;</button>
                  </div>
                  <input
                    type="date"
                    value={aiDailyDate.toLocaleDateString('en-CA')}
                    onChange={(e) => handleAiDailyDateChange(e.target.value)}
                    className="ai-daily-date-input"
                  />
                </div>
              )}
            </div>
            {showAiInsert && (
              <button
                type="button"
                className="toolbar-btn toolbar-btn-ai"
                onClick={() => {
                  setAiDailyPickerOpen(false)
                  setAiInsertOpen(true)
                }}
                disabled={!hasTracker || aiLoading || aiInsertLoading}
                title={aiInsertLoading ? 'Inserting...' : 'AI Insert'}
                aria-label="AI Insert"
              >
                <AiIcon />
                <span className="toolbar-btn-label toolbar-btn-ai-label">
                  {aiInsertLoading ? '...' : '⊕'}
                </span>
              </button>
            )}
          </div>
        )}

        {/* Search + More */}
        <div className="toolbar-group">
          <button
            type="button"
            className="toolbar-btn"
            onClick={openFind}
            disabled={!hasTracker}
            title="Find"
            aria-label="Find in page"
          >
            <SearchIcon />
          </button>
          <div className="more-menu-wrap" ref={moreMenuRef}>
            <button
              type="button"
              className="toolbar-btn"
              onClick={() => setMoreMenuOpen(prev => !prev)}
              disabled={!hasTracker}
              title="More"
              aria-label="More actions"
            >
              <MoreIcon />
            </button>
            {moreMenuOpen && (
              <>
                <div className="more-menu-backdrop" onClick={() => setMoreMenuOpen(false)} />
                <div className="more-menu">
                  <button
                    type="button"
                    className="table-context-item"
                    onClick={onCopyLinkFromToolbar}
                    disabled={!toolbarDeepLinkHash}
                  >
                    Copy link to paragraph
                  </button>
                  <button
                    type="button"
                    className="table-context-item"
                    onClick={onSetTrackerFromToolbar}
                    disabled={!hasTracker || isCurrentPageTracker || trackerPageSaving || !onSetTrackerPage}
                  >
                    {isCurrentPageTracker ? 'This page is the tracker page'
                      : trackerPageSaving ? 'Setting tracker page...'
                      : 'Set this page as tracker'}
                  </button>
                  {inTable && (
                    <>
                      <div className="more-menu-divider" />
                      {contextMenuItems.map((item) => (
                        <button
                          key={item.label}
                          type="button"
                          className="table-context-item"
                          onClick={() => { item.action(); setMoreMenuOpen(false) }}
                        >
                          {item.label}
                        </button>
                      ))}
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {findOpen && hasTracker && (
        <FindBar
          inputRef={findInputRef}
          findQuery={findQuery}
          findStatus={findStatus}
          onFindQueryChange={handleFindQueryChange}
          onFindPrev={handleFindPrev}
          onFindNext={handleFindNext}
          onClose={closeFind}
        />
      )}
    </div>
  )
}

export default Toolbar
