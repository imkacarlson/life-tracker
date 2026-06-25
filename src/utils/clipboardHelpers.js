import { Fragment, Slice } from '@tiptap/pm/model'

// Node attributes that identify a block for deep-linking. They must not ride
// along on the clipboard: pasted blocks are new blocks and EnsureNodeIds will
// assign fresh IDs. Carrying the originals would create duplicate IDs (broken
// deep links) until that pass runs.
const ID_ATTRS = ['id', 'created_at']

const stripFragment = (fragment) => {
  const children = []
  fragment.forEach((node) => {
    // Text nodes carry no block IDs and can't be rebuilt via type.create;
    // pass them through unchanged (their marks/text are already preserved).
    if (node.isText) {
      children.push(node)
      return
    }
    let attrs = node.attrs
    if (attrs && ID_ATTRS.some((key) => attrs[key] != null)) {
      attrs = { ...attrs }
      for (const key of ID_ATTRS) attrs[key] = null
    }
    const content = node.content.size ? stripFragment(node.content) : node.content
    // Marks (links, highlights, colors, …) are preserved untouched.
    children.push(node.type.create(attrs, content, node.marks))
  })
  return Fragment.fromArray(children)
}

/**
 * Returns a copy of the slice with internal block IDs cleared, preserving the
 * open boundaries and all marks. Used as ProseMirror's `transformCopied` so the
 * clipboard never carries duplicate IDs into the paste target.
 */
export const stripClipboardIds = (slice) =>
  new Slice(stripFragment(slice.content), slice.openStart, slice.openEnd)
