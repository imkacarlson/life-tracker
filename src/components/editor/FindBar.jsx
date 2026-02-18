function FindBar({
  inputRef,
  findQuery,
  findStatus,
  onFindQueryChange,
  onFindPrev,
  onFindNext,
  onClose,
}) {
  return (
    <div className="find-bar">
      <input
        ref={inputRef}
        type="text"
        className="find-input"
        placeholder="Find in tracker"
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
