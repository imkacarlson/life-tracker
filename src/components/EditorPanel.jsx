import { useCallback, useEffect, useMemo, useRef } from 'react'
import { TableMap } from '@tiptap/pm/tables'
import { supabase } from '../lib/supabase'
import { serializeDocToText } from '../lib/serializeDoc'
import { isTouchOnlyDevice } from '../utils/device'
import { buildHash } from '../utils/navigationHelpers'
import { useContentZoom } from '../hooks/useContentZoom'
import { useMobileToolbarTransform } from '../hooks/useMobileToolbarTransform'
import { useEditorUIStore } from '../stores/editorUIStore'
import EditorHeader from './editor/EditorHeader'
import Toolbar from './editor/Toolbar'
import AiInsertModal from './editor/AiInsertModal'
import EditorShell from './editor/EditorShell'
import {
  getMergeableTemplateList,
  hasMeaningfulTemplate,
  hydrateContentWithSignedUrls,
  normalizeTemplateContent,
} from './editor/templateHelpers'
import {
  buildAiInsertContent,
  findTargetBlockMatch,
  normalizeAiInsertResponse,
  resolveFallbackInsertPos,
  resolveInsertPosCandidatesFromTargetMatch,
  resolveListInsertPlan,
} from './editor/aiInsertHelpers'

function EditorPanel({
  editor,
  editorLocked = false,
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
  allTrackers,
  trackerSourcePage = null,
  onSetTrackerPage = null,
  trackerPageSaving = false,
  userId,
  titleReadOnly = false,
  showDelete = true,
  headerActions = null,
  showAiDaily = true,
  showAiInsert = true,
}) {
  const editorPanelRef = useRef(null)
  const editorShellRef = useRef(null)
  const toolbarRef = useRef(null)
  const zoomBadgeRef = useRef(null)
  const zoomHintRef = useRef(null)
  const contextMenuRef = useRef(null)
  const submenuRef = useRef(null)
  const aiInsertInputRef = useRef(null)

  const {
    aiLoading, setAiLoading,
    aiInsertOpen, setAiInsertOpen,
    aiInsertLoading, setAiInsertLoading,
    aiInsertText, setAiInsertText,
    inTable, setInTable,
    currentBlockId, setCurrentBlockId,
    contextMenu, setContextMenu,
    submenuOpen, setSubmenuOpen,
    submenuDirection, setSubmenuDirection,
    highlightColor, setHighlightColor,
    shadingColor, setShadingColor,
    resetOnTrackerChange,
  } = useEditorUIStore()

  const isTouchOnly = useMemo(() => isTouchOnlyDevice(), [])
  const { zoomLevel, resetZoom, showHint, dismissHint, gestureRecent, isZoomSupported } =
    useContentZoom(editorShellRef, isTouchOnly)
  useMobileToolbarTransform({ enabled: isTouchOnly, toolbarRef })

  // On touch devices, avoid calling .focus() when the editor isn't already
  // focused — that would open the virtual keyboard.
  const editorCmd = useCallback(() => {
    if (!editor) return null
    return (isTouchOnly && !editor.view.hasFocus())
      ? editor.chain()
      : editor.chain().focus()
  }, [editor, isTouchOnly])

  // Scroll cursor into view whenever the editor gains focus (keyboard open).
  useEffect(() => {
    if (!editor) return
    const handleFocus = () => {
      requestAnimationFrame(() => editor.commands.scrollIntoView?.())
    }
    editor.on('focus', handleFocus)
    return () => { editor.off('focus', handleFocus) }
  }, [editor])

  useEffect(() => {
    if (!aiInsertOpen) return
    requestAnimationFrame(() => {
      aiInsertInputRef.current?.focus()
    })
  }, [aiInsertOpen])

  const loadDailyTemplateNodes = async () => {
    if (!userId) return []
    const { data, error } = await supabase
      .from('settings')
      .select('daily_template_content')
      .eq('user_id', userId)
      .maybeSingle()
    if (error) {
      console.error('Failed to load daily template:', error)
      return []
    }
    const doc = normalizeTemplateContent(data?.daily_template_content)
    if (!hasMeaningfulTemplate(doc)) return []
    const hydrated = await hydrateContentWithSignedUrls(doc, supabase)
    const nodes = Array.isArray(hydrated.content) ? hydrated.content : []
    return JSON.parse(JSON.stringify(nodes))
  }

  const scrollInsertedContentIntoView = (insertedBlockId) => {
    if (!insertedBlockId) return
    requestAnimationFrame(() => {
      const insertedElement = document.getElementById(insertedBlockId)
      if (!insertedElement) return
      insertedElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }

  const handleAiInsertSubmit = async () => {
    if (!editor || !hasTracker || aiInsertLoading) return
    const pastedText = aiInsertText.trim()
    if (!pastedText) {
      alert('Paste content before using AI Insert.')
      return
    }

    setAiInsertLoading(true)
    try {
      const provider = localStorage.getItem('ai-provider') || 'anthropic'
      const model = localStorage.getItem('ai-model') || 'claude-sonnet-4-20250514'
      const pageText = serializeDocToText(editor.getJSON())

      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        throw new Error('You must be logged in to use AI Insert')
      }

      const { data, error } = await supabase.functions.invoke('ai-insert', {
        body: {
          provider,
          model,
          pastedText,
          pageTitle: title?.trim() || 'Untitled',
          pageText,
          pageId: trackerId,
        },
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      })

      if (error) throw error

      const { targetBlockId, format, items } = normalizeAiInsertResponse(data)
      const insertedContent = buildAiInsertContent(format, items)
      const firstInsertedId = insertedContent[0]?.attrs?.id ?? null

      let inserted = false
      const targetMatch = findTargetBlockMatch(editor, targetBlockId)
      const listInsertPlan = resolveListInsertPlan(editor, targetMatch, insertedContent)
      if (listInsertPlan) {
        inserted = editor
          .chain()
          .focus()
          .insertContentAt(listInsertPlan.pos, listInsertPlan.content)
          .run()
      }

      const candidatePositions = resolveInsertPosCandidatesFromTargetMatch(editor, targetMatch)
      for (const candidatePos of candidatePositions) {
        if (inserted) break
        if (editor.chain().focus().insertContentAt(candidatePos, insertedContent).run()) {
          inserted = true
          break
        }
      }

      if (!inserted) {
        const fallbackPos = resolveFallbackInsertPos(editor)
        inserted = editor.chain().focus().insertContentAt(fallbackPos, insertedContent).run()
      }

      if (!inserted) {
        throw new Error('AI Insert could not find a valid insertion point.')
      }

      scrollInsertedContentIntoView(firstInsertedId)
      setAiInsertOpen(false)
      setAiInsertText('')
    } catch (err) {
      console.error('AI insert failed:', err)
      alert('Failed to insert content: ' + (err.message || String(err)))
    } finally {
      setAiInsertLoading(false)
    }
  }

  const handleGenerateToday = async () => {
    if (!editor || aiLoading || aiInsertLoading) return
    setAiLoading(true)
    try {
      const provider = localStorage.getItem('ai-provider') || 'anthropic'
      const model = localStorage.getItem('ai-model') || 'claude-sonnet-4-20250514'
      const selectedDate = useEditorUIStore.getState().aiDailyDate
      const today = selectedDate.toLocaleDateString('en-CA')
      const dayOfWeek = selectedDate.toLocaleDateString('en-US', { weekday: 'long' })

      const sourceTrackerPage =
        trackerSourcePage ?? (allTrackers || []).find((page) => page.is_tracker_page) ?? null
      if (!sourceTrackerPage) {
        alert('Set a tracker page first (Pages sidebar > Set tracker).')
        return
      }

      const trackerPages = [
        {
          title: sourceTrackerPage.title,
          pageId: sourceTrackerPage.id,
          content: sourceTrackerPage.content || { type: 'doc', content: [] },
        },
      ]
      const trackerPagesForModel = trackerPages.map((page) => ({
        title: page.title,
        pageId: page.pageId,
        content: page.content,
      }))

      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        throw new Error('You must be logged in to use AI Daily')
      }

      const { data, error } = await supabase.functions.invoke('generate-daily', {
        body: { provider, model, trackerPages: trackerPagesForModel, today, dayOfWeek },
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      })
      if (error) throw error
      const asapTasks = Array.isArray(data?.asap)
        ? data.asap
        : Array.isArray(data?.tasks)
          ? data.tasks
          : []
      const fyiTasks = Array.isArray(data?.fyi) ? data.fyi : []
      let templateNodes = []
      try {
        templateNodes = await loadDailyTemplateNodes()
      } catch (err) {
        console.error('Failed to load daily template:', err)
        templateNodes = []
      }
      if (asapTasks.length === 0 && fyiTasks.length === 0 && templateNodes.length === 0) {
        alert('No tasks generated. Check your tracker pages have content.')
        return
      }

      const heading = {
        type: 'heading',
        attrs: { level: 2 },
        content: [
          {
            type: 'text',
            text: selectedDate.toLocaleDateString('en-US', {
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            }),
          },
        ],
      }
      const buildListItems = (tasks) =>
        tasks.map((task) => {
          const content = [{ type: 'text', text: task.task }]
          if (task.block_ids?.length) {
            task.block_ids.forEach((blockId, i) => {
              const hash = buildHash({ notebookId, sectionId, pageId: sourceTrackerPage.id, blockId })
              content.push({ type: 'text', text: ' ' })
              content.push({
                type: 'text',
                text: `[${i + 1}]`,
                marks: [{ type: 'link', attrs: { href: hash, target: '_self' } }],
              })
            })
          }
          return { type: 'listItem', content: [{ type: 'paragraph', content }] }
        })

      const makeRow = (label, tasks, extraNodes = []) => {
        const items = buildListItems(tasks)
        const content = [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: label, marks: [{ type: 'bold' }] }],
          },
        ]

        if (extraNodes.length) {
          const mergeInfo = getMergeableTemplateList(extraNodes)
          if (mergeInfo) {
            const mergedList = {
              ...mergeInfo.listNode,
              content: [...(mergeInfo.listNode.content || []), ...items],
            }
            content.push(...mergeInfo.prefix, mergedList)
            return {
              type: 'tableRow',
              content: [{ type: 'tableCell', content }],
            }
          }
          content.push(...extraNodes)
        }

        const listContent = items.length
          ? items
          : [
              {
                type: 'listItem',
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: '...' }],
                  },
                ],
              },
            ]
        content.push({ type: 'bulletList', content: listContent })
        return {
          type: 'tableRow',
          content: [{ type: 'tableCell', content }],
        }
      }

      const table = {
        type: 'table',
        content: [
          makeRow('ASAP', asapTasks, templateNodes),
          makeRow('FYI', fyiTasks),
        ],
      }

      const insertContent = [heading]
      if (data?.warning) {
        insertContent.push({
          type: 'paragraph',
          content: [{ type: 'text', text: data.warning, marks: [{ type: 'italic' }] }],
        })
      }
      insertContent.push(table)
      if (!editor.state.selection.empty) {
        editor.commands.setTextSelection(editor.state.selection.to)
      }
      editor.chain().focus().insertContent(insertContent).run()
    } catch (err) {
      console.error('AI generation failed:', err)
      alert('Failed to generate tasks: ' + (err.message || String(err)))
    } finally {
      setAiLoading(false)
    }
  }

  const openContextMenu = useCallback((next) => {
    setContextMenu({
      open: true,
      x: next.x,
      y: next.y,
      blockId: next.blockId ?? null,
      inTable: next.inTable ?? false,
    })
    setSubmenuOpen(false)
  }, [setContextMenu, setSubmenuOpen])

  const closeContextMenu = useCallback(() => {
    setContextMenu((prev) => (prev.open ? { ...prev, open: false } : prev))
    setSubmenuOpen(false)
  }, [setContextMenu, setSubmenuOpen])

  const getCellFromEvent = useCallback((event) => {
    const target = event.target
    if (!target?.closest) return null
    return target.closest('td, th')
  }, [])

  const focusFromCoords = useCallback((coords) => {
    if (!editor) return
    const pos = editor.view?.posAtCoords(coords)
    if (pos?.pos !== undefined) {
      editor.chain().focus().setTextSelection(pos.pos).run()
    }
  }, [editor])

  const getActiveBlockId = useCallback(() => {
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
  }, [editor])

  useEffect(() => {
    if (!editor || editor.isDestroyed || !editor.view?.dom) return
    const dom = editor.view.dom

    const isTouchContextMenuEvent = (event) => {
      if (isTouchOnlyDevice()) return true
      if (event.pointerType) return event.pointerType === 'touch'
      if (event.sourceCapabilities?.firesTouchEvents) return true
      return false
    }

    const handleContextMenu = (event) => {
      if (editorLocked) return
      if (event.shiftKey) return
      if (isTouchContextMenuEvent(event)) return
      event.preventDefault()
      focusFromCoords({ left: event.clientX, top: event.clientY })
      const inTable = Boolean(getCellFromEvent(event))
      const blockId = getActiveBlockId()
      openContextMenu({ x: event.clientX, y: event.clientY, blockId, inTable })
    }

    dom.addEventListener('contextmenu', handleContextMenu)
    return () => { dom.removeEventListener('contextmenu', handleContextMenu) }
  }, [editor, editorLocked, focusFromCoords, getActiveBlockId, getCellFromEvent, openContextMenu])

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
  }, [contextMenu.open, contextMenu.x, contextMenu.y, setContextMenu])

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
  }, [submenuOpen, setSubmenuDirection])

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (contextMenu.open) {
        const menu = contextMenuRef.current
        if (menu?.contains(event.target)) return
        closeContextMenu()
      }
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        if (!aiInsertLoading) {
          setAiInsertOpen(false)
        }
        closeContextMenu()
      }
    }

    document.addEventListener('mousedown', handleOutsideClick)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [contextMenu.open, aiInsertLoading, closeContextMenu, setAiInsertOpen])

  const getActiveCellColor = useCallback(() => {
    if (!editor) return null
    return editor.getAttributes('tableCell')?.backgroundColor ?? editor.getAttributes('tableHeader')?.backgroundColor ?? null
  }, [editor])

  const getTableContext = useCallback(() => {
    if (!editor) return null
    const { state } = editor
    const { $from } = state.selection
    let tableDepth = null
    let cellDepth = null
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      const nodeName = $from.node(depth).type.name
      if (cellDepth === null && (nodeName === 'tableCell' || nodeName === 'tableHeader')) {
        cellDepth = depth
      }
      if (nodeName === 'table') {
        tableDepth = depth
        break
      }
    }
    if (tableDepth === null || cellDepth === null) return null
    const tableNode = $from.node(tableDepth)
    const tablePos = $from.before(tableDepth)
    const tableStart = $from.start(tableDepth)
    const cellPos = $from.before(cellDepth)
    const map = TableMap.get(tableNode)
    const cellPosRel = cellPos - tableStart
    const cellRect = map.findCell(cellPosRel)
    return { tablePos, cellRect }
  }, [editor])

  const applyColorToRow = useCallback(
    (tablePos, rowIndex, color) => {
      if (!editor) return
      const { state, view } = editor
      const tableNode = state.doc.nodeAt(tablePos)
      if (!tableNode) return
      const map = TableMap.get(tableNode)
      if (rowIndex < 0 || rowIndex >= map.height) return
      const tableStart = tablePos + 1
      const tr = state.tr
      const seen = new Set()
      for (let col = 0; col < map.width; col += 1) {
        const cellPos = map.map[rowIndex * map.width + col]
        if (cellPos == null || seen.has(cellPos)) continue
        seen.add(cellPos)
        const cell = tableNode.nodeAt(cellPos)
        if (!cell) continue
        tr.setNodeMarkup(tableStart + cellPos, undefined, { ...cell.attrs, backgroundColor: color })
      }
      if (tr.docChanged) view.dispatch(tr)
    },
    [editor],
  )

  const applyColorToColumn = useCallback(
    (tablePos, colIndex, color) => {
      if (!editor) return
      const { state, view } = editor
      const tableNode = state.doc.nodeAt(tablePos)
      if (!tableNode) return
      const map = TableMap.get(tableNode)
      if (colIndex < 0 || colIndex >= map.width) return
      const tableStart = tablePos + 1
      const tr = state.tr
      const seen = new Set()
      for (let row = 0; row < map.height; row += 1) {
        const cellPos = map.map[row * map.width + colIndex]
        if (cellPos == null || seen.has(cellPos)) continue
        seen.add(cellPos)
        const cell = tableNode.nodeAt(cellPos)
        if (!cell) continue
        tr.setNodeMarkup(tableStart + cellPos, undefined, { ...cell.attrs, backgroundColor: color })
      }
      if (tr.docChanged) view.dispatch(tr)
    },
    [editor],
  )

  const handleInsertRow = useCallback(
    (after) => {
      if (!editor) return
      const color = getActiveCellColor()
      const tableContext = getTableContext()
      const rowIndex = tableContext ? (after ? tableContext.cellRect.bottom : tableContext.cellRect.top) : null
      if (after) {
        editorCmd()?.addRowAfter().run()
      } else {
        editorCmd()?.addRowBefore().run()
      }
      if (color && tableContext && rowIndex !== null) {
        applyColorToRow(tableContext.tablePos, rowIndex, color)
      }
    },
    [editor, editorCmd, getActiveCellColor, getTableContext, applyColorToRow],
  )

  const handleInsertColumn = useCallback(
    (after) => {
      if (!editor) return
      const color = getActiveCellColor()
      const tableContext = getTableContext()
      const colIndex = tableContext ? (after ? tableContext.cellRect.right : tableContext.cellRect.left) : null
      if (after) {
        editorCmd()?.addColumnAfter().run()
      } else {
        editorCmd()?.addColumnBefore().run()
      }
      if (color && tableContext && colIndex !== null) {
        applyColorToColumn(tableContext.tablePos, colIndex, color)
      }
    },
    [editor, editorCmd, getActiveCellColor, getTableContext, applyColorToColumn],
  )

  const contextMenuItems = useMemo(
    () => [
      { label: 'Insert row above', action: () => handleInsertRow(false) },
      { label: 'Insert row below', action: () => handleInsertRow(true) },
      { label: 'Insert column left', action: () => handleInsertColumn(false) },
      { label: 'Insert column right', action: () => handleInsertColumn(true) },
      { label: 'Delete row', action: () => editorCmd()?.deleteRow().run() },
      { label: 'Delete column', action: () => editorCmd()?.deleteColumn().run() },
      { label: 'Delete table', action: () => editorCmd()?.deleteTable().run() },
    ],
    [editorCmd, handleInsertRow, handleInsertColumn],
  )

  const deepLinkHash = useMemo(() => {
    if (!contextMenu.blockId || !trackerId || !notebookId || !sectionId) return null
    return buildHash({ notebookId, sectionId, pageId: trackerId, blockId: contextMenu.blockId })
  }, [contextMenu.blockId, trackerId, notebookId, sectionId])

  const toolbarDeepLinkHash = useMemo(() => {
    if (!currentBlockId || !trackerId || !notebookId || !sectionId) return null
    return buildHash({ notebookId, sectionId, pageId: trackerId, blockId: currentBlockId })
  }, [currentBlockId, trackerId, notebookId, sectionId])

  const isCurrentPageTracker = Boolean(trackerId && trackerSourcePage?.id === trackerId)

  const handleCopyLink = async () => {
    if (!deepLinkHash) return
    await navigator.clipboard.writeText(deepLinkHash)
    closeContextMenu()
  }

  const handleSetTrackerPageFromMenu = async () => {
    if (!trackerId || !onSetTrackerPage || isCurrentPageTracker || trackerPageSaving) return
    await onSetTrackerPage(trackerId)
    closeContextMenu()
  }

  const handleSetTrackerFromToolbar = async () => {
    if (!trackerId || !onSetTrackerPage || isCurrentPageTracker || trackerPageSaving) return
    await onSetTrackerPage(trackerId)
  }

  // Sync editor selection state → store
  useEffect(() => {
    if (!editor) return
    const syncEditorState = () => {
      const nextInTable =
        editor.isActive('table') || editor.isActive('tableCell') || editor.isActive('tableHeader')
      setInTable(nextInTable)

      const blockId = getActiveBlockId()
      setCurrentBlockId(blockId)

      if (!nextInTable) return
      const headerColor = editor.getAttributes('tableHeader')?.backgroundColor
      const cellColor = editor.getAttributes('tableCell')?.backgroundColor
      setShadingColor(headerColor || cellColor || null)
    }
    syncEditorState()
    editor.on('selectionUpdate', syncEditorState)
    editor.on('transaction', syncEditorState)
    return () => {
      editor.off('selectionUpdate', syncEditorState)
      editor.off('transaction', syncEditorState)
    }
  }, [editor, getActiveBlockId, setInTable, setCurrentBlockId, setShadingColor])

  // Sync highlight color from editor selection → store
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
  }, [editor, setHighlightColor])

  useEffect(() => {
    if (!editor) return
    editor.storage.highlightColor = highlightColor ?? null
  }, [editor, highlightColor])

  // Reset state on tracker/page change, and pre-focus the editor so that
  // DOM-manipulation-based cursor placement in tests (and user interactions
  // that call editorRoot.focus()) doesn't trigger ProseMirror's focus handler
  // to restore its saved selection before the placement takes effect.
  useEffect(() => {
    resetOnTrackerChange()
    if (!editor || editorLocked) return
    requestAnimationFrame(() => {
      editor.chain().focus().run()
    })
  }, [trackerId, editor, editorLocked, resetOnTrackerChange])

  useEffect(() => {
    if (!editor) return
    if (typeof onNavigateHash === 'function') {
      // no-op: handled by Link extension plugin
    }
  }, [editor, onNavigateHash])

  const hasHeaderActions = Boolean(headerActions) || showDelete
  const controlsDisabled = !hasTracker || editorLocked

  return (
    <section
      className="editor-panel"
      ref={editorPanelRef}
    >
      <EditorHeader
        title={title}
        onTitleChange={onTitleChange}
        onDelete={onDelete}
        saveStatus={saveStatus}
        hasTracker={hasTracker}
        message={message}
        titleReadOnly={titleReadOnly}
        editorLocked={editorLocked}
        controlsDisabled={controlsDisabled}
        hasHeaderActions={hasHeaderActions}
        headerActions={headerActions}
        showDelete={showDelete}
      />

      <Toolbar
        editor={editor}
        controlsDisabled={controlsDisabled}
        hasTracker={hasTracker}
        isTouchOnly={isTouchOnly}
        toolbarRef={toolbarRef}
        editorPanelRef={editorPanelRef}
        onImageUpload={onImageUpload}
        onAiDailyGenerate={handleGenerateToday}
        showAiDaily={showAiDaily}
        showAiInsert={showAiInsert}
        title={title}
        toolbarDeepLinkHash={toolbarDeepLinkHash}
        isCurrentPageTracker={isCurrentPageTracker}
        trackerPageSaving={trackerPageSaving}
        onSetTrackerPage={onSetTrackerPage}
        handleSetTrackerFromToolbar={handleSetTrackerFromToolbar}
        contextMenuItems={contextMenuItems}
      />

      <AiInsertModal
        inputRef={aiInsertInputRef}
        open={aiInsertOpen}
        loading={aiInsertLoading}
        text={aiInsertText}
        hasTracker={hasTracker}
        onTextChange={setAiInsertText}
        onClose={() => setAiInsertOpen(false)}
        onSubmit={handleAiInsertSubmit}
      />

      {editorLocked && hasTracker ? (
        <div className="editor-loading-skeleton" aria-hidden="true" />
      ) : (
        <EditorShell ref={editorShellRef} hasTracker={hasTracker} editor={editor} />
      )}

      {isZoomSupported && zoomLevel !== 1.0 && (
        <button
          ref={zoomBadgeRef}
          type="button"
          className={`zoom-badge${gestureRecent ? ' zoom-badge--active' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onTouchStart={(e) => e.preventDefault()}
          onClick={resetZoom}
          aria-label={`Zoom ${Math.round(zoomLevel * 100)}%. Tap to reset.`}
        >
          {Math.round(zoomLevel * 100)}%
        </button>
      )}

      {showHint && (
        <div ref={zoomHintRef} className="zoom-hint" onClick={dismissHint}>
          Pinch to zoom. Tap badge to reset.
        </div>
      )}

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
          <button
            type="button"
            className={`table-context-item ${isCurrentPageTracker || trackerPageSaving ? 'disabled' : ''}`}
            onClick={handleSetTrackerPageFromMenu}
            disabled={!hasTracker || isCurrentPageTracker || trackerPageSaving || !onSetTrackerPage}
          >
            {isCurrentPageTracker ? 'This page is the tracker page' : trackerPageSaving ? 'Setting tracker page...' : 'Set this page as tracker'}
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
