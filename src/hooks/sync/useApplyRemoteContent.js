import { useEffect, useRef } from 'react'
import { normalizeContent } from '../../utils/contentHelpers'
import { getMountedEditorView } from '../../utils/editorView'

/**
 * Lets usePages push another device's version of a page into the open editor.
 *
 * The editor only reads page content when it mounts, so swapping new content
 * into the page cache alone leaves the old text on screen. The next keystroke
 * would then save that old text over the other device's edit. This hook
 * registers an applier that replaces the editor's document in place.
 *
 * The applier resolves to:
 *   true  -> safe to adopt the server version (applied, or this page isn't the
 *            one on screen so the cache alone is enough)
 *   false -> the editor changed while we were preparing the content (you typed),
 *            so nothing was replaced; the caller keeps the old version token and
 *            the next save goes through the conflict check instead
 */
export function useApplyRemoteContent({ editor, editorSession, hydrate, register }) {
  // The applier is called from async code; read the latest values via refs.
  const editorRef = useRef(editor)
  const sessionRef = useRef(editorSession)
  const hydrateRef = useRef(hydrate)
  useEffect(() => {
    editorRef.current = editor
    sessionRef.current = editorSession
    hydrateRef.current = hydrate
  }, [editor, editorSession, hydrate])

  useEffect(() => {
    register(async (pageId, content) => {
      const currentEditor = editorRef.current
      const session = sessionRef.current
      const showingPage =
        currentEditor &&
        !currentEditor.isDestroyed &&
        session?.mode === 'page' &&
        session.status === 'ready' &&
        session.pageId === pageId
      if (!showingPage) return true

      // ProseMirror documents are immutable, so a different object means an edit.
      const docBefore = currentEditor.state.doc
      // Stored content holds image storage paths; the editor needs signed URLs.
      const hydrated = await hydrateRef.current(normalizeContent(content))
      if (currentEditor.isDestroyed || sessionRef.current?.pageId !== pageId) return true
      if (currentEditor.state.doc !== docBefore) return false

      const view = getMountedEditorView(currentEditor)
      if (!view) return true
      const nextDoc = currentEditor.schema.nodeFromJSON(hydrated)
      const tr = currentEditor.state.tr
        .replaceWith(0, currentEditor.state.doc.content.size, nextDoc.content)
        // Not an edit of ours: don't autosave it, and don't let undo step back
        // into the stale copy.
        .setMeta('preventUpdate', true)
        .setMeta('addToHistory', false)
      view.dispatch(tr)
      return true
    })
    return () => register(null)
  }, [register])
}
