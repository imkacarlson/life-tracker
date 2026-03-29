import { useRef, useState } from 'react'
import { generateJSON } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { supabase } from '../lib/supabase'
import { resizeAndEncode } from '../utils/imageResize'
import PasteRecipeModal from './editor/PasteRecipeModal'

function Sidebar({
  trackers,
  activeId,
  onSelect,
  onCreate,
  onReorder,
  loading,
  disabled,
  compactBadges = false,
  isRecipesNotebook = false,
  session,
  sectionId,
  onCreateWithContent,
}) {
  const dragIdRef = useRef(null)
  const [overId, setOverId] = useState(null)
  const [pasteRecipeOpen, setPasteRecipeOpen] = useState(false)
  const [pasteRecipeText, setPasteRecipeText] = useState('')
  const [pasteRecipeLoading, setPasteRecipeLoading] = useState(false)
  const [pasteRecipeFiles, setPasteRecipeFiles] = useState([])

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
    if (disabled || loading) return
    dragIdRef.current = id
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', id)
  }

  const handleDragOver = (id) => (event) => {
    if (disabled || loading) return
    event.preventDefault()
    if (overId !== id) setOverId(id)
    event.dataTransfer.dropEffect = 'move'
  }

  const handleDrop = (id) => (event) => {
    if (disabled || loading) return
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
    onReorder?.(next)
  }

  const handleDragEnd = () => {
    dragIdRef.current = null
    setOverId(null)
  }

  const handlePasteRecipeSubmit = async () => {
    if (!session || !sectionId || pasteRecipeLoading) return
    const text = pasteRecipeText.trim()
    if (!text && pasteRecipeFiles.length === 0) return

    // Capture callback at click time to prevent section-switch race during the AI call
    const createWithContent = onCreateWithContent

    setPasteRecipeLoading(true)
    try {
      const provider = localStorage.getItem('ai-provider') || 'anthropic'
      const model = localStorage.getItem('ai-model') || 'claude-sonnet-4-20250514'

      const { data: { session: currentSession } } = await supabase.auth.getSession()
      if (!currentSession) throw new Error('You must be logged in')

      // Resize and encode attached images
      const images = []
      for (const entry of pasteRecipeFiles) {
        try {
          const result = await resizeAndEncode(entry.file)
          images.push({ base64: result.base64, mediaType: result.mediaType })
        } catch (err) {
          console.error('Image resize failed:', err)
          // Partial failure — skip this image, keep others
        }
      }

      // If user attached images but all failed to resize, give a clear error
      if (images.length === 0 && pasteRecipeFiles.length > 0 && !text) {
        throw new Error('All images failed to process. Try different photos.')
      }

      // Enforce ~1.5MB total payload budget
      const totalSize = images.reduce((sum, img) => sum + img.base64.length, 0)
      if (totalSize > 1_500_000) {
        throw new Error('Total image size too large. Try fewer or smaller photos.')
      }

      // Call the edge function to format the recipe
      const { data, error } = await supabase.functions.invoke('ai-paste-recipe', {
        body: { provider, model, text: text || '', images },
        headers: { Authorization: `Bearer ${currentSession.access_token}` },
      })

      if (error) throw error
      if (data?.error) throw new Error(data.error)

      const { markdown, title } = data

      // Convert markdown to HTML, then parse into Tiptap JSON without touching the live editor
      const html = markdownToHtml(markdown)
      const content = generateJSON(html, [StarterKit])

      // Create the page via the captured callback (uses section from click time)
      const result = await createWithContent(title || 'Untitled Recipe', content)
      if (!result) throw new Error('Failed to save recipe page')

      setPasteRecipeOpen(false)
      setPasteRecipeText('')
      pasteRecipeFiles.forEach((f) => URL.revokeObjectURL(f.previewUrl))
      setPasteRecipeFiles([])
    } catch (err) {
      console.error('Paste recipe failed:', err)
      alert('Failed to create recipe: ' + (err.message || String(err)))
    } finally {
      setPasteRecipeLoading(false)
    }
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h2>Pages</h2>
        <div className="sidebar-header-buttons">
          {isRecipesNotebook && (
            <button
              className="secondary"
              onClick={() => setPasteRecipeOpen(true)}
              disabled={disabled || pasteRecipeLoading}
            >
              {pasteRecipeLoading ? 'Pasting...' : 'Paste Recipe'}
            </button>
          )}
          <button className="secondary" onClick={onCreate} disabled={disabled}>
            New
          </button>
        </div>
      </div>

      {loading ? (
        <p className="subtle">Loading pages...</p>
      ) : disabled ? (
        <p className="subtle">Select a section to view pages.</p>
      ) : trackers.length === 0 ? (
        <p className="subtle">No pages yet.</p>
      ) : (
        <div className="sidebar-list">
          {trackers.map((tracker) => (
            <div
              key={tracker.id}
              className={`sidebar-row ${
                overId === tracker.id ? 'drag-over' : ''
              }`}
              draggable={!disabled && !loading}
              onDragStart={handleDragStart(tracker.id)}
              onDragOver={handleDragOver(tracker.id)}
              onDrop={handleDrop(tracker.id)}
              onDragEnd={handleDragEnd}
            >
              <button
                type="button"
                className={`sidebar-item ${tracker.id === activeId ? 'active' : ''} ${
                  overId === tracker.id ? 'drag-over' : ''
                }`}
                onClick={() => onSelect(tracker.id)}
              >
                <span className="sidebar-title">{tracker.title}</span>
              </button>
              {tracker.is_tracker_page ? (
                <span
                  className={`tracker-page-badge ${compactBadges ? 'compact' : ''}`}
                  title="Tracker page for AI Daily"
                  aria-label="Tracker page for AI Daily"
                >
                  {compactBadges ? 'T' : 'TRACKER'}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      )}

      <PasteRecipeModal
        open={pasteRecipeOpen}
        loading={pasteRecipeLoading}
        text={pasteRecipeText}
        onTextChange={setPasteRecipeText}
        files={pasteRecipeFiles}
        onFilesChange={setPasteRecipeFiles}
        onClose={() => {
          if (!pasteRecipeLoading) {
            setPasteRecipeOpen(false)
            setPasteRecipeText('')
            pasteRecipeFiles.forEach((f) => URL.revokeObjectURL(f.previewUrl))
            setPasteRecipeFiles([])
          }
        }}
        onSubmit={handlePasteRecipeSubmit}
      />
    </aside>
  )
}

/**
 * Convert simple markdown to HTML for Tiptap parsing.
 * Handles headings, bullet lists, numbered lists, and paragraphs.
 */
function markdownToHtml(md) {
  const lines = md.split('\n')
  const html = []
  let inUl = false
  let inOl = false

  const closeList = () => {
    if (inUl) { html.push('</ul>'); inUl = false }
    if (inOl) { html.push('</ol>'); inOl = false }
  }

  for (const line of lines) {
    const trimmed = line.trim()

    // Headings
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      closeList()
      const level = headingMatch[1].length
      html.push(`<h${level}>${inlineMarkdown(escapeHtml(headingMatch[2]))}</h${level}>`)
      continue
    }

    // Bullet list item
    const bulletMatch = trimmed.match(/^[-*]\s+(.+)$/)
    if (bulletMatch) {
      if (inOl) { html.push('</ol>'); inOl = false }
      if (!inUl) { html.push('<ul>'); inUl = true }
      html.push(`<li>${inlineMarkdown(escapeHtml(bulletMatch[1]))}</li>`)
      continue
    }

    // Numbered list item
    const olMatch = trimmed.match(/^\d+[.)]\s+(.+)$/)
    if (olMatch) {
      if (inUl) { html.push('</ul>'); inUl = false }
      if (!inOl) { html.push('<ol>'); inOl = true }
      html.push(`<li>${inlineMarkdown(escapeHtml(olMatch[1]))}</li>`)
      continue
    }

    // Empty line
    if (!trimmed) {
      closeList()
      continue
    }

    // Paragraph
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

/** Convert inline markdown (bold, italic, links) to HTML. Runs after escapeHtml. */
function inlineMarkdown(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, url) => {
      // Unescape &amp; back to & since escapeHtml ran before inlineMarkdown
      const rawUrl = url.replace(/&amp;/g, '&')
      // Only allow http/https links to prevent javascript: XSS from LLM output
      if (/^https?:\/\//i.test(rawUrl)) {
        // Re-escape for safe attribute insertion
        const safeUrl = rawUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
        return `<a href="${safeUrl}">${label}</a>`
      }
      return `${label} (${url})`
    })
}

export default Sidebar
