import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, Selection, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { scrollElementIntoViewWithToolbar } from '../utils/scrollIntoViewWithToolbar'

export const findInDocPluginKey = new PluginKey('findInDoc')

// Build the selection used to scroll a match into view.
//
// Literal matches are inline text ranges, so {from,to} is a valid TextSelection.
// AI matches are whole-block node ranges; selecting across a node's *outer*
// boundaries is not a valid inline selection (ProseMirror warns "endpoint not
// pointing into a node with inline content" inside table cells) and leaves the
// selection degenerate, so scrollIntoView has nothing to scroll to. For AI
// matches we snap to a valid position just inside the block instead.
const selectionForMatch = (doc, match, mode) => {
  if (mode === 'ai') {
    const inside = Math.min(match.from + 1, doc.content.size)
    return Selection.near(doc.resolve(inside), 1)
  }
  return TextSelection.create(doc, match.from, match.to)
}

// Scroll the rendered current-match element to the vertical center of the
// editor's safe band. Find navigation runs while the find input/button is
// focused (the editor is blurred), so the editor's own handleScrollToSelection
// override never fires for a dispatched .scrollIntoView(). This helper scrolls
// the DOM element carrying the `.current` decoration directly — focus-
// independent — routed through the same toolbar/keyboard-aware util the
// deep-link feature uses (so mobile lands the match above the lifted toolbar).
//
// Mobile robustness: mirror scrollToBlock's settle pattern
// (navigationHelpers.js) — schedule via double requestAnimationFrame, then
// re-assert at ~80ms and ~200ms so our scroll wins against Chrome's late native
// scroll when the keyboard is open. The decoration re-renders each navigation,
// so we re-query the `.current` element on every attempt.
const scrollCurrentMatchIntoView = (view) => {
  if (!view?.dom) return

  const runScroll = () => {
    const element = view.dom.querySelector('.find-match.current, .ai-find-match.current')
    if (!element?.getBoundingClientRect) return
    const container = view.dom.closest('.editor-panel') ?? null
    const toolbarEl =
      container?.querySelector('.toolbar') ??
      (typeof document !== 'undefined' ? document.querySelector('.toolbar') : null)
    scrollElementIntoViewWithToolbar({
      element,
      container,
      toolbarEl,
      padding: 20,
      align: 'center',
    })
  }

  const safeRun = () => {
    try {
      runScroll()
    } catch (error) {
      // A transient DOM lookup failure must never break find navigation. Surface
      // it in dev so unexpected failures don't stay silently swallowed.
      if (import.meta.env?.DEV) {
        console.error('[findInDoc] scrollCurrentMatchIntoView failed', error)
      }
    }
  }

  const schedule = globalThis.requestAnimationFrame ?? ((callback) => setTimeout(callback, 0))
  schedule(() => schedule(safeRun))
  setTimeout(safeRun, 80)
  setTimeout(safeRun, 200)
}

const normalizeQuery = (input) => {
  if (typeof input !== 'string') return ''
  let normalized = input.trim()
  if (normalized.length < 2) return normalized

  const first = normalized[0]
  const last = normalized[normalized.length - 1]
  const quoteChars = new Set(['"', "'", '“', '”', '‘', '’'])

  if (quoteChars.has(first) && quoteChars.has(last)) {
    normalized = normalized.slice(1, -1).trim()
  }

  return normalized
}

const computeMatches = (doc, query) => {
  const normalized = query?.trim()
  if (!normalized) return []

  const needle = normalized.toLowerCase()
  const matches = []
  const window = []
  const windowSize = needle.length
  let charBeforeWindow = null

  const resetWindow = () => {
    window.length = 0
    charBeforeWindow = null
  }

  const pushChar = (char, pos) => {
    // When shifting out a char, it becomes the new "before" character
    if (window.length >= windowSize) {
      charBeforeWindow = window[0].char
    }

    window.push({ char, pos })
    if (window.length > windowSize) {
      window.shift()
    }
    if (window.length < windowSize) return

    const value = window.map((entry) => entry.char).join('')
    if (value !== needle) return

    // Skip if preceded by a digit (for standalone date matching)
    if (charBeforeWindow && /\d/.test(charBeforeWindow)) {
      return
    }

    const from = window[0].pos
    const to = window[window.length - 1].pos + 1
    if (typeof from === 'number' && typeof to === 'number' && from < to) {
      matches.push({ from, to })
    }
  }

  doc.descendants((node, pos) => {
    if (node.isText) {
      const value = node.text || ''
      if (value.length > 0) {
        for (let i = 0; i < value.length; i += 1) {
          pushChar(value[i].toLowerCase(), pos + i)
        }
      }
      return false
    }

    if (node.type?.name === 'hardBreak') {
      resetWindow()
      return false
    }

    if (node.isBlock && node.type?.name !== 'doc') {
      resetWindow()
    }

    return true
  })

  return matches
}

const createEmptyState = () => ({
  query: '',
  matches: [],
  index: -1,
  mode: 'literal',
})

const FindInDoc = Extension.create({
  name: 'findInDoc',

  addStorage() {
    return {
      open: null,
      close: null,
    }
  },

  addCommands() {
    return {
      setFindQuery:
        (query) =>
        ({ tr, state, dispatch, view }) => {
          if (!dispatch) return true
          const normalized = normalizeQuery(query)
          const matches = normalized ? computeMatches(state.doc, normalized) : []
          const index = matches.length > 0 ? 0 : -1
          const nextTr = tr.setMeta(findInDocPluginKey, {
            query: normalized,
            index,
          })
          if (matches.length > 0) {
            const { from, to } = matches[0]
            nextTr.setSelection(TextSelection.create(state.doc, from, to))
          }
          dispatch(nextTr)
          if (matches.length > 0) scrollCurrentMatchIntoView(view)
          return true
        },
      // AI find supplies whole-block ranges (resolved from matching block ids)
      // instead of literal substring ranges. Everything downstream — counter,
      // next/prev, scroll — reuses the same `matches` array.
      setAiMatches:
        (ranges) =>
        ({ tr, state, dispatch, view }) => {
          if (!dispatch) return true
          const matches = Array.isArray(ranges) ? ranges : []
          const index = matches.length > 0 ? 0 : -1
          const nextTr = tr.setMeta(findInDocPluginKey, {
            aiMatches: matches,
            mode: 'ai',
            index,
          })
          if (matches.length > 0) {
            nextTr.setSelection(selectionForMatch(state.doc, matches[0], 'ai'))
          }
          dispatch(nextTr)
          if (matches.length > 0) scrollCurrentMatchIntoView(view)
          return true
        },
      clearFind:
        () =>
        ({ tr, dispatch }) => {
          if (!dispatch) return true
          dispatch(tr.setMeta(findInDocPluginKey, { clear: true }))
          return true
        },
      findNext:
        () =>
        ({ tr, state, dispatch, view }) => {
          const pluginState = findInDocPluginKey.getState(state)
          const matches = pluginState?.matches ?? []
          if (!matches.length) return false
          if (!dispatch) return true
          const currentIndex = typeof pluginState?.index === 'number' ? pluginState.index : -1
          const nextIndex = (currentIndex + 1) % matches.length
          const nextTr = tr
            .setMeta(findInDocPluginKey, { index: nextIndex })
            .setSelection(selectionForMatch(state.doc, matches[nextIndex], pluginState?.mode))
          dispatch(nextTr)
          scrollCurrentMatchIntoView(view)
          return true
        },
      findPrev:
        () =>
        ({ tr, state, dispatch, view }) => {
          const pluginState = findInDocPluginKey.getState(state)
          const matches = pluginState?.matches ?? []
          if (!matches.length) return false
          if (!dispatch) return true
          const currentIndex = typeof pluginState?.index === 'number' ? pluginState.index : -1
          const nextIndex = (currentIndex - 1 + matches.length) % matches.length
          const nextTr = tr
            .setMeta(findInDocPluginKey, { index: nextIndex })
            .setSelection(selectionForMatch(state.doc, matches[nextIndex], pluginState?.mode))
          dispatch(nextTr)
          scrollCurrentMatchIntoView(view)
          return true
        },
    }
  },

  addKeyboardShortcuts() {
    return {
      'Mod-f': () => {
        if (typeof this.storage?.open === 'function') {
          this.storage.open()
          return true
        }
        return false
      },
      F3: () => {
        this.editor.commands.findNext()
        return true
      },
      'Shift-F3': () => {
        this.editor.commands.findPrev()
        return true
      },
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: findInDocPluginKey,
        state: {
          init: () => createEmptyState(),
          apply: (tr, prev, _oldState, newState) => {
            const meta = tr.getMeta(findInDocPluginKey)

            if (meta?.clear) {
              return createEmptyState()
            }

            let query = prev.query
            let matches = prev.matches
            let index = prev.index
            let mode = prev.mode || 'literal'

            // Switching into AI mode: adopt the supplied whole-block ranges and
            // stop running literal substring matching.
            if (Array.isArray(meta?.aiMatches)) {
              mode = 'ai'
              matches = meta.aiMatches
              index = matches.length > 0 ? 0 : -1
              return { query, matches, index, mode }
            }

            // A literal query always reverts to literal mode.
            if (typeof meta?.query === 'string') {
              mode = 'literal'
              query = normalizeQuery(meta.query)
            }

            if (mode === 'ai') {
              // Keep AI matches; remap their positions across edits so the
              // block highlights survive document changes.
              if (tr.docChanged && matches.length) {
                matches = matches
                  .map((m) => {
                    const from = tr.mapping.map(m.from, 1)
                    const to = tr.mapping.map(m.to, -1)
                    return to > from ? { from, to } : null
                  })
                  .filter(Boolean)
              }
              if (!matches.length) {
                index = -1
              } else if (typeof meta?.index === 'number') {
                index = Math.max(0, Math.min(meta.index, matches.length - 1))
              } else if (index >= matches.length) {
                index = matches.length - 1
              } else if (index < 0) {
                index = 0
              }
              return { query, matches, index, mode }
            }

            const shouldRecompute = tr.docChanged || typeof meta?.query === 'string'
            if (shouldRecompute) {
              matches = query ? computeMatches(newState.doc, query) : []
            }

            if (!matches.length) {
              index = -1
            } else if (typeof meta?.index === 'number') {
              index = Math.max(0, Math.min(meta.index, matches.length - 1))
            } else if (typeof meta?.query === 'string' || (shouldRecompute && index === -1)) {
              index = 0
            } else if (index >= matches.length) {
              index = matches.length - 1
            }

            return { query, matches, index, mode }
          },
        },
        props: {
          decorations(state) {
            const pluginState = findInDocPluginKey.getState(state)
            if (!pluginState?.matches?.length) {
              return DecorationSet.empty
            }

            // AI mode: whole-block node decorations using the deep-link look.
            if (pluginState.mode === 'ai') {
              const decorations = pluginState.matches.map((match, idx) =>
                Decoration.node(match.from, match.to, {
                  class: idx === pluginState.index ? 'ai-find-match current' : 'ai-find-match',
                }),
              )
              return DecorationSet.create(state.doc, decorations)
            }

            // Literal mode: inline substring decorations (unchanged).
            if (!pluginState.query) {
              return DecorationSet.empty
            }
            const decorations = pluginState.matches.map((match, idx) =>
              Decoration.inline(match.from, match.to, {
                class: idx === pluginState.index ? 'find-match current' : 'find-match',
              }),
            )
            return DecorationSet.create(state.doc, decorations)
          },
        },
      }),
    ]
  },
})

export default FindInDoc
