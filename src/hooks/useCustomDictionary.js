import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { isTouchOnlyDevice } from '../utils/device'
import { addWord as addWordToChecker } from '../lib/spellChecker'

// Custom spell-check dictionary, synced across devices via Supabase.
//
// Desktop-only: on touch-only devices the hook does nothing (no fetch, no
// nspell import side effects) so phones stay lightweight. On desktop it loads
// the user's saved words on mount and seeds them into the shared nspell checker
// (buffered until the dictionary finishes loading), and exposes addWord() for
// the right-click "Add to dictionary" action.
export const useCustomDictionary = (userId) => {
  const [words, setWords] = useState([])
  // Lowercased set for case-insensitive dedupe.
  const loadedRef = useRef(new Set())
  const isDesktop = !isTouchOnlyDevice()

  useEffect(() => {
    if (!isDesktop || !userId) return
    let cancelled = false

    ;(async () => {
      const { data, error } = await supabase
        .from('custom_dictionary')
        .select('word')
        .eq('user_id', userId)

      if (error) {
        console.error('Failed to load custom dictionary:', error)
        return
      }
      if (cancelled) return

      const seen = new Set()
      const list = []
      for (const row of data ?? []) {
        const word = row?.word
        if (!word) continue
        const lower = word.toLowerCase()
        if (seen.has(lower)) continue
        seen.add(lower)
        list.push(word)
        addWordToChecker(word)
      }
      loadedRef.current = seen
      setWords(list)
    })()

    return () => {
      cancelled = true
    }
  }, [isDesktop, userId])

  const addWord = useCallback(
    async (rawWord) => {
      const word = typeof rawWord === 'string' ? rawWord.trim() : ''
      if (!isDesktop || !userId || !word) return

      const lower = word.toLowerCase()
      // Already known — still make sure nspell has it, then bail (no duplicate row).
      if (loadedRef.current.has(lower)) {
        addWordToChecker(word)
        return
      }

      // Optimistic: update local state + checker immediately, roll back on error.
      loadedRef.current.add(lower)
      setWords((prev) => [...prev, word])
      addWordToChecker(word)

      const { error } = await supabase
        .from('custom_dictionary')
        .insert({ user_id: userId, word })

      if (error) {
        console.error('Failed to save custom word:', error)
        loadedRef.current.delete(lower)
        setWords((prev) => prev.filter((w) => w !== word))
      }
    },
    [isDesktop, userId],
  )

  return { words, addWord }
}
