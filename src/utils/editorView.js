// Shared guard for accessing a Tiptap editor's ProseMirror view.
//
// The `editor.view` getter THROWS when the view isn't mounted — and a
// freshly-built-but-unmounted editor (the Tiptap remount window during page
// navigation) is NOT `isDestroyed`, so `?.` and `isDestroyed` checks do not
// prevent the throw. Reaching `editor.view` unguarded during that window
// crashes into the ErrorBoundary mid-navigation, which previously surfaced only
// as silent "scroll = 0" failures far from the real cause.
//
// Note: only `editor.view` throws this way. `editor.state` is created
// synchronously and is always safe to read, so it does not need guarding.

/**
 * Return the editor's mounted ProseMirror view, or null if it isn't mounted.
 * Always fetch the view through this helper before touching `view.*`.
 *
 * @param {import('@tiptap/core').Editor | null | undefined} editor
 * @returns {import('@tiptap/pm/view').EditorView | null}
 */
export function getMountedEditorView(editor) {
  if (!editor || editor.isDestroyed) return null
  try {
    const view = editor.view
    return view?.dom ? view : null
  } catch {
    return null
  }
}
