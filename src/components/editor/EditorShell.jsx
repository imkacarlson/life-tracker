import { EditorContent } from '@tiptap/react'

function EditorShell({ hasTracker, editor }) {
  return (
    <div className="editor-shell">
      {hasTracker ? (
        <EditorContent editor={editor} />
      ) : (
        <div className="editor-empty">
          <p>Select a tracker or create a new one to start writing.</p>
        </div>
      )}
    </div>
  )
}

export default EditorShell
