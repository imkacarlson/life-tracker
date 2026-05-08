import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TextSelection } from '@tiptap/pm/state'
import { mixColors } from '../../utils/colorUtils'
import { serializeDocForExport } from '../../lib/serializeDocForExport'
import { findInDocPluginKey } from '../../extensions/findInDoc'
import { toggleLineStrike } from '../../extensions/keyboard/toggleLineStrike'
import { useKeepCursorVisible } from '../../hooks/useKeepCursorVisible'
import { useEditorUIStore } from '../../stores/editorUIStore'
import FindBar from './FindBar'
import ToolButton from './ToolButton'
import HighlightPicker from './toolbar/HighlightPicker'
import ShadingPicker from './toolbar/ShadingPicker'
import TablePicker from './toolbar/TablePicker'
import AiDailyPicker from './toolbar/AiDailyPicker'
import MoreMenu from './toolbar/MoreMenu'
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

  // Idiomatic Tiptap chain. Selection preservation on touch is handled at the
  // ToolButton layer (preventDefault on mousedown), so always include .focus().
  const cmd = useCallback(() => editor?.chain().focus() ?? null, [editor])

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

  // --- Editor command handlers ---

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
    cmd()?.setTextAlign(alignment).run()
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
    cmd()?.insertTable({ rows, cols, withHeaderRow: false }).run()
  }

  const handleApplyHighlight = () => {
    if (!editor) return
    if (!highlightColor) {
      cmd()?.unsetHighlight().run()
      return
    }
    cmd()?.setHighlight({ color: highlightColor }).run()
  }

  const handlePickHighlight = (color) => {
    if (!editor) return
    if (!color) {
      setHighlightColor(null)
      cmd()?.unsetHighlight().run()
    } else {
      setHighlightColor(color)
      cmd()?.setHighlight({ color }).run()
    }
  }

  const handleApplyShading = () => {
    if (!editor) return
    if (!shadingColor) {
      cmd()?.setCellAttribute('backgroundColor', null).run()
      return
    }
    cmd()?.setCellAttribute('backgroundColor', shadingColor).run()
  }

  const handlePickShading = (color) => {
    if (!editor) return
    if (!color) {
      setShadingColor(null)
      cmd()?.setCellAttribute('backgroundColor', null).run()
    } else {
      setShadingColor(color)
      cmd()?.setCellAttribute('backgroundColor', color).run()
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

  // ToolButton helpers — every toolbar button uses the wrapper that
  // preserves the editor selection on touch.
  const tb = (props) => (
    <ToolButton
      isTouchOnly={isTouchOnly}
      disabled={!hasTracker}
      {...props}
    />
  )

  return (
    <div
      ref={toolbarRef}
      className={`toolbar${controlsDisabled ? ' disabled' : ''}${isTouchOnly && !toolbarExpanded ? ' toolbar-collapsed' : ''}`}
      data-expanded={!isTouchOnly || toolbarExpanded ? 'true' : 'false'}
    >
      <div className="toolbar-core">
        {/* Text formatting group */}
        <div className="toolbar-group">
          {tb({
            active: editor?.isActive('bold'),
            onActivate: () => cmd()?.toggleBold().run(),
            title: 'Bold',
            children: <BoldIcon />,
          })}
          {tb({
            active: editor?.isActive('italic'),
            onActivate: () => cmd()?.toggleItalic().run(),
            title: 'Italic',
            children: <ItalicIcon />,
          })}
          {tb({
            active: editor?.isActive('heading', { level: 1 }),
            onActivate: () => cmd()?.toggleHeading({ level: 1 }).run(),
            title: 'Heading 1',
            children: <span className="toolbar-btn-label">H1</span>,
          })}
          {tb({
            active: editor?.isActive('bulletList'),
            onActivate: () => cmd()?.toggleBulletList().run(),
            title: 'Bullet list',
            children: <BulletListIcon />,
          })}
          {isTouchOnly && (
            <>
              {tb({
                disabled: !hasTracker || !isInList,
                onActivate: handleOutdent,
                title: 'Outdent',
                ariaLabel: 'Outdent list item',
                testId: 'toolbar-outdent',
                children: <OutdentIcon />,
              })}
              {tb({
                disabled: !hasTracker || !isInList,
                onActivate: handleIndent,
                title: 'Indent',
                ariaLabel: 'Indent list item',
                testId: 'toolbar-indent',
                children: <IndentIcon />,
              })}
            </>
          )}
        </div>

        {/* Link + Undo group */}
        <div className="toolbar-group">
          {tb({
            onActivate: handleSetLink,
            title: 'Link',
            ariaLabel: 'Insert link',
            children: <LinkIcon />,
          })}
          {tb({
            onActivate: () => cmd()?.undo().run(),
            title: 'Undo',
            testId: 'toolbar-undo',
            children: <UndoIcon />,
          })}
        </div>

        {/* Mobile expand toggle */}
        {isTouchOnly && (
          <ToolButton
            isTouchOnly={isTouchOnly}
            className="toolbar-expand-toggle"
            onActivate={() => setToolbarExpanded((prev) => !prev)}
            ariaLabel={toolbarExpanded ? 'Collapse toolbar' : 'Expand toolbar'}
            testId="toolbar-expand-toggle"
          >
            {toolbarExpanded ? '▴' : '▾'}
          </ToolButton>
        )}
      </div>

      <div className="toolbar-extra">
        {/* Extended text formatting */}
        <div className="toolbar-group">
          {tb({
            active: editor?.isActive('underline'),
            onActivate: () => cmd()?.toggleUnderline().run(),
            title: 'Underline',
            children: <UnderlineIcon />,
          })}
          {tb({
            active: editor?.isActive('strike'),
            onActivate: () => editor && toggleLineStrike(editor),
            title: 'Strikethrough',
            ariaLabel: 'Toggle strikethrough',
            testId: 'toolbar-strikethrough',
            children: <StrikethroughIcon />,
          })}
          <div className="highlight-control" ref={highlightButtonRef}>
            {tb({
              active: editor?.isActive('highlight'),
              onActivate: handleApplyHighlight,
              title: 'Highlight',
              children: (
                <>
                  <HighlightIcon />
                  <span
                    className="toolbar-color-bar"
                    style={{ backgroundColor: highlightColor ?? 'transparent' }}
                  />
                </>
              ),
            })}
            {tb({
              className: 'toolbar-btn-caret',
              onActivate: () => setHighlightPickerOpen((prev) => !prev),
              ariaLabel: 'Highlight colors',
              children: '▾',
            })}
            {highlightPickerOpen && (
              <HighlightPicker
                pickerRef={highlightPickerRef}
                colors={highlightColors}
                onPick={onPickHighlight}
              />
            )}
          </div>
          <input
            type="color"
            aria-label="Text color"
            className="toolbar-color-input"
            onChange={(event) => cmd()?.setColor(event.target.value).run()}
            disabled={!hasTracker}
          />
        </div>

        {/* Headings + Lists */}
        <div className="toolbar-group">
          {tb({
            active: editor?.isActive('heading', { level: 2 }),
            onActivate: () => cmd()?.toggleHeading({ level: 2 }).run(),
            title: 'Heading 2',
            children: <span className="toolbar-btn-label">H2</span>,
          })}
          {tb({
            active: editor?.isActive('orderedList'),
            onActivate: () => cmd()?.toggleOrderedList().run(),
            title: 'Numbered list',
            children: <OrderedListIcon />,
          })}
          {tb({
            active: editor?.isActive('taskList'),
            onActivate: () => cmd()?.toggleTaskList().run(),
            title: 'Task list',
            children: <TaskListIcon />,
          })}
        </div>

        {/* Alignment */}
        <div className="toolbar-group">
          {tb({
            active: editor?.isActive({ textAlign: 'left' }),
            onActivate: () => handleSetTextAlign('left'),
            title: 'Align left',
            children: <AlignLeftIcon />,
          })}
          {tb({
            active: editor?.isActive({ textAlign: 'center' }),
            onActivate: () => handleSetTextAlign('center'),
            title: 'Align center',
            children: <AlignCenterIcon />,
          })}
          {tb({
            active: editor?.isActive({ textAlign: 'right' }),
            onActivate: () => handleSetTextAlign('right'),
            title: 'Align right',
            children: <AlignRightIcon />,
          })}
        </div>

        <div className="toolbar-separator" />

        {/* Insert group */}
        <div className="toolbar-group">
          {tb({
            onActivate: () => cmd()?.unsetLink().run(),
            title: 'Unlink',
            ariaLabel: 'Remove link',
            children: <UnlinkIcon />,
          })}
          {tb({
            onActivate: handlePickImage,
            title: 'Image',
            ariaLabel: 'Insert image',
            children: <ImageIcon />,
          })}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className="file-input"
          />
          <div className="table-picker-wrap">
            {tb({
              buttonRef: tableButtonRef,
              onActivate: () => setTablePickerOpen((prev) => !prev),
              title: 'Table',
              ariaLabel: 'Insert table',
              children: <TableIcon />,
            })}
            {tablePickerOpen && (
              <TablePicker
                pickerRef={tablePickerRef}
                size={tableSize}
                setSize={setTableSize}
                onInsert={onInsertTable}
                onClose={closeTablePicker}
              />
            )}
          </div>
          {tb({
            onActivate: () => cmd()?.addRowAfter().run(),
            title: 'Add row',
            children: <AddRowIcon />,
          })}
          {tb({
            onActivate: () => cmd()?.addColumnAfter().run(),
            title: 'Add column',
            children: <AddColIcon />,
          })}
          {inTable && (
            <div className="shading-control" ref={shadingButtonRef}>
              {tb({
                active: !!shadingColor,
                onActivate: handleApplyShading,
                title: 'Shading',
                ariaLabel: 'Cell shading',
                children: <ShadingIcon />,
              })}
              {tb({
                className: 'toolbar-btn-caret',
                onActivate: () => setShadingPickerOpen((prev) => !prev),
                ariaLabel: 'Shading colors',
                children: '▾',
              })}
              {shadingPickerOpen && (
                <ShadingPicker
                  pickerRef={shadingPickerRef}
                  themeRows={themeRows}
                  standardColors={standardColors}
                  shadingColor={shadingColor}
                  customInputRef={shadingInputRef}
                  onPick={onPickShading}
                  onOpenCustom={openCustomShading}
                  onCustomChange={handleCustomShading}
                />
              )}
            </div>
          )}
          {tb({
            onActivate: () => cmd()?.deleteTable().run(),
            title: 'Delete table',
            children: <DeleteTableIcon />,
          })}
        </div>

        <div className="toolbar-separator" />

        {/* Undo/Redo + utilities */}
        <div className="toolbar-group">
          {tb({
            onActivate: () => cmd()?.redo().run(),
            title: 'Redo',
            children: <RedoIcon />,
          })}
          {tb({
            onActivate: handleExportText,
            title: 'Export',
            children: <ExportIcon />,
          })}
          {tb({
            onActivate: handleCopyText,
            title: copyLabel,
            ariaLabel: 'Copy text',
            children: <CopyIcon />,
          })}
        </div>

        {/* AI group */}
        {showAiDaily && (
          <div className="toolbar-group">
            <div className="ai-daily-control" ref={aiDailyButtonRef}>
              {tb({
                disabled: !hasTracker || aiLoading || aiInsertLoading,
                className: 'toolbar-btn-ai',
                onActivate: onAiDailyGenerate,
                title: aiLoading ? 'Generating...' : 'AI Daily',
                ariaLabel: 'AI Daily',
                children: (
                  <>
                    <AiIcon />
                    <span className="toolbar-btn-label toolbar-btn-ai-label">
                      {aiLoading ? '...' : 'AI'}
                    </span>
                  </>
                ),
              })}
              {tb({
                disabled: !hasTracker || aiLoading || aiInsertLoading,
                className: 'toolbar-btn-caret',
                onActivate: () => setAiDailyPickerOpen((prev) => !prev),
                ariaLabel: 'Pick date for AI Daily',
                children: '▾',
              })}
              {aiDailyPickerOpen && (
                <AiDailyPicker
                  pickerRef={aiDailyPickerRef}
                  date={aiDailyDate}
                  onPrevDay={handleAiDailyPrevDay}
                  onNextDay={handleAiDailyNextDay}
                  onDateChange={handleAiDailyDateChange}
                />
              )}
            </div>
            {showAiInsert && tb({
              disabled: !hasTracker || aiLoading || aiInsertLoading,
              className: 'toolbar-btn-ai',
              onActivate: () => {
                setAiDailyPickerOpen(false)
                setAiInsertOpen(true)
              },
              title: aiInsertLoading ? 'Inserting...' : 'AI Insert',
              ariaLabel: 'AI Insert',
              children: (
                <>
                  <AiIcon />
                  <span className="toolbar-btn-label toolbar-btn-ai-label">
                    {aiInsertLoading ? '...' : '⊕'}
                  </span>
                </>
              ),
            })}
          </div>
        )}

        {/* Search + More */}
        <div className="toolbar-group">
          {tb({
            onActivate: openFind,
            title: 'Find',
            ariaLabel: 'Find in page',
            children: <SearchIcon />,
          })}
          <div className="more-menu-wrap" ref={moreMenuRef}>
            {tb({
              onActivate: () => setMoreMenuOpen((prev) => !prev),
              title: 'More',
              ariaLabel: 'More actions',
              children: <MoreIcon />,
            })}
            {moreMenuOpen && (
              <MoreMenu
                onClose={() => setMoreMenuOpen(false)}
                onCopyLink={onCopyLinkFromToolbar}
                copyLinkDisabled={!toolbarDeepLinkHash}
                onSetTrackerPage={onSetTrackerFromToolbar}
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
