function CopyMoveModal({ modal, notebooks, activeNotebookId, onDestChange, onClose, onConfirm }) {
  if (!modal.open) return null

  return (
    <div
      className="ai-insert-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div className="ai-insert-modal copy-move-modal">
        <h3>{modal.action === 'copy' ? 'Copy section to…' : 'Move section to…'}</h3>
        <p className="subtle">Select a destination notebook.</p>
        <select
          className="copy-move-select"
          value={modal.destId}
          onChange={(event) => onDestChange(event.target.value)}
        >
          <option value="">— choose notebook —</option>
          {notebooks
            .filter((nb) => nb.id !== activeNotebookId)
            .map((nb) => (
              <option key={nb.id} value={nb.id}>
                {nb.title}
              </option>
            ))}
        </select>
        <div className="ai-insert-actions">
          <button type="button" className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" onClick={onConfirm} disabled={!modal.destId}>
            {modal.action === 'copy' ? 'Copy' : 'Move'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default CopyMoveModal
