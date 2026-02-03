import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export const findInDocPluginKey = new PluginKey('findInDoc')

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
        ({ tr, state, dispatch }) => {
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
            nextTr.setSelection(TextSelection.create(state.doc, from, to)).scrollIntoView()
          }
          dispatch(nextTr)
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
        ({ tr, state, dispatch }) => {
          const pluginState = findInDocPluginKey.getState(state)
          const matches = pluginState?.matches ?? []
          if (!matches.length) return false
          if (!dispatch) return true
          const currentIndex = typeof pluginState?.index === 'number' ? pluginState.index : -1
          const nextIndex = (currentIndex + 1) % matches.length
          const { from, to } = matches[nextIndex]
          const nextTr = tr
            .setMeta(findInDocPluginKey, { index: nextIndex })
            .setSelection(TextSelection.create(state.doc, from, to))
            .scrollIntoView()
          dispatch(nextTr)
          return true
        },
      findPrev:
        () =>
        ({ tr, state, dispatch }) => {
          const pluginState = findInDocPluginKey.getState(state)
          const matches = pluginState?.matches ?? []
          if (!matches.length) return false
          if (!dispatch) return true
          const currentIndex = typeof pluginState?.index === 'number' ? pluginState.index : -1
          const nextIndex = (currentIndex - 1 + matches.length) % matches.length
          const { from, to } = matches[nextIndex]
          const nextTr = tr
            .setMeta(findInDocPluginKey, { index: nextIndex })
            .setSelection(TextSelection.create(state.doc, from, to))
            .scrollIntoView()
          dispatch(nextTr)
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

            if (typeof meta?.query === 'string') {
              query = normalizeQuery(meta.query)
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

            return { query, matches, index }
          },
        },
        props: {
          decorations(state) {
            const pluginState = findInDocPluginKey.getState(state)
            if (!pluginState?.matches?.length || !pluginState?.query) {
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
