import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { getChecker, getLoadedChecker, isLoaded, addWord } from '../lib/spellChecker'
import { findMisspellings } from '../utils/spellcheckHelpers'

export const spellcheckPluginKey = new PluginKey('spellcheck')

// Re-scan ~400ms after the last edit so typing stays smooth.
const SCAN_DEBOUNCE_MS = 400

// Walk the text nodes in `range` and collect a decoration for each misspelling.
// `cache` memoizes per-word correctness so repeated words (and overlapping scans
// while scrolling) don't re-run nspell's relatively expensive check.
const collectDecorations = (doc, range, checker, ignore, cache) => {
  const cachedChecker = {
    correct: (word) => {
      if (cache.has(word)) return cache.get(word)
      const ok = checker.correct(word)
      cache.set(word, ok)
      return ok
    },
  }

  const decorations = []
  doc.nodesBetween(range.from, range.to, (node, pos) => {
    if (node.isText && node.text) {
      const misspellings = findMisspellings(node.text, cachedChecker, { ignore })
      for (const m of misspellings) {
        decorations.push(
          Decoration.inline(
            pos + m.from,
            pos + m.to,
            { class: 'spellcheck-error' },
            { word: m.word },
          ),
        )
      }
    }
    return true
  })
  return decorations
}

const decorationSignature = (decorations) =>
  decorations.map((d) => `${d.from}:${d.to}`).join('|')

// Owns the debounced scan loop and the per-word cache for one editor view.
// Created in the plugin's view() lifecycle and torn down with it. Kept out of
// plugin *state* so scanning (which dispatches its own transaction) never
// recurses through the state apply path.
const createScanController = (view, storage) => {
  let timer = null
  let destroyed = false
  let checker = null
  let lastSignature = null

  const runScan = () => {
    timer = null
    if (destroyed || !checker) return
    // Scan the whole document. Coordinate-based "visible range" probing proved
    // unreliable in this app: the window (not the editor) is the scroll surface,
    // so a tall editor extends far past the viewport and posAtCoords returned
    // degenerate positions, collapsing the range to nothing and leaving real
    // misspellings unflagged. The per-word cache below keeps a full scan cheap —
    // repeated words are only checked once, and edits reuse the cache.
    const doc = view.state.doc
    const range = { from: 0, to: doc.content.size }
    const decorations = collectDecorations(
      doc,
      range,
      checker,
      storage.ignore,
      storage.cache,
    )
    const signature = decorationSignature(decorations)
    // Skip the dispatch when nothing changed — avoids churning transactions
    // (and the autosave/selection listeners) for no reason.
    if (signature === lastSignature) return
    lastSignature = signature
    const decoSet = DecorationSet.create(view.state.doc, decorations)
    const tr = view.state.tr.setMeta(spellcheckPluginKey, { decorations: decoSet })
    tr.setMeta('addToHistory', false)
    view.dispatch(tr)
  }

  const schedule = (immediate = false) => {
    if (destroyed) return
    if (timer) clearTimeout(timer)
    if (immediate) lastSignature = null // force the next scan to dispatch
    timer = setTimeout(runScan, immediate ? 0 : SCAN_DEBOUNCE_MS)
  }

  const start = () => {
    // Reuse the instance if another view already loaded it; otherwise trigger
    // the lazy dictionary fetch and scan once it's ready.
    if (isLoaded()) {
      checker = getLoadedChecker()
      schedule(true)
    } else {
      getChecker()
        .then((instance) => {
          if (destroyed) return
          checker = instance
          schedule(true)
        })
        .catch((error) => {
          if (import.meta.env?.DEV) {
            console.error('[spellcheck] dictionary failed to load', error)
          }
        })
    }
  }

  const destroy = () => {
    destroyed = true
    if (timer) clearTimeout(timer)
  }

  return { start, schedule, destroy }
}

export const Spellcheck = Extension.create({
  name: 'spellcheck',

  addStorage() {
    return {
      // Lowercased words to skip this session ("Ignore" in the right-click menu).
      ignore: new Set(),
      // word -> boolean correctness cache, shared across scans.
      cache: new Map(),
      controller: null,
      // Replaced in onCreate (need editor access). Declared here so callers can
      // reference editor.storage.spellcheck.* before onCreate runs.
      getMisspellingAt: () => null,
      addCustomWord: () => {},
      ignoreWord: () => {},
      rescan: () => {},
    }
  },

  onCreate() {
    const editor = this.editor
    const storage = this.storage

    // Returns the flagged word covering `pos`, or null. The right-click menu
    // uses this to decide whether to show its suggestions section.
    storage.getMisspellingAt = (pos) => {
      const decoSet = spellcheckPluginKey.getState(editor.state)
      if (!decoSet) return null
      const found = decoSet.find(pos, pos)
      if (!found.length) return null
      const deco = found[0]
      const word = deco.spec?.word ?? editor.state.doc.textBetween(deco.from, deco.to)
      return { word, from: deco.from, to: deco.to }
    }

    storage.rescan = () => {
      storage.controller?.schedule(true)
    }

    // Add to the in-memory dictionary and re-scan so the squiggle clears
    // instantly. Supabase persistence is handled by useCustomDictionary.
    storage.addCustomWord = (word) => {
      if (!word) return
      addWord(word)
      storage.cache.delete(word)
      storage.cache.delete(word.toLowerCase())
      storage.rescan()
    }

    // Skip this word for the rest of the session (not persisted).
    storage.ignoreWord = (word) => {
      if (!word) return
      storage.ignore.add(word.toLowerCase())
      storage.rescan()
    }
  },

  addProseMirrorPlugins() {
    const storage = this.storage
    return [
      new Plugin({
        key: spellcheckPluginKey,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, value) => {
            const meta = tr.getMeta(spellcheckPluginKey)
            if (meta?.decorations) return meta.decorations
            // Map existing decorations through edits so underlines stay attached
            // to their words between scans.
            return tr.docChanged ? value.map(tr.mapping, tr.doc) : value
          },
        },
        props: {
          decorations(state) {
            return spellcheckPluginKey.getState(state)
          },
        },
        view(view) {
          const controller = createScanController(view, storage)
          storage.controller = controller
          controller.start()
          return {
            update(updatedView, prevState) {
              if (updatedView.state.doc !== prevState.doc) {
                controller.schedule()
              }
            },
            destroy() {
              controller.destroy()
              storage.controller = null
            },
          }
        },
      }),
    ]
  },
})

export default Spellcheck
