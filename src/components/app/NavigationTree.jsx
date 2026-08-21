import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { generateJSON } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { DndContext, DragOverlay, closestCenter } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { supabase } from '../../lib/supabase'
import { resizeAndEncode } from '../../utils/imageResize'
import PasteRecipeModal from '../editor/PasteRecipeModal'
import NewLibraryThingModal from './NewLibraryThingModal'
import SortableTreeRow from './SortableTreeRow'
import TreePageRow from './TreePageRow'
import { buildLibraryTreeShapes } from '../../utils/libraryTree'
import {
  SECTION_PAGE_STATUS,
  getSectionPageEntry,
  getVisibleSectionPages,
} from '../../utils/sectionPages'
import { useLocalStorageState } from '../../hooks/useLocalStorageState'
import { useSidebarDnd } from '../../hooks/useSidebarDnd'

function NavigationTree({
  className = '',
  notebooks,
  sections,
  sectionsLoaded = false,
  sectionPageCache = {},
  activeNotebookId,
  activeSectionId,
  activePageId,
  userId,
  loading,
  compactBadges = false,
  activeNotebookType = 'tracker',
  isMobileViewport = false,
  mobileSidebarOpen = false,
  session,
  onSelectNotebook,
  onSelectSection,
  onSelectPage,
  onCreateNotebook,
  onCreateSection,
  onCreatePage,
  onReorderNotebooks,
  onReorderSections,
  onReorderPages,
  onOpenContextMenu,
  onLoadSectionPages,
  onCreateWithContent,
  onCreateLibraryThing,
}) {
  const {
    sensors,
    activeItem,
    onDragStart,
    onDragOver,
    onDragEnd,
    onDragCancel,
    onKeyboardMove,
  } = useSidebarDnd({
    notebooks,
    sections,
    sectionPageCache,
    onReorderNotebooks,
    onReorderSections,
    onReorderPages,
  })
  const [expandedNotebooksRaw, setExpandedNotebooks] = useLocalStorageState(
    `nav-tree-expanded:notebooks:${userId ?? 'anon'}`,
    activeNotebookId ? [activeNotebookId] : [],
  )
  const [expandedSectionsRaw, setExpandedSections] = useLocalStorageState(
    `nav-tree-expanded:sections:${userId ?? 'anon'}`,
    activeSectionId ? [activeSectionId] : [],
  )
  // Convert arrays (from JSON storage) to Sets for O(1) lookups
  const expandedNotebooks = expandedNotebooksRaw instanceof Set
    ? expandedNotebooksRaw
    : new Set(Array.isArray(expandedNotebooksRaw) ? expandedNotebooksRaw : [])
  const expandedSections = expandedSectionsRaw instanceof Set
    ? expandedSectionsRaw
    : new Set(Array.isArray(expandedSectionsRaw) ? expandedSectionsRaw : [])
  const [newTopicOpen, setNewTopicOpen] = useState(false)
  const [newTopicBusy, setNewTopicBusy] = useState(false)
  const [pasteRecipeOpen, setPasteRecipeOpen] = useState(false)
  const [pasteRecipeText, setPasteRecipeText] = useState('')
  const [pasteRecipeLoading, setPasteRecipeLoading] = useState(false)
  const [pasteRecipeFiles, setPasteRecipeFiles] = useState([])

  const activeNotebook = notebooks.find((notebook) => notebook.id === activeNotebookId) ?? null
  const treeClassName = ['nav-tree-container', className].filter(Boolean).join(' ')
  const navScrollRef = useRef(null)

  // Where a Library notebook's Lately/Activity rows go, and which of its
  // sections are real. Derived from cached page metadata, so it is recomputed
  // whenever that cache changes and never guessed from titles.
  const libraryTreeShapes = useMemo(
    () => buildLibraryTreeShapes(notebooks, sections, sectionPageCache),
    [notebooks, sections, sectionPageCache],
  )

  // The footer's "+ New topic" needs one of the user's own sections to put a
  // topic in. The home section is the model's own scaffolding and its row is
  // suppressed, so a topic created there would be unreachable.
  const isLibrary = activeNotebookType === 'library'
  const canCreateTopic =
    isLibrary &&
    Boolean(activeSectionId) &&
    activeSectionId !== libraryTreeShapes[activeNotebookId]?.homeSectionId

  // Load every section's page metadata for an expanded Library, without waiting
  // for the user to expand each section.
  //
  // REQUIRED, not an optimization. Lately and Activity are hoisted OUT of the
  // section they live in, so nothing would ever expand that section — and
  // without this they would simply never appear. loadSectionPagesMeta already
  // no-ops on a loaded or in-flight section, so this is idempotent.
  useEffect(() => {
    if (!onLoadSectionPages) return
    const expanded = expandedNotebooksRaw instanceof Set
      ? expandedNotebooksRaw
      : new Set(Array.isArray(expandedNotebooksRaw) ? expandedNotebooksRaw : [])
    const libraryIds = new Set(
      notebooks
        .filter((notebook) => notebook.type === 'library' && expanded.has(notebook.id))
        .map((notebook) => notebook.id),
    )
    if (!libraryIds.size) return
    for (const section of sections) {
      if (libraryIds.has(section.notebook_id)) onLoadSectionPages(section.id)
    }
  }, [notebooks, sections, expandedNotebooksRaw, onLoadSectionPages])

  // Auto-reveal the active item: scroll the highlighted (most specific) row into
  // view inside the tree's own scroll container when the active id changes (deep
  // links, browser back, boot restore, post-delete). `block: 'nearest'` keeps it
  // from scrolling the page body / shifting the editor.
  useEffect(() => {
    // Don't scroll mid-drag — it would fight the @dnd-kit transform.
    if (activeItem) return undefined
    // On mobile the sidebar is an off-canvas drawer; scrolling while it's hidden
    // is a no-op or janky, so wait until it's open and past the slide-in.
    if (isMobileViewport && !mobileSidebarOpen) return undefined
    const container = navScrollRef.current
    if (!container) return undefined

    const reveal = () => {
      const activeNodes = container.querySelectorAll('.tree-node.active')
      const target = activeNodes[activeNodes.length - 1]
      if (target && typeof target.scrollIntoView === 'function') {
        target.scrollIntoView({ block: 'nearest' })
      }
    }

    let rafId = null
    const delay = isMobileViewport ? 320 : 0
    const timer = setTimeout(() => {
      rafId = requestAnimationFrame(reveal)
    }, delay)
    return () => {
      clearTimeout(timer)
      if (rafId) cancelAnimationFrame(rafId)
    }
  }, [activeNotebookId, activeSectionId, activePageId, activeItem, isMobileViewport, mobileSidebarOpen])

  // Prune persisted expansion state when notebooks/sections are deleted so stale
  // ids don't accumulate in localStorage.
  useEffect(() => {
    const validIds = new Set(notebooks.map((n) => n.id))
    setExpandedNotebooks((prev) => {
      const prevSet = prev instanceof Set ? prev : new Set(Array.isArray(prev) ? prev : [])
      const next = [...prevSet].filter((id) => validIds.has(id))
      return next.length === prevSet.size ? prev : next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setter is stable; prune only when notebook set changes
  }, [notebooks])

  useEffect(() => {
    // During boot, `sections` is temporarily empty while its query is in
    // flight. Pruning then would erase valid expansion state before the full
    // section set arrives, which is especially visible on slower mobile loads.
    if (!sectionsLoaded) return
    const validIds = new Set(sections.map((s) => s.id))
    setExpandedSections((prev) => {
      const prevSet = prev instanceof Set ? prev : new Set(Array.isArray(prev) ? prev : [])
      const next = [...prevSet].filter((id) => validIds.has(id))
      return next.length === prevSet.size ? prev : next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setter is stable; prune when section data becomes ready or changes
  }, [sections, sectionsLoaded])

  const toggleNotebook = (id) => {
    setExpandedNotebooks((prev) => {
      const prevSet = prev instanceof Set ? prev : new Set(Array.isArray(prev) ? prev : [])
      const next = new Set(prevSet)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return [...next]
    })
  }

  const toggleSection = (id) => {
    setExpandedSections((prev) => {
      const prevSet = prev instanceof Set ? prev : new Set(Array.isArray(prev) ? prev : [])
      const next = new Set(prevSet)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
        onLoadSectionPages?.(id)
      }
      return [...next]
    })
  }

  const handleSelectNotebook = (id) => {
    setExpandedNotebooks((prev) => {
      const prevSet = prev instanceof Set ? prev : new Set(Array.isArray(prev) ? prev : [])
      return [...new Set(prevSet).add(id)]
    })
    onSelectNotebook?.(id)
  }

  const handleSelectSection = (section) => {
    setExpandedSections((prev) => {
      const prevSet = prev instanceof Set ? prev : new Set(Array.isArray(prev) ? prev : [])
      return [...new Set(prevSet).add(section.id)]
    })
    onLoadSectionPages?.(section.id)
    onSelectSection?.({
      notebookId: section.notebook_id,
      sectionId: section.id,
    })
  }

  // Auto-expand when active IDs change from parent (deep links, URL navigation)
  useEffect(() => {
    if (activeNotebookId) {
      setExpandedNotebooks((prev) => {
        const prevSet = prev instanceof Set ? prev : new Set(Array.isArray(prev) ? prev : [])
        if (prevSet.has(activeNotebookId)) return prev
        return [...new Set(prevSet).add(activeNotebookId)]
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally fires only when activeNotebookId changes; setter is stable
  }, [activeNotebookId])

  useEffect(() => {
    if (activeSectionId) {
      setExpandedSections((prev) => {
        const prevSet = prev instanceof Set ? prev : new Set(Array.isArray(prev) ? prev : [])
        if (prevSet.has(activeSectionId)) return prev
        return [...new Set(prevSet).add(activeSectionId)]
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally fires only when activeSectionId changes; setter is stable
  }, [activeSectionId])

  const handleOpenContextMenu = (type, item) => (event) => {
    event.preventDefault()
    event.stopPropagation()
    onOpenContextMenu?.(event, type, item)
  }

  const longPressTimerRef = useRef(null)

  const handleTouchStart = useCallback(
    (type, item) => (event) => {
      const touch = event.touches[0]
      if (!touch) return
      const x = touch.clientX
      const y = touch.clientY
      longPressTimerRef.current = setTimeout(() => {
        longPressTimerRef.current = null
        onOpenContextMenu?.({ preventDefault() {}, clientX: x, clientY: y }, type, item)
      }, 500)
    },
    [onOpenContextMenu],
  )

  const cancelLongPress = useCallback(() => {
    if (longPressTimerRef.current != null) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }, [])

  /**
   * A Lately/Activity row, hoisted to notebook level.
   *
   * Deliberately NOT a SortableTreeRow with `disabled`. That still renders a
   * focusable "Reorder page Lately" handle — a control that says it does
   * something and does nothing — and still registers a droppable that other
   * rows can collide with. A plain wrapper plus a spacer keeps the row aligned
   * with the section rows beside it and lies about nothing.
   */
  const renderHoistedRow = (page, notebook) => (
    <div key={page.id} className="tree-sortable-row tree-page-row tree-page-row-hoisted">
      <span className="tree-drag-handle-spacer" aria-hidden="true" />
      <TreePageRow
        page={page}
        sectionId={page.sectionId ?? page.section_id}
        notebookId={notebook.id}
        isActive={page.id === activePageId}
        compactBadges={compactBadges}
        onSelect={onSelectPage}
        onContextMenu={handleOpenContextMenu('page', page)}
        onTouchStart={handleTouchStart('page', page)}
        onTouchEnd={cancelLongPress}
        onTouchMove={cancelLongPress}
      />
    </div>
  )

  const closePasteRecipeModal = () => {
    setPasteRecipeOpen(false)
    setPasteRecipeText('')
    pasteRecipeFiles.forEach((file) => URL.revokeObjectURL(file.previewUrl))
    setPasteRecipeFiles([])
  }

  const handlePasteRecipeSubmit = async () => {
    if (!session || !activeSectionId || pasteRecipeLoading) return
    const text = pasteRecipeText.trim()
    if (!text && pasteRecipeFiles.length === 0) return

    const createWithContent = onCreateWithContent

    setPasteRecipeLoading(true)
    try {
      const provider = localStorage.getItem('ai-provider') || 'anthropic'
      const model = localStorage.getItem('ai-model') || 'claude-sonnet-4-6'

      const {
        data: { session: currentSession },
      } = await supabase.auth.getSession()
      if (!currentSession) throw new Error('You must be logged in')

      const images = []
      for (const entry of pasteRecipeFiles) {
        try {
          const result = await resizeAndEncode(entry.file)
          images.push({ base64: result.base64, mediaType: result.mediaType })
        } catch (error) {
          console.error('Image resize failed:', error)
        }
      }

      if (images.length === 0 && pasteRecipeFiles.length > 0 && !text) {
        throw new Error('All images failed to process. Try different photos.')
      }

      const totalSize = images.reduce((sum, image) => sum + image.base64.length, 0)
      if (totalSize > 1_500_000) {
        throw new Error('Total image size too large. Try fewer or smaller photos.')
      }

      const { data, error } = await supabase.functions.invoke('ai-paste-recipe', {
        body: { provider, model, text: text || '', images },
        headers: { Authorization: `Bearer ${currentSession.access_token}` },
      })

      if (error) throw error
      if (data?.error) throw new Error(data.error)

      const html = markdownToHtml(data.markdown)
      const content = generateJSON(html, [StarterKit])
      const result = await createWithContent?.(data.title || 'Untitled Recipe', content)
      if (!result) throw new Error('Failed to save recipe page')

      closePasteRecipeModal()
    } catch (error) {
      console.error('Paste recipe failed:', error)
      window.alert(`Failed to create recipe: ${error.message || String(error)}`)
    } finally {
      setPasteRecipeLoading(false)
    }
  }

  return (
    <aside className={treeClassName}>
      <div className="nav-tree">
        <div className="nav-tree-header">
          <div>
            <p className="nav-tree-kicker">Workspace</p>
            <h2>Navigation</h2>
          </div>
          <button type="button" className="ghost tree-add-button" onClick={onCreateNotebook}>
            + Notebook
          </button>
        </div>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
          onDragCancel={onDragCancel}
        >
          <div ref={navScrollRef} className="nav-tree-scroll" role="tree" aria-label="Notebook navigation">
            <SortableContext
              items={notebooks.map((notebook) => notebook.id)}
              strategy={verticalListSortingStrategy}
            >
              {notebooks.map((notebook) => {
                const notebookActive = notebook.id === activeNotebookId
                const notebookExpanded = expandedNotebooks.has(notebook.id)
                // For a Library, the home section is dropped here and its two
                // pages are rendered as siblings of this list instead.
                const libraryShape = libraryTreeShapes[notebook.id] ?? null
                const notebookSections =
                  libraryShape?.sections ?? sections.filter((s) => s.notebook_id === notebook.id)
                const hoistedRows = Boolean(libraryShape?.lately || libraryShape?.activity)

                return (
                  <div key={notebook.id} className="tree-branch">
                    <SortableTreeRow
                      id={notebook.id}
                      data={{ type: 'notebook', parentId: null, label: notebook.title }}
                      handleLabel={`Reorder notebook ${notebook.title}`}
                      onKeyboardMove={(direction) =>
                        onKeyboardMove(notebook.id, { type: 'notebook', parentId: null }, direction)
                      }
                    >
                      <button
                        type="button"
                        role="treeitem"
                        aria-expanded={notebookExpanded}
                        aria-current={notebookActive ? 'page' : undefined}
                        className={`tree-node tree-node-notebook ${notebookActive ? 'active' : ''}`}
                        onClick={() => handleSelectNotebook(notebook.id)}
                        onContextMenu={handleOpenContextMenu('notebook', notebook)}
                        onTouchStart={handleTouchStart('notebook', notebook)}
                        onTouchEnd={cancelLongPress}
                        onTouchMove={cancelLongPress}
                      >
                        <span
                          className={`tree-chevron ${notebookExpanded ? 'expanded' : ''}`}
                          onClick={(e) => { e.stopPropagation(); toggleNotebook(notebook.id) }}
                          role="button"
                          aria-label={notebookExpanded ? 'Collapse notebook' : 'Expand notebook'}
                        >
                          <ChevronIcon />
                        </span>
                        <span className="tree-label sidebar-title">{notebook.title}</span>
                      </button>
                    </SortableTreeRow>

                    {notebookExpanded ? (
                      <div className="tree-children tree-children-sections" role="group">
                        {libraryShape?.lately ? renderHoistedRow(libraryShape.lately, notebook) : null}
                        {notebookSections.length === 0 && !hoistedRows ? (
                          <p className="subtle tree-empty">No sections yet.</p>
                        ) : notebookSections.length === 0 ? null : (
                          <SortableContext
                            items={notebookSections.map((section) => section.id)}
                            strategy={verticalListSortingStrategy}
                          >
                            {notebookSections.map((section) => {
                              const sectionActive = section.id === activeSectionId
                              const sectionExpanded = expandedSections.has(section.id)
                              const sectionPageEntry = getSectionPageEntry(sectionPageCache, section.id)
                              // Captures, front pages, Lately and Activity are all absent
                              // as child rows — see HIDDEN_TREE_ROLES. Filtering HERE (not
                              // in the cache accessor) keeps render, the empty state, and
                              // the SortableContext id list all reading one list, so a row
                              // never appears without a handle or the other way round.
                              const sectionPages = getVisibleSectionPages(sectionPageCache, section.id)
                              const pagesLoading =
                                (sectionActive && loading && sectionPageEntry.status !== SECTION_PAGE_STATUS.LOADED) ||
                                sectionPageEntry.status === SECTION_PAGE_STATUS.LOADING
                              const showPageSkeleton = pagesLoading && sectionPages.length === 0
                              const showEmptyPages =
                                sectionPageEntry.status === SECTION_PAGE_STATUS.LOADED &&
                                sectionPages.length === 0
                              // A DELIBERATE exception to "nothing is a queue".
                              // With captures hidden from the tree, a Library
                              // section otherwise gives no sign it holds
                              // anything at all. Muted, mono, not actionable —
                              // context, not a badge and not a backlog.
                              const captureCount = libraryShape
                                ? sectionPageEntry.pages.filter(
                                    (page) => page.libraryRole === 'capture',
                                  ).length
                                : 0

                              return (
                                <div key={section.id} className="tree-branch">
                                  <SortableTreeRow
                                    id={section.id}
                                    data={{ type: 'section', parentId: section.notebook_id, label: section.title }}
                                    handleLabel={`Reorder section ${section.title}`}
                                    onKeyboardMove={(direction) =>
                                      onKeyboardMove(
                                        section.id,
                                        { type: 'section', parentId: section.notebook_id },
                                        direction,
                                      )
                                    }
                                  >
                                    <button
                                      type="button"
                                      role="treeitem"
                                      aria-expanded={sectionExpanded}
                                      aria-current={sectionActive ? 'page' : undefined}
                                      className={`tree-node tree-node-section ${sectionActive ? 'active' : ''}`}
                                      onClick={() => handleSelectSection(section)}
                                      onContextMenu={handleOpenContextMenu('section', section)}
                                      onTouchStart={handleTouchStart('section', section)}
                                      onTouchEnd={cancelLongPress}
                                      onTouchMove={cancelLongPress}
                                    >
                                      <span
                                        className={`tree-chevron ${sectionExpanded ? 'expanded' : ''}`}
                                        onClick={(e) => { e.stopPropagation(); toggleSection(section.id) }}
                                        role="button"
                                        aria-label={sectionExpanded ? 'Collapse section' : 'Expand section'}
                                      >
                                        <ChevronIcon />
                                      </span>
                                      <span
                                        className="tree-section-color"
                                        style={{ backgroundColor: section.color || '#F5F5F4' }}
                                        aria-hidden="true"
                                      />
                                      <span className="tree-label sidebar-title">{section.title}</span>
                                      {captureCount > 0 ? (
                                        <span
                                          className="tree-section-count"
                                          aria-label={`${captureCount} saved`}
                                        >
                                          {captureCount}
                                        </span>
                                      ) : null}
                                    </button>
                                  </SortableTreeRow>

                                  {sectionExpanded ? (
                                    <div className="tree-children tree-children-pages" role="group">
                                      {showPageSkeleton ? (
                                        <div
                                          className="tree-page-skeleton"
                                          role="status"
                                          aria-label="Loading pages"
                                        >
                                          <span />
                                          <span />
                                        </div>
                                      ) : showEmptyPages ? (
                                        // "No pages yet" would contradict the
                                        // capture count beside the section
                                        // title. A Library section with nothing
                                        // but captures in it has no topics —
                                        // which is a normal resting state, not
                                        // an empty one.
                                        <p className="subtle tree-empty">
                                          {libraryShape
                                            ? captureCount > 0
                                              ? 'No topics yet.'
                                              : 'Nothing saved here yet.'
                                            : 'No pages yet.'}
                                        </p>
                                      ) : (
                                        <SortableContext
                                          items={sectionPages.map((page) => page.id)}
                                          strategy={verticalListSortingStrategy}
                                        >
                                          {sectionPages.map((page) => (
                                            <SortableTreeRow
                                              key={page.id}
                                              id={page.id}
                                              className="tree-page-row"
                                              data={{ type: 'page', parentId: section.id, label: page.title }}
                                              handleLabel={`Reorder page ${page.title}`}
                                              onKeyboardMove={(direction) =>
                                                onKeyboardMove(
                                                  page.id,
                                                  { type: 'page', parentId: section.id },
                                                  direction,
                                                )
                                              }
                                            >
                                              <TreePageRow
                                                page={page}
                                                sectionId={section.id}
                                                notebookId={section.notebook_id}
                                                isActive={page.id === activePageId}
                                                compactBadges={compactBadges}
                                                onSelect={onSelectPage}
                                                onContextMenu={handleOpenContextMenu('page', page)}
                                                onTouchStart={handleTouchStart('page', page)}
                                                onTouchEnd={cancelLongPress}
                                                onTouchMove={cancelLongPress}
                                              />
                                            </SortableTreeRow>
                                          ))}
                                        </SortableContext>
                                      )}
                                    </div>
                                  ) : null}
                                </div>
                              )
                            })}
                          </SortableContext>
                        )}
                        {libraryShape?.activity
                          ? renderHoistedRow(libraryShape.activity, notebook)
                          : null}
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </SortableContext>
          </div>

          <DragOverlay>
            {activeItem ? (
              <div className={`tree-drag-overlay tree-drag-overlay-${activeItem.type}`}>
                <span className="tree-label sidebar-title">{activeItem.label}</span>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>

        <div className="nav-tree-footer">
          {activeNotebook ? (
            <button type="button" className="ghost tree-footer-button" onClick={onCreateSection}>
              + New section
            </button>
          ) : null}
          {activeNotebookType === 'recipes' ? (
            <button
              type="button"
              className="ghost tree-footer-button"
              onClick={() => setPasteRecipeOpen(true)}
              disabled={!activeSectionId || pasteRecipeLoading}
            >
              {pasteRecipeLoading ? 'Pasting…' : 'Paste Recipe'}
            </button>
          ) : null}
          {/* In a Library this is "+ New topic", not "+ New page".
              The user still never AUTHORS a page here — every page is a capture
              the bot made or a catalog the app rewrites. But naming a topic is
              theirs to do (rule 2: topics exist only because the user made one),
              and a disabled button was the only door left after captures were
              hidden from the tree. The topic starts empty and gathers.

              It is disabled in the home section, which holds Lately and
              Activity: a topic has to live inside one of the user's own
              sections, and the home row is suppressed, so a topic put there
              would have no way back to it. */}
          {isLibrary ? (
            <button
              type="button"
              className="secondary tree-footer-button tree-footer-button-primary"
              onClick={() => setNewTopicOpen(true)}
              disabled={!canCreateTopic || loading}
              title={
                canCreateTopic
                  ? 'A topic catalogs what you save in this section'
                  : 'Open one of your sections first — a topic lives inside one'
              }
            >
              + New topic
            </button>
          ) : (
            <button
              type="button"
              className="secondary tree-footer-button tree-footer-button-primary"
              onClick={onCreatePage}
              disabled={!activeSectionId || loading}
            >
              + New page
            </button>
          )}
        </div>
      </div>

      {newTopicOpen ? (
        <NewLibraryThingModal
          scope="topic"
          busy={newTopicBusy}
          onClose={() => {
            if (!newTopicBusy) setNewTopicOpen(false)
          }}
          onSubmit={async (title) => {
            setNewTopicBusy(true)
            try {
              const created = await onCreateLibraryThing?.({
                scope: 'topic',
                sectionId: activeSectionId,
                title,
              })
              if (created) setNewTopicOpen(false)
            } finally {
              setNewTopicBusy(false)
            }
          }}
        />
      ) : null}

      <PasteRecipeModal
        open={pasteRecipeOpen}
        loading={pasteRecipeLoading}
        text={pasteRecipeText}
        onTextChange={setPasteRecipeText}
        files={pasteRecipeFiles}
        onFilesChange={setPasteRecipeFiles}
        onClose={() => {
          if (!pasteRecipeLoading) {
            closePasteRecipeModal()
          }
        }}
        onSubmit={handlePasteRecipeSubmit}
      />
    </aside>
  )
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M7 5.75 11.75 10 7 14.25"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function markdownToHtml(markdown = '') {
  const lines = markdown.split('\n')
  const html = []
  let inUl = false
  let inOl = false

  const closeList = () => {
    if (inUl) {
      html.push('</ul>')
      inUl = false
    }
    if (inOl) {
      html.push('</ol>')
      inOl = false
    }
  }

  for (const line of lines) {
    const trimmed = line.trim()

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      closeList()
      const level = headingMatch[1].length
      html.push(`<h${level}>${inlineMarkdown(escapeHtml(headingMatch[2]))}</h${level}>`)
      continue
    }

    const bulletMatch = trimmed.match(/^[-*]\s+(.+)$/)
    if (bulletMatch) {
      if (inOl) {
        html.push('</ol>')
        inOl = false
      }
      if (!inUl) {
        html.push('<ul>')
        inUl = true
      }
      html.push(`<li>${inlineMarkdown(escapeHtml(bulletMatch[1]))}</li>`)
      continue
    }

    const orderedListMatch = trimmed.match(/^\d+[.)]\s+(.+)$/)
    if (orderedListMatch) {
      if (inUl) {
        html.push('</ul>')
        inUl = false
      }
      if (!inOl) {
        html.push('<ol>')
        inOl = true
      }
      html.push(`<li>${inlineMarkdown(escapeHtml(orderedListMatch[1]))}</li>`)
      continue
    }

    if (!trimmed) {
      closeList()
      continue
    }

    closeList()
    html.push(`<p>${inlineMarkdown(escapeHtml(trimmed))}</p>`)
  }

  closeList()
  return html.join('\n')
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function inlineMarkdown(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, url) => {
      const rawUrl = url.replace(/&amp;/g, '&')
      if (/^https?:\/\//i.test(rawUrl)) {
        const safeUrl = rawUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
        return `<a href="${safeUrl}">${label}</a>`
      }
      return `${label} (${url})`
    })
}

export default NavigationTree
