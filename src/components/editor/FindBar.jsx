function FindBar({
  inputRef,
  findQuery,
  findStatus,
  aiSearchMode,
  aiSearchLoading,
  onToggleAiMode,
  onFindQueryChange,
  onFindPrev,
  onFindNext,
  onClose,
}) {
  return (
    <div className="find-bar">
      <button
        type="button"
        className={`find-ai-toggle${aiSearchMode ? ' active' : ''}`}
        onClick={onToggleAiMode}
        aria-pressed={aiSearchMode}
        title={aiSearchMode ? 'AI find on — searching by meaning' : 'AI find off — exact text only'}
      >
        AI
      </button>
      <input
        ref={inputRef}
        type="text"
        className="find-input"
        placeholder={aiSearchMode ? 'Describe what to find' : 'Find in tracker'}
        value={findQuery}
        onChange={(event) => onFindQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'F3') {
            event.preventDefault()
            if (event.shiftKey) {
              onFindPrev()
            } else {
              onFindNext()
            }
          } else if (event.key === 'Enter' && event.shiftKey) {
            event.preventDefault()
            onFindPrev()
          } else if (event.key === 'Enter') {
            event.preventDefault()
            onFindNext()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            onClose()
          }
        }}
      />
      {aiSearchMode && aiSearchLoading && (
        <span className="find-ai-spinner" aria-label="Thinking" title="Thinking…" />
      )}
      <span className="find-count">
        {findStatus.matches.length > 0 ? findStatus.index + 1 : 0} of {findStatus.matches.length}
      </span>
      <button type="button" onClick={onFindPrev} disabled={findStatus.matches.length === 0}>
        Prev
      </button>
      <button type="button" onClick={onFindNext} disabled={findStatus.matches.length === 0}>
        Next
      </button>
      <button type="button" className="ghost" onClick={onClose}>
        Close
      </button>
    </div>
  )
}

export default FindBar
