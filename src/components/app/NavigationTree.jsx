import { useCallback, useEffect, useRef, useState } from 'react'
import { generateJSON } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { DndContext, DragOverlay, closestCenter } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { supabase } from '../../lib/supabase'
import { resizeAndEncode } from '../../utils/imageResize'
import PasteRecipeModal from '../editor/PasteRecipeModal'
import SortableTreeRow from './SortableTreeRow'
import { SECTION_PAGE_STATUS, getSectionPageEntry } from '../../utils/sectionPages'
import { useLocalStorageState } from '../../hooks/useLocalStorageState'
import { useSidebarDnd } from '../../hooks/useSidebarDnd'

function NavigationTree({
  className = '',
  notebooks,
  sections,
  sectionPageCache = {},
  activeNotebookId,
  activeSectionId,
  activeTrackerId,
  userId,
  loading,
  compactBadges = false,
  isRecipesNotebook = false,
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
  const [pasteRecipeOpen, setPasteRecipeOpen] = useState(false)
  const [pasteRecipeText, setPasteRecipeText] = useState('')
  const [pasteRecipeLoading, setPasteRecipeLoading] = useState(false)
  const [pasteRecipeFiles, setPasteRecipeFiles] = useState([])

  const activeNotebook = notebooks.find((notebook) => notebook.id === activeNotebookId) ?? null
  const treeClassName = ['nav-tree-container', className].filter(Boolean).join(' ')

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
          <div className="nav-tree-scroll" role="tree" aria-label="Notebook navigation">
            <SortableContext
              items={notebooks.map((notebook) => notebook.id)}
              strategy={verticalListSortingStrategy}
            >
              {notebooks.map((notebook) => {
                const notebookActive = notebook.id === activeNotebookId
                const notebookExpanded = expandedNotebooks.has(notebook.id)
                const notebookSections = sections.filter((s) => s.notebook_id === notebook.id)

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
                        {notebookSections.length === 0 ? (
                          <p className="subtle tree-empty">No sections yet.</p>
                        ) : (
                          <SortableContext
                            items={notebookSections.map((section) => section.id)}
                            strategy={verticalListSortingStrategy}
                          >
                            {notebookSections.map((section) => {
                              const sectionActive = section.id === activeSectionId
                              const sectionExpanded = expandedSections.has(section.id)
                              const sectionPageEntry = getSectionPageEntry(sectionPageCache, section.id)
                              const sectionPages = sectionPageEntry.pages
                              const pagesLoading =
                                (sectionActive && loading && sectionPageEntry.status !== SECTION_PAGE_STATUS.LOADED) ||
                                sectionPageEntry.status === SECTION_PAGE_STATUS.LOADING
                              const showPageSkeleton = pagesLoading && sectionPages.length === 0
                              const showEmptyPages =
                                sectionPageEntry.status === SECTION_PAGE_STATUS.LOADED &&
                                sectionPages.length === 0

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
                                        <p className="subtle tree-empty">No pages yet.</p>
                                      ) : (
                                        <SortableContext
                                          items={sectionPages.map((tracker) => tracker.id)}
                                          strategy={verticalListSortingStrategy}
                                        >
                                          {sectionPages.map((tracker) => (
                                            <SortableTreeRow
                                              key={tracker.id}
                                              id={tracker.id}
                                              className="tree-page-row"
                                              data={{ type: 'page', parentId: section.id, label: tracker.title }}
                                              handleLabel={`Reorder page ${tracker.title}`}
                                              onKeyboardMove={(direction) =>
                                                onKeyboardMove(
                                                  tracker.id,
                                                  { type: 'page', parentId: section.id },
                                                  direction,
                                                )
                                              }
                                            >
                                              <button
                                                type="button"
                                                role="treeitem"
                                                aria-current={tracker.id === activeTrackerId ? 'page' : undefined}
                                                className={`tree-node tree-node-page ${
                                                  tracker.id === activeTrackerId ? 'active' : ''
                                                }`}
                                                onClick={() => onSelectPage?.({
                                                  notebookId: section.notebook_id,
                                                  sectionId: section.id,
                                                  pageId: tracker.id,
                                                })}
                                                onContextMenu={handleOpenContextMenu('page', tracker)}
                                                onTouchStart={handleTouchStart('page', tracker)}
                                                onTouchEnd={cancelLongPress}
                                                onTouchMove={cancelLongPress}
                                              >
                                                <span className="tree-page-marker" aria-hidden="true" />
                                                <span className="tree-label sidebar-title">{tracker.title}</span>
                                                {tracker.is_tracker_page ? (
                                                  <span
                                                    className={`tracker-page-badge ${compactBadges ? 'compact' : ''}`}
                                                    title="Tracker page for AI Daily"
                                                    aria-label="Tracker page for AI Daily"
                                                  >
                                                    {compactBadges ? 'T' : 'TRACKER'}
                                                  </span>
                                                ) : null}
                                              </button>
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
          {isRecipesNotebook ? (
            <button
              type="button"
              className="ghost tree-footer-button"
              onClick={() => setPasteRecipeOpen(true)}
              disabled={!activeSectionId || pasteRecipeLoading}
            >
              {pasteRecipeLoading ? 'Pasting…' : 'Paste Recipe'}
            </button>
          ) : null}
          <button
            type="button"
            className="secondary tree-footer-button tree-footer-button-primary"
            onClick={onCreatePage}
            disabled={!activeSectionId || loading}
          >
            + New page
          </button>
        </div>
      </div>

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
