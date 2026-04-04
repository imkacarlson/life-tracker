const TRANSIENT_ERROR_PATTERNS = [
  'Failed to fetch',
  'Load failed',
  'NetworkError',
  'network request failed',
]

export const isTransientSupabaseError = (error) => {
  const message =
    typeof error === 'string'
      ? error
      : error?.message || error?.details || error?.hint || ''

  return TRANSIENT_ERROR_PATTERNS.some((pattern) => message.includes(pattern))
}

const wait = (ms) => new Promise((resolve) => globalThis.setTimeout(resolve, ms))

export const runSupabaseQueryWithRetry = async (
  queryFn,
  { retries = 2, delayMs = 150 } = {},
) => {
  let lastResult = { data: null, error: null }

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      lastResult = await queryFn()
    } catch (error) {
      lastResult = { data: null, error }
    }

    if (!lastResult?.error) {
      return lastResult
    }

    if (!isTransientSupabaseError(lastResult.error) || attempt === retries) {
      return lastResult
    }

    await wait(delayMs * (attempt + 1))
  }

  return lastResult
}
