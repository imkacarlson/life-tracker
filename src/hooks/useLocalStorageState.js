import { useCallback, useEffect, useRef, useState } from 'react'

const DEBOUNCE_MS = 250

function readFromStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    const parsed = JSON.parse(raw)
    return parsed
  } catch {
    return fallback
  }
}

/**
 * Like useState but persists to localStorage with a debounced write.
 * Reads synchronously on mount; writes are debounced at 250ms.
 *
 * Serialization: JSON.stringify / JSON.parse. The value must be JSON-serializable.
 */
export function useLocalStorageState(key, initial) {
  const [value, setValueState] = useState(() => readFromStorage(key, initial))
  const valueRef = useRef(value)
  const writeTimerRef = useRef(null)
  const keyRef = useRef(key)
  const initialRef = useRef(initial)

  useEffect(() => {
    initialRef.current = initial
  }, [initial])

  useEffect(() => {
    if (keyRef.current !== key && writeTimerRef.current) {
      clearTimeout(writeTimerRef.current)
      writeTimerRef.current = null
      try {
        localStorage.setItem(keyRef.current, JSON.stringify(valueRef.current))
      } catch {
        // Ignore storage quota or private mode errors while changing scope.
      }
    }
    keyRef.current = key
    const stored = readFromStorage(key, initialRef.current)
    valueRef.current = stored
    setValueState(stored)
  }, [key])

  const setValue = useCallback((nextOrFn) => {
    const next = typeof nextOrFn === 'function' ? nextOrFn(valueRef.current) : nextOrFn
    valueRef.current = next
    setValueState(next)
    if (writeTimerRef.current) clearTimeout(writeTimerRef.current)
    const storageKey = keyRef.current
    writeTimerRef.current = setTimeout(() => {
      writeTimerRef.current = null
      try {
        localStorage.setItem(storageKey, JSON.stringify(next))
      } catch {
        // storage quota or private mode — silently swallow
      }
    }, DEBOUNCE_MS)
  }, [])

  // Flush before a hard navigation/reload as well as on React unmount. A browser
  // reload can tear down the document without running component cleanup, so
  // relying on unmount alone loses changes made within the debounce window.
  useEffect(() => {
    const flushPendingWrite = () => {
      if (!writeTimerRef.current) return
      clearTimeout(writeTimerRef.current)
      writeTimerRef.current = null
      try {
        localStorage.setItem(keyRef.current, JSON.stringify(valueRef.current))
      } catch {
        // Ignore storage quota or private mode errors.
      }
    }

    window.addEventListener('pagehide', flushPendingWrite)
    return () => {
      window.removeEventListener('pagehide', flushPendingWrite)
      flushPendingWrite()
    }
  }, [])

  return [value, setValue]
}
