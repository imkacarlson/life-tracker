import { useEffect, useRef, useState } from 'react'
import { SCOPE_WORDS } from '../../utils/librarySuggestions'

/**
 * Make a topic (or a section) yourself.
 *
 * The second front door. For something you can already name — "Health IT" — you
 * do not need the app to notice it for you: you create it empty and it starts
 * gathering. The first door is the suggestion card, and both land here or on the
 * same insert.
 *
 * Mirrors NewNotebookModal's markup so the two dialogs feel like one thing.
 * Mounted only while open, so the field resets without an effect.
 */
function NewLibraryThingModal({ scope = 'topic', busy = false, error = null, onClose, onSubmit }) {
  const inputRef = useRef(null)
  const [title, setTitle] = useState('')
  const words = SCOPE_WORDS[scope] ?? SCOPE_WORDS.topic

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const canSubmit = Boolean(title.trim()) && !busy
  const submit = () => {
    if (canSubmit) onSubmit(title.trim())
  }

  return (
    <div
      className="ai-insert-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose()
      }}
    >
      <div
        className="ai-insert-modal new-notebook-modal"
        role="dialog"
        aria-label={words.heading}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !busy) onClose()
          if (event.key === 'Enter') submit()
        }}
      >
        <h3>{words.heading}</h3>

        <label className="new-notebook-field">
          <span className="new-notebook-label">Name</span>
          <input
            ref={inputRef}
            type="text"
            className="new-notebook-input"
            value={title}
            placeholder={words.placeholder}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>

        <p className="new-notebook-kind-hint library-modal-hint">{words.hint}</p>
        {error ? <p className="library-suggestions-error">{error}</p> : null}

        <div className="ai-insert-actions">
          <button type="button" className="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" onClick={submit} disabled={!canSubmit}>
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default NewLibraryThingModal
