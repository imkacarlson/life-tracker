import { supabase } from './supabase'
import { getActivityDevice, getActivitySessionId } from './activityLog'
import { withTimeout } from '../utils/promiseTimeout'
import { describeKeystroke, gzipJson, recordingChunkPath } from '../utils/recordingHelpers'

// Session recorder: captures the screen with rrweb (DOM changes, mouse moves,
// touches, scrolls, input) plus every keystroke as a custom event, and
// uploads it in gzipped chunks to the session-recordings bucket so a glitch
// can be watched back later (Settings > Flags & Recordings).
//
// Only runs while signed in, so the login form is never recorded. Password
// fields are masked by rrweb and their keystrokes are skipped.

const BUCKET = 'session-recordings'
// Cut a chunk this often (or sooner if it gets big).
const CHUNK_INTERVAL_MS = 30_000
const MAX_CHUNK_EVENTS = 3000
// A fresh full DOM snapshot this often, so replay can start near any moment
// without loading the whole session.
const CHECKOUT_EVERY_MS = 10 * 60_000
// Chunks waiting for upload are kept in memory only; cap them so a long
// offline stretch can't eat the phone's memory.
const MAX_QUEUED_CHUNKS = 40
const UPLOAD_TIMEOUT_MS = 45_000

// rrweb event types (rrweb's EventType enum), inlined so rrweb itself can be
// lazy-loaded.
const EVENT_META = 4
const EVENT_FULL_SNAPSHOT = 2

let userId = null
let stopRecording = null
let starting = false
let addCustomEvent = null

let buffer = []
let seq = 0
let queue = []
let uploading = null
let chunkTimer = null

const cutChunk = () => {
  if (buffer.length === 0) return
  const events = buffer
  buffer = []
  queue.push({
    seq: seq++,
    events,
    startedAt: events[0].timestamp,
    endedAt: events[events.length - 1].timestamp,
    hasFullSnapshot: events.some((event) => event.type === EVENT_FULL_SNAPSHOT),
  })
  if (queue.length > MAX_QUEUED_CHUNKS) queue = queue.slice(queue.length - MAX_QUEUED_CHUNKS)
}

const uploadChunk = async (chunk) => {
  const sessionId = getActivitySessionId()
  const path = recordingChunkPath(userId, sessionId, chunk.seq)
  const blob = await gzipJson(chunk.events)

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { contentType: 'application/gzip', upsert: false })
  // 'Duplicate' means an earlier attempt uploaded the file but the index row
  // failed; go on and write the row.
  if (uploadError && !/exists|duplicate/i.test(uploadError.message ?? '')) throw uploadError

  const { error: rowError } = await supabase.from('recording_chunks').insert({
    session_id: sessionId,
    seq: chunk.seq,
    path,
    device: getActivityDevice(),
    started_at: new Date(chunk.startedAt).toISOString(),
    ended_at: new Date(chunk.endedAt).toISOString(),
    has_full_snapshot: chunk.hasFullSnapshot,
    event_count: chunk.events.length,
    bytes: blob.size,
  })
  if (rowError && rowError.code !== '23505') throw rowError
}

// Upload queued chunks one at a time, oldest first. Stops at the first
// failure and retries on the next tick.
const drainQueue = () => {
  if (uploading || !userId) return uploading ?? Promise.resolve()
  uploading = (async () => {
    try {
      while (queue.length > 0 && userId) {
        // A request started while the app was backgrounded can hang forever;
        // without a timeout it would block every later upload.
        const ok = await withTimeout(
          uploadChunk(queue[0]).then(() => true),
          UPLOAD_TIMEOUT_MS,
          () => false,
        )
        if (!ok) break
        queue = queue.slice(1)
      }
    } catch {
      // Offline or similar; the chunk stays queued.
    } finally {
      uploading = null
    }
  })()
  return uploading
}

/** Snapshot of the recorder's state, for debugging from the console. */
export const getRecorderState = () => ({
  signedIn: Boolean(userId),
  recording: Boolean(stopRecording),
  starting,
  bufferedEvents: buffer.length,
  queuedChunks: queue.length,
  uploading: Boolean(uploading),
  nextSeq: seq,
})

/** Cut the current chunk and upload everything queued (used by the flag button and crashes). */
export function flushRecording() {
  cutChunk()
  return drainQueue()
}

const handleKeydown = (event) => {
  if (!addCustomEvent) return
  const keystroke = describeKeystroke(event)
  if (keystroke) addCustomEvent('keydown', keystroke)
}

const handleVisibility = () => {
  if (document.visibilityState === 'hidden') flushRecording()
}

async function start() {
  if (stopRecording || starting || typeof window === 'undefined') return
  starting = true
  try {
    // Lazy: rrweb is ~100KB and only needed once signed in.
    const { record } = await import('rrweb')
    if (!userId) return
    addCustomEvent = record.addCustomEvent
    stopRecording = record({
      emit(event, isCheckout) {
        // A checkout starts a new full snapshot: begin a new chunk with it so
        // that chunk can be replayed on its own.
        if (isCheckout && event.type === EVENT_META) cutChunk()
        buffer.push(event)
        if (buffer.length >= MAX_CHUNK_EVENTS) cutChunk()
      },
      checkoutEveryNms: CHECKOUT_EVERY_MS,
      maskInputOptions: { password: true },
      // mousemove every 50ms is smooth enough to follow and keeps size down.
      sampling: { mousemove: 50, scroll: 150, input: 'last' },
      slimDOMOptions: 'all',
      recordCanvas: false,
      collectFonts: false,
    })
    document.addEventListener('keydown', handleKeydown, true)
    document.addEventListener('visibilitychange', handleVisibility)
    chunkTimer = setInterval(() => {
      cutChunk()
      drainQueue()
    }, CHUNK_INTERVAL_MS)
  } catch {
    // If rrweb fails to load or start, the app carries on unrecorded.
    stopRecording = null
  } finally {
    starting = false
  }
}

function stop() {
  if (!stopRecording) return
  stopRecording()
  stopRecording = null
  addCustomEvent = null
  document.removeEventListener('keydown', handleKeydown, true)
  document.removeEventListener('visibilitychange', handleVisibility)
  clearInterval(chunkTimer)
  chunkTimer = null
  flushRecording()
}

/**
 * Start or stop recording to match who is signed in and whether recording is
 * switched on. Called from useActivityTracking.
 */
export function syncSessionRecording({ userId: nextUserId, enabled }) {
  const signingOut = userId && !nextUserId
  if (signingOut) stop()
  userId = nextUserId ?? null
  if (userId && enabled) start()
  else if (!signingOut) stop()
}
