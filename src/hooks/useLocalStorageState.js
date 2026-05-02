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
  const writeTimerRef = useRef(null)
  const keyRef = useRef(key)

  useEffect(() => {
    keyRef.current = key
  }, [key])

  const setValue = useCallback((nextOrFn) => {
    setValueState((prev) => {
      const next = typeof nextOrFn === 'function' ? nextOrFn(prev) : nextOrFn
      if (writeTimerRef.current) clearTimeout(writeTimerRef.current)
      writeTimerRef.current = setTimeout(() => {
        writeTimerRef.current = null
        try {
          localStorage.setItem(keyRef.current, JSON.stringify(next))
        } catch {
          // storage quota or private mode — silently swallow
        }
      }, DEBOUNCE_MS)
      return next
    })
  }, [])

  // Flush on unmount so the latest value is always persisted.
  useEffect(() => {
    return () => {
      if (writeTimerRef.current) {
        clearTimeout(writeTimerRef.current)
        writeTimerRef.current = null
        try {
          localStorage.setItem(keyRef.current, JSON.stringify(value))
        } catch {
          // ignore
        }
      }
    }
  }, [value])

  return [value, setValue]
}
