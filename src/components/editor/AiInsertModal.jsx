function AiInsertModal({ inputRef, open, loading, text, hasTracker, onTextChange, onClose, onSubmit }) {
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
        <h3>AI Insert</h3>
        <p className="subtle">
          Paste content and AI will place it into the current page.
        </p>
        <textarea
          ref={inputRef}
          className="ai-insert-textarea"
          value={text}
          onChange={(event) => onTextChange(event.target.value)}
          placeholder="Paste your content here..."
          rows={8}
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
            disabled={loading || !text.trim() || !hasTracker}
          >
            {loading ? 'Inserting...' : 'Insert into page'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default AiInsertModal
