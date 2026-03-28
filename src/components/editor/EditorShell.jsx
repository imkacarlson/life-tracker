import { forwardRef } from 'react'
import { EditorContent } from '@tiptap/react'

const EditorShell = forwardRef(function EditorShell({ hasTracker, editor }, ref) {
  return (
    <div className="editor-shell" ref={ref}>
      {hasTracker ? (
        <EditorContent editor={editor} />
      ) : (
        <div className="editor-empty">
          <p>Select a tracker or create a new one to start writing.</p>
        </div>
      )}
    </div>
  )
})

export default EditorShell
