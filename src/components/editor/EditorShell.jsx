import { useState, useRef } from 'react'
import { EditorContent } from '@tiptap/react'

// TEMPORARY — remove after Step 0 prototype verification (issue #32)
const ZOOM_TEST_ENABLED = 'ontouchstart' in globalThis

function EditorShell({ hasTracker, editor }) {
  const [zoomed, setZoomed] = useState(false)
  const shellRef = useRef(null)

  const toggleZoom = () => {
    const next = !zoomed
    setZoomed(next)
    if (shellRef.current) {
      shellRef.current.style.zoom = next ? '1.5' : ''
    }
  }

  return (
    <div className="editor-shell" ref={shellRef}>
      {hasTracker ? (
        <EditorContent editor={editor} />
      ) : (
        <div className="editor-empty">
          <p>Select a tracker or create a new one to start writing.</p>
        </div>
      )}
      {ZOOM_TEST_ENABLED && (
        <button
          onClick={toggleZoom}
          style={{
            position: 'fixed',
            bottom: '20px',
            right: '20px',
            zIndex: 9999,
            padding: '12px 20px',
            fontSize: '16px',
            background: zoomed ? '#e74c3c' : '#2ecc71',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
          }}
        >
          {zoomed ? 'RESET ZOOM' : 'TEST ZOOM 1.5×'}
        </button>
      )}
    </div>
  )
}

export default EditorShell
