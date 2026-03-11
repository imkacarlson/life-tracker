function ConflictModal({ conflict, onUseServer, onUseDraft }) {
  if (!conflict) return null

  return (
    <div className="ai-insert-modal-backdrop">
      <div className="ai-insert-modal conflict-modal">
        <h3>Draft conflict detected</h3>
        <p className="subtle">
          A local draft exists for this page, but the server has a newer version.
          Choose which version to keep.
        </p>
        <div className="conflict-timestamps">
          <p>Server version: {new Date(conflict.serverUpdatedAt).toLocaleString()}</p>
          <p>Local draft: {new Date(conflict.draftTs).toLocaleString()}</p>
        </div>
        <div className="ai-insert-actions">
          <button type="button" className="ghost" onClick={onUseDraft}>
            Use local version
          </button>
          <button type="button" onClick={onUseServer}>
            Use server version
          </button>
        </div>
      </div>
    </div>
  )
}

export default ConflictModal
