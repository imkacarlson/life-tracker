import { useEffect, useState } from 'react'

// Don't flash a skeleton on fast page switches: only show it once loading has
// lasted past this threshold (Docmost's editor-skeleton pattern).
const SHOW_DELAY_MS = 100

// A few shimmer lines of varying width so the placeholder reads as "content
// loading" rather than an empty white panel.
const LINE_WIDTHS = ['62%', '90%', '78%', '40%', '84%', '55%']

export default function EditorSkeleton() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), SHOW_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [])

  if (!visible) {
    // Still occupy the editor's flex slot so layout doesn't jump.
    return <div className="editor-loading-skeleton" aria-hidden="true" />
  }

  return (
    <div className="editor-loading-skeleton" role="status" aria-label="Loading content">
      <div className="editor-skeleton__lines">
        {LINE_WIDTHS.map((width, index) => (
          <span key={index} className="editor-skeleton__line" style={{ width }} />
        ))}
      </div>
    </div>
  )
}
