import { useEffect, useRef } from 'react'

/**
 * Create a notebook: name + kind, in one place.
 *
 * The kind used to be implicit — trackers came from the "+ Notebook" button and
 * a Recipes notebook was auto-provisioned behind the user's back. Choosing it
 * here retires that special case, and it is what the Library requires anyway:
 * the user makes their own Library and their own sections. Nothing creates one
 * for them.
 */

const NOTEBOOK_KINDS = [
  {
    type: 'tracker',
    label: 'Tracker',
    hint: 'Monthly pages you write, carry forward, and let go.',
  },
  {
    type: 'recipes',
    label: 'Recipes',
    hint: 'Pasted recipes, formatted into consistent pages.',
  },
  {
    type: 'library',
    label: 'Library',
    hint: 'Things you saved to find again later. Captures arrive from Telegram.',
  },
]

function NewNotebookModal({ open, title, type, onTitleChange, onTypeChange, onClose, onSubmit }) {
  const inputRef = useRef(null)

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  if (!open) return null

  const canSubmit = Boolean(title.trim())

  return (
    <div
      className="ai-insert-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className="ai-insert-modal new-notebook-modal"
        role="dialog"
        aria-label="New notebook"
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose()
          if (event.key === 'Enter' && canSubmit) onSubmit()
        }}
      >
        <h3>New notebook</h3>

        <label className="new-notebook-field">
          <span className="new-notebook-label">Name</span>
          <input
            ref={inputRef}
            type="text"
            className="new-notebook-input"
            value={title}
            placeholder="My Notebook"
            onChange={(event) => onTitleChange(event.target.value)}
          />
        </label>

        <fieldset className="new-notebook-kinds">
          <legend className="new-notebook-label">Kind</legend>
          {NOTEBOOK_KINDS.map((kind) => (
            <label
              key={kind.type}
              className={`new-notebook-kind ${type === kind.type ? 'selected' : ''}`}
            >
              <input
                type="radio"
                name="notebook-kind"
                value={kind.type}
                checked={type === kind.type}
                onChange={() => onTypeChange(kind.type)}
              />
              <span className="new-notebook-kind-text">
                <span className="new-notebook-kind-label">{kind.label}</span>
                <span className="new-notebook-kind-hint">{kind.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="ai-insert-actions">
          <button type="button" className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" onClick={onSubmit} disabled={!canSubmit}>
            Create
          </button>
        </div>
      </div>
    </div>
  )
}

export default NewNotebookModal
