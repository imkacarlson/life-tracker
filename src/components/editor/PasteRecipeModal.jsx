function PasteRecipeModal({ open, loading, text, onTextChange, onClose, onSubmit }) {
  if (!open) return null

  return (
    <div
      className="ai-insert-modal-backdrop"
      onMouseDown={() => {
        if (loading) return
        onClose()
      }}
    >
      <div className="ai-insert-modal" onMouseDown={(event) => event.stopPropagation()}>
        <h3>Paste Recipe</h3>
        <p className="subtle">
          Paste recipe text from any source. AI will format it into a clean, consistent recipe page.
        </p>
        <textarea
          className="ai-insert-textarea"
          value={text}
          onChange={(event) => onTextChange(event.target.value)}
          placeholder="Paste your recipe here..."
          rows={10}
          disabled={loading}
        />
        <div className="ai-insert-actions">
          <button
            type="button"
            className="ghost"
            onClick={onClose}
            disabled={loading}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={loading || !text.trim()}
          >
            {loading ? 'Formatting...' : 'Create Recipe'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default PasteRecipeModal
