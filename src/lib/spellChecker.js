// Module-level singleton spell checker.
//
// The first time a checker is requested, this lazily fetches the Hunspell
// dictionary and builds one nspell instance, then reuses it for the lifetime of
// the page. Only ever imported on desktop (the spellcheck Tiptap extension is
// the sole static importer and is added to the editor only when
// !isTouchOnlyDevice(); the right-click menu imports it dynamically). So mobile
// bundles never pull nspell in and phones never fetch the ~190 KB dictionary —
// important for bad-cell-service situations.

let checkerInstance = null
let checkerPromise = null

// Custom words added before the dictionary finishes loading. They're applied to
// the nspell instance the moment it's constructed (and immediately thereafter),
// so words seeded from Supabase at startup are never lost to the load race.
const pendingCustomWords = new Set()

// The vendored Hunspell files live in public/dictionaries/en (sourced from the
// dictionary-en package — see scripts/copy-dictionary.js). They're fetched on
// demand and browser-cached, and are deliberately excluded from the
// service-worker precache (workbox globPatterns in vite.config.js) so the app
// shell stays small and mobile never downloads them.
const DICT_BASE = `${import.meta.env.BASE_URL}dictionaries/en`

const loadDictionaryFiles = async () => {
  const [affRes, dicRes] = await Promise.all([
    fetch(`${DICT_BASE}/index.aff`),
    fetch(`${DICT_BASE}/index.dic`),
  ])
  if (!affRes.ok || !dicRes.ok) {
    throw new Error('Failed to fetch spell-check dictionary')
  }
  const [aff, dic] = await Promise.all([affRes.text(), dicRes.text()])
  return { aff, dic }
}

// Returns a promise resolving to the shared nspell instance, constructing it on
// first call. Concurrent callers share the same in-flight promise.
export const getChecker = () => {
  if (checkerInstance) return Promise.resolve(checkerInstance)
  if (!checkerPromise) {
    checkerPromise = (async () => {
      const [{ default: nspell }, { aff, dic }] = await Promise.all([
        import('nspell'),
        loadDictionaryFiles(),
      ])
      const instance = nspell(aff, dic)
      // Apply any custom words that arrived before the dictionary was ready.
      for (const word of pendingCustomWords) {
        instance.add(word)
      }
      checkerInstance = instance
      return instance
    })().catch((error) => {
      // Reset so a later request can retry instead of being stuck on a rejected
      // promise (e.g. a transient offline fetch failure).
      checkerPromise = null
      throw error
    })
  }
  return checkerPromise
}

// Synchronous accessor for code paths that must not block (the extension's scan
// loop). Returns null until the checker has finished loading.
export const getLoadedChecker = () => checkerInstance

export const isLoaded = () => checkerInstance !== null

// Add a custom word so it's no longer flagged as misspelled. Safe to call before
// the dictionary loads — the word is buffered and applied on construction.
export const addWord = (word) => {
  if (!word) return
  pendingCustomWords.add(word)
  if (checkerInstance) {
    checkerInstance.add(word)
  }
}
