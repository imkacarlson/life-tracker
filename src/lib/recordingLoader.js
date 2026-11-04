import { supabase } from './supabase'
import { gunzipJson, pickReplayChunks, summarizeSessions } from '../utils/recordingHelpers'

// Reads glitch flags and session recordings back for the Settings viewer.

const BUCKET = 'session-recordings'
// Most chunks to download for one replay (~30 minutes at 30s per chunk).
const MAX_REPLAY_CHUNKS = 60

export async function loadGlitchFlags() {
  const { data, error } = await supabase
    .from('glitch_flags')
    .select('id, session_id, flagged_at, device, page_id, note, recent_events')
    .order('flagged_at', { ascending: false })
    .limit(50)
  if (error) throw error
  return data ?? []
}

export async function loadRecordedSessions() {
  const { data, error } = await supabase
    .from('recording_chunks')
    .select('session_id, device, started_at, ended_at, bytes')
    .order('started_at', { ascending: false })
    .limit(2000)
  if (error) throw error
  return summarizeSessions(data ?? []).slice(0, 30)
}

/**
 * Download and merge the recording of one session between fromMs and toMs.
 * Returns the rrweb events (empty when nothing was recorded) and whether the
 * range had to be cut short.
 */
export async function loadReplayEvents(sessionId, fromMs, toMs) {
  const { data: chunks, error } = await supabase
    .from('recording_chunks')
    .select('seq, path, started_at, ended_at, has_full_snapshot')
    .eq('session_id', sessionId)
    .order('seq', { ascending: true })
  if (error) throw error

  const picked = pickReplayChunks(chunks ?? [], fromMs, toMs)
  const truncated = picked.length > MAX_REPLAY_CHUNKS
  const toLoad = picked.slice(0, MAX_REPLAY_CHUNKS)

  const parts = await Promise.all(
    toLoad.map(async (chunk) => {
      const { data: blob, error: downloadError } = await supabase.storage
        .from(BUCKET)
        .download(chunk.path)
      if (downloadError) throw downloadError
      return gunzipJson(blob)
    }),
  )

  const events = parts.flat().sort((a, b) => a.timestamp - b.timestamp)
  return { events, truncated }
}
