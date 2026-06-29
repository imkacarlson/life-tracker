import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { getChecker, getLoadedChecker, isLoaded, addWord } from '../lib/spellChecker'
import { findMisspellings } from '../utils/spellcheckHelpers'

export const spellcheckPluginKey = new PluginKey('spellcheck')

// Re-scan ~400ms after the last edit so typing stays smooth. Scrolling reuses
// the same debounce so a flick doesn't fire dozens of scans.
const SCAN_DEBOUNCE_MS = 400
// Scan a little beyond the visible rect so words just off-screen are already
// underlined by the time they scroll into view.
const VIEWPORT_MARGIN_PX = 300

// Resolve the document range currently visible in the editor (plus a margin),
// so a long document only ever spell-checks the part the user can see.
const computeVisibleRange = (view) => {
  const doc = view.state.doc
  const rect = view.dom.getBoundingClientRect()
  const viewportBottom = window.innerHeight || document.documentElement.clientHeight || rect.bottom
  const top = Math.max(rect.top, 0) - VIEWPORT_MARGIN_PX
  const bottom = Math.min(rect.bottom, viewportBottom) + VIEWPORT_MARGIN_PX
  // Probe slightly inside the left edge so we land on text, not padding.
  const x = rect.left + Math.min(20, Math.max(1, rect.width / 2))
  const start = view.posAtCoords({ left: x, top })
  const end = view.posAtCoords({ left: x, top: bottom })
  let from = start ? start.pos : 0
  let to = end ? end.pos : doc.content.size
  if (from > to) [from, to] = [to, from]
  return { from: Math.max(0, from), to: Math.min(doc.content.size, to) }
}

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

// Owns the debounced scan loop, the per-word cache, and the scroll listener for
// one editor view. Created in the plugin's view() lifecycle and torn down with
// it. Kept out of plugin *state* so scanning (which dispatches its own
// transaction) never recurses through the state apply path.
const createScanController = (view, storage) => {
  let timer = null
  let destroyed = false
  let checker = null
  let lastSignature = null
  let scrollEl = null

  const runScan = () => {
    timer = null
    if (destroyed || !checker) return
    const range = computeVisibleRange(view)
    const decorations = collectDecorations(
      view.state.doc,
      range,
      checker,
      storage.ignore,
      storage.cache,
    )
    const signature = decorationSignature(decorations)
    // Skip the dispatch when scrolling reveals nothing new — avoids churning
    // transactions (and the autosave/selection listeners) for no reason.
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

  const onScroll = () => schedule()

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
    scrollEl = view.dom.closest('.editor-panel') || view.dom.parentElement
    scrollEl?.addEventListener('scroll', onScroll, { passive: true })
  }

  const destroy = () => {
    destroyed = true
    if (timer) clearTimeout(timer)
    scrollEl?.removeEventListener('scroll', onScroll)
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
