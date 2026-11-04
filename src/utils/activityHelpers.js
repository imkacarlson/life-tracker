// Pure helpers for the activity log (src/lib/activityLog.js). Kept free of DOM
// globals and Supabase so they can be unit tested with plain objects.

const MAX_TEXT = 200
const MAX_LIST = 20

export const truncate = (value, max = MAX_TEXT) => {
  const text = String(value ?? '')
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/**
 * Drop events older than the window, then cap the count. The in-memory trail
 * only needs to cover "what happened just before the glitch", so it stays small.
 */
export const trimRecentEvents = (events, nowMs, windowMs, maxCount) => {
  const cutoff = nowMs - windowMs
  const fresh = events.filter((event) => Date.parse(event.occurred_at) >= cutoff)
  return fresh.length > maxCount ? fresh.slice(fresh.length - maxCount) : fresh
}

// Elements whose clicks mean "the user used a feature". Taps inside the editor
// content are not listed here: those show up as edits instead.
const CLICKABLE_SELECTOR = [
  'button',
  'a[href]',
  '[role="button"]',
  '[role="menuitem"]',
  '[role="switch"]',
  '[role="treeitem"]',
  '[role="tab"]',
  'summary',
].join(',')

/**
 * Turn a click target into a short readable label, or null when the click was
 * not on a control (e.g. plain text, or inside the editor content).
 */
export const describeClickTarget = (target) => {
  if (!target || typeof target.closest !== 'function') return null
  const control = target.closest(CLICKABLE_SELECTOR)
  if (!control || control.closest('.ProseMirror')) return null

  const label =
    control.getAttribute('aria-label') ||
    control.getAttribute('title') ||
    (control.textContent ?? '').replace(/\s+/g, ' ').trim()
  if (!label) return null

  return {
    label: truncate(label, 80),
    role: control.getAttribute('role') || control.tagName.toLowerCase(),
  }
}

/** "ctrl+shift+k" style name for a keyboard shortcut, or null for plain typing. */
export const describeShortcut = (event) => {
  if (!event?.ctrlKey && !event?.metaKey && !event?.altKey) return null
  const key = String(event.key ?? '')
  if (['Control', 'Meta', 'Alt', 'Shift'].includes(key)) return null
  const parts = []
  if (event.ctrlKey) parts.push('ctrl')
  if (event.metaKey) parts.push('meta')
  if (event.altKey) parts.push('alt')
  if (event.shiftKey) parts.push('shift')
  parts.push(key.length === 1 ? key.toLowerCase() : key)
  return parts.join('+')
}

const LIST_ITEM_TYPES = new Set(['listItem', 'taskItem'])

// An item's own text is its first child (the paragraph), not nested sub-items.
const ownTextNodes = (itemNode) => {
  const first = itemNode.firstChild
  if (!first) return []
  const nodes = []
  first.descendants((child) => {
    if (child.isText) nodes.push(child)
  })
  return nodes
}

const isFullyStruck = (textNodes) =>
  textNodes.length > 0 &&
  textNodes.every((node) => node.marks.some((mark) => mark.type.name === 'strike'))

/**
 * Snapshot of what a page contains, used to describe an edit burst by
 * comparing the snapshot before and after it.
 *
 * "Done" means a checked task item, or a list item whose text is fully struck
 * through (the way items get crossed off in the trackers).
 */
export const summarizeDoc = (doc) => {
  const items = new Set()
  const done = new Set()
  let openTasks = 0

  doc.descendants((node) => {
    if (!LIST_ITEM_TYPES.has(node.type.name)) return true
    const textNodes = ownTextNodes(node)
    const text = textNodes.map((child) => child.text).join('').trim()
    if (!text) return true

    items.add(text)
    const checked = node.type.name === 'taskItem' && node.attrs.checked === true
    if (checked || isFullyStruck(textNodes)) {
      done.add(text)
    } else if (node.type.name === 'taskItem') {
      openTasks += 1
    }
    return true
  })

  return { chars: doc.textContent.length, items, done, openTasks }
}

const setDifference = (a, b, keep = () => true) =>
  [...a]
    .filter((value) => !b.has(value) && keep(value))
    .slice(0, MAX_LIST)
    .map((value) => truncate(value))

/** Compare two summarizeDoc() results into the data stored on an 'edit' event. */
export const diffDocSummaries = (before, after) => ({
  chars_delta: after.chars - before.chars,
  items_added: setDifference(after.items, before.items),
  items_removed: setDifference(before.items, after.items),
  completed: setDifference(after.done, before.done),
  // Only items that still exist: deleting a crossed-off item is not "un-doing" it.
  uncompleted: setDifference(before.done, after.done, (text) => after.items.has(text)),
  open_tasks: after.openTasks,
})
