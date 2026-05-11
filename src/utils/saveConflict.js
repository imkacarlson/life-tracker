/**
 * Classify the outcome of an optimistic-concurrency UPDATE against the pages table.
 *
 * Expected call shape:
 *   supabase.from('pages')
 *     .update(payload)
 *     .eq('id', trackerId)
 *     .eq('updated_at', knownTs)
 *     .select('updated_at')
 *     .single()
 *
 * Outcomes:
 *   - data row returned        -> 'ok'      (server accepted, advance the version token)
 *   - zero rows matched        -> 'conflict' (someone else wrote since we last read)
 *   - real transport/db error  -> 'error'    (retryable)
 *   - missing knownTs          -> 'error'    (we can't safely save without a version)
 *
 * PostgREST returns the PGRST116 code when .single() matches no rows. Some clients
 * also return data:null with no error in that case, so handle both.
 */
export const classifySaveResult = ({ data, error, knownTs }) => {
  if (!knownTs) {
    return { kind: 'error', error: error ?? new Error('missing version token') }
  }
  if (error) {
    if (error.code === 'PGRST116') {
      return { kind: 'conflict' }
    }
    return { kind: 'error', error }
  }
  if (data === null || data === undefined) {
    return { kind: 'conflict' }
  }
  return { kind: 'ok', nextKnownTs: data.updated_at }
}
