import { useCallback, useRef, useState } from 'react'
import { generateJSON } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { supabase } from '../../lib/supabase'
import { resizeAndEncode } from '../../utils/imageResize'
import PasteRecipeModal from '../editor/PasteRecipeModal'

function NavigationTree({
  className = '',
  notebooks,
  sections,
  trackers,
  activeNotebookId,
  activeSectionId,
  activeTrackerId,
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
  onReorderPages,
  onOpenContextMenu,
  onCreateWithContent,
}) {
  const dragIdRef = useRef(null)
  const [overId, setOverId] = useState(null)
  const [pasteRecipeOpen, setPasteRecipeOpen] = useState(false)
  const [pasteRecipeText, setPasteRecipeText] = useState('')
  const [pasteRecipeLoading, setPasteRecipeLoading] = useState(false)
  const [pasteRecipeFiles, setPasteRecipeFiles] = useState([])

  const activeNotebook = notebooks.find((notebook) => notebook.id === activeNotebookId) ?? null
  const treeClassName = ['nav-tree-container', className].filter(Boolean).join(' ')

  const reorderList = (items, draggedId, targetId) => {
    const fromIndex = items.findIndex((item) => item.id === draggedId)
    const toIndex = items.findIndex((item) => item.id === targetId)
    if (fromIndex === -1 || toIndex === -1) return items
    const next = [...items]
    const [moved] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, moved)
    return next
  }

  const handleDragStart = (id) => (event) => {
    if (loading) return
    dragIdRef.current = id
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', id)
  }

  const handleDragOver = (id) => (event) => {
    if (loading) return
    event.preventDefault()
    if (overId !== id) setOverId(id)
    event.dataTransfer.dropEffect = 'move'
  }

  const handleDrop = (id) => (event) => {
    if (loading) return
    event.preventDefault()
    const draggedId = dragIdRef.current || event.dataTransfer.getData('text/plain')
    if (!draggedId || draggedId === id) {
      dragIdRef.current = null
      setOverId(null)
      return
    }
    const next = reorderList(trackers, draggedId, id)
    dragIdRef.current = null
    setOverId(null)
    onReorderPages?.(next)
  }

  const handleDragEnd = () => {
    dragIdRef.current = null
    setOverId(null)
  }

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
      const model = localStorage.getItem('ai-model') || 'claude-sonnet-4-20250514'

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

        <div className="nav-tree-scroll" role="tree" aria-label="Notebook navigation">
          {notebooks.map((notebook) => {
            const notebookActive = notebook.id === activeNotebookId
            const notebookExpanded = notebookActive

            return (
              <div key={notebook.id} className="tree-branch">
                <button
                  type="button"
                  role="treeitem"
                  aria-expanded={notebookExpanded}
                  className={`tree-node tree-node-notebook ${notebookActive ? 'active' : ''}`}
                  onClick={() => onSelectNotebook?.(notebook.id)}
                  onContextMenu={handleOpenContextMenu('notebook', notebook)}
                  onTouchStart={handleTouchStart('notebook', notebook)}
                  onTouchEnd={cancelLongPress}
                  onTouchMove={cancelLongPress}
                >
                  <span className={`tree-chevron ${notebookExpanded ? 'expanded' : ''}`}>
                    <ChevronIcon />
                  </span>
                  <span className="tree-label sidebar-title">{notebook.title}</span>
                </button>

                {notebookExpanded ? (
                  <div className="tree-children tree-children-sections" role="group">
                    {sections.length === 0 ? (
                      <p className="subtle tree-empty">No sections yet.</p>
                    ) : (
                      sections.map((section) => {
                        const sectionActive = section.id === activeSectionId
                        const sectionExpanded = sectionActive

                        return (
                          <div key={section.id} className="tree-branch">
                            <button
                              type="button"
                              role="treeitem"
                              aria-expanded={sectionExpanded}
                              className={`tree-node tree-node-section ${sectionActive ? 'active' : ''}`}
                              onClick={() => onSelectSection?.(section.id)}
                              onContextMenu={handleOpenContextMenu('section', section)}
                              onTouchStart={handleTouchStart('section', section)}
                              onTouchEnd={cancelLongPress}
                              onTouchMove={cancelLongPress}
                            >
                              <span className={`tree-chevron ${sectionExpanded ? 'expanded' : ''}`}>
                                <ChevronIcon />
                              </span>
                              <span
                                className="tree-section-color"
                                style={{ backgroundColor: section.color || '#F5F5F4' }}
                                aria-hidden="true"
                              />
                              <span className="tree-label sidebar-title">{section.title}</span>
                            </button>

                            {sectionExpanded ? (
                              <div className="tree-children tree-children-pages" role="group">
                                {loading ? (
                                  <p className="subtle tree-empty">Loading pages...</p>
                                ) : trackers.length === 0 ? (
                                  <p className="subtle tree-empty">No pages yet.</p>
                                ) : (
                                  trackers.map((tracker) => (
                                    <div
                                      key={tracker.id}
                                      className={`tree-page-row ${overId === tracker.id ? 'drag-over' : ''}`}
                                      draggable={!loading}
                                      onDragStart={handleDragStart(tracker.id)}
                                      onDragOver={handleDragOver(tracker.id)}
                                      onDrop={handleDrop(tracker.id)}
                                      onDragEnd={handleDragEnd}
                                    >
                                      <button
                                        type="button"
                                        role="treeitem"
                                        aria-current={tracker.id === activeTrackerId ? 'page' : undefined}
                                        className={`tree-node tree-node-page ${
                                          tracker.id === activeTrackerId ? 'active' : ''
                                        } ${overId === tracker.id ? 'drag-over' : ''}`}
                                        onClick={() => onSelectPage?.(tracker.id)}
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
                                    </div>
                                  ))
                                )}
                              </div>
                            ) : null}
                          </div>
                        )
                      })
                    )}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>

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
