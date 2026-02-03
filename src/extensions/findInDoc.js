import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export const findInDocPluginKey = new PluginKey('findInDoc')

const buildSearchIndex = (doc) => {
  let text = ''
  const posMap = []
  let lastWasSeparator = true

  const addSeparator = () => {
    if (lastWasSeparator) return
    text += '\n'
    posMap.push(null)
    lastWasSeparator = true
  }

  doc.descendants((node, pos) => {
    if (node.isText) {
      const value = node.text || ''
      if (value.length > 0) {
        for (let i = 0; i < value.length; i += 1) {
          text += value[i]
          posMap.push(pos + 1 + i)
        }
        lastWasSeparator = false
      }
      return false
    }

    if (node.type?.name === 'hardBreak') {
      addSeparator()
      return false
    }

    if (node.isBlock && node.type?.name !== 'doc') {
      addSeparator()
    }

    return true
  })

  return { text, posMap }
}

const computeMatches = (doc, query) => {
  const normalized = query?.trim()
  if (!normalized) return []

  const { text, posMap } = buildSearchIndex(doc)
  const haystack = text.toLowerCase()
  const needle = normalized.toLowerCase()
  const matches = []
  let startIndex = 0

  while ((startIndex = haystack.indexOf(needle, startIndex)) !== -1) {
    const endIndex = startIndex + needle.length
    let blocked = false

    for (let i = startIndex; i < endIndex; i += 1) {
      if (posMap[i] == null) {
        blocked = true
        break
      }
    }

    if (!blocked) {
      const from = posMap[startIndex]
      const to = posMap[endIndex - 1] + 1
      if (typeof from === 'number' && typeof to === 'number' && from < to) {
        matches.push({ from, to })
      }
    }

    startIndex += 1
  }

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
          const nextQuery = typeof query === 'string' ? query : ''
          const normalized = nextQuery.trim()
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
              query = meta.query
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
