/**
 * Race a promise against a timeout. If `promise` settles first (resolve OR
 * reject) we use its outcome; on rejection or timeout we resolve with the value
 * returned by `onTimeout()` instead of throwing.
 *
 * Used to keep `supabase.auth.getSession()` from hanging the loading state
 * forever on a fragile resume — see useAuth.js.
 *
 * @template T
 * @param {Promise<T>} promise   The work that might hang.
 * @param {number} ms            How long to wait before giving up.
 * @param {() => T} onTimeout    Produces the fallback value on timeout/rejection.
 * @returns {Promise<T>}         Always resolves, never rejects.
 */
export function withTimeout(promise, ms, onTimeout) {
  return new Promise((resolve) => {
    let settled = false

    const finish = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }

    const timer = setTimeout(() => finish(onTimeout()), ms)

    promise.then(
      (value) => finish(value),
      () => finish(onTimeout()),
    )
  })
}
