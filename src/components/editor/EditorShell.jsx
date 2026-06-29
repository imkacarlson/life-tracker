import { forwardRef } from 'react'
import { EditorContent } from '@tiptap/react'

// Pick the empty-state message + action that matches where the user actually
// is, so a blank editor never leaves them guessing what to do next.
function ContextualEmpty({ emptyState }) {
  const kind = emptyState?.kind ?? 'none'

  if (kind === 'section') {
    return (
      <div className="editor-empty">
        <p>This section is empty.</p>
        {emptyState?.onCreatePage ? (
          <button type="button" className="secondary" onClick={emptyState.onCreatePage}>
            Create your first page
          </button>
        ) : null}
      </div>
    )
  }

  if (kind === 'notebook') {
    return (
      <div className="editor-empty">
        <p>This notebook has no sections yet.</p>
        {emptyState?.onCreateSection ? (
          <button type="button" className="secondary" onClick={emptyState.onCreateSection}>
            Create a section
          </button>
        ) : null}
      </div>
    )
  }

  return (
    <div className="editor-empty">
      <p>Select a tracker or create a new one to start writing.</p>
    </div>
  )
}

const EditorShell = forwardRef(function EditorShell({ hasTracker, editor, emptyState }, ref) {
  return (
    <div className="editor-shell" ref={ref}>
      {hasTracker ? (
        <EditorContent editor={editor} />
      ) : (
        <ContextualEmpty emptyState={emptyState} />
      )}
    </div>
  )
})

export default EditorShell
