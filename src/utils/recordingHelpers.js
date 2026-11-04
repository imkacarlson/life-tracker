// Pure helpers for session recordings (src/lib/sessionRecorder.js and the
// Settings replay viewer).

/** Storage path of one recording chunk: <user>/<session>/<seq>.json.gz */
export const recordingChunkPath = (userId, sessionId, seq) =>
  `${userId}/${sessionId}/${String(seq).padStart(6, '0')}.json.gz`

/**
 * A keystroke as stored in the recording, or null for keys that must never be
 * kept (anything typed into a password field).
 */
export const describeKeystroke = (event) => {
  const target = event?.target
  if (!event || target?.type === 'password') return null
  return {
    key: event.key,
    code: event.code,
    ctrl: Boolean(event.ctrlKey),
    meta: Boolean(event.metaKey),
    alt: Boolean(event.altKey),
    shift: Boolean(event.shiftKey),
    repeat: Boolean(event.repeat),
    target: target?.tagName ? target.tagName.toLowerCase() : null,
    in_editor: Boolean(target?.closest?.('.ProseMirror')),
  }
}

/**
 * Which chunks to load to replay [fromMs, toMs]. Replay has to begin at a
 * full DOM snapshot, so start from the last chunk that has one at or before
 * fromMs (or the first one after it, if none earlier), then take every chunk
 * up to toMs.
 *
 * @param {{ seq: number, started_at: string, ended_at: string, has_full_snapshot: boolean }[]} chunks
 *   one session's chunks
 */
export const pickReplayChunks = (chunks, fromMs, toMs) => {
  const sorted = [...chunks].sort((a, b) => a.seq - b.seq)
  const fullIndexes = sorted
    .map((chunk, index) => (chunk.has_full_snapshot ? index : -1))
    .filter((index) => index >= 0)
  if (fullIndexes.length === 0) return []

  const startedBefore = fullIndexes.filter((index) => Date.parse(sorted[index].started_at) <= fromMs)
  const startIndex = startedBefore.length ? startedBefore[startedBefore.length - 1] : fullIndexes[0]

  return sorted.slice(startIndex).filter((chunk, offset) => {
    // Always keep the starting chunk, then anything that begins before toMs.
    return offset === 0 || Date.parse(chunk.started_at) <= toMs
  })
}

/** Group chunk rows (newest first) into one summary per session. */
export const summarizeSessions = (chunks) => {
  const bySession = new Map()
  for (const chunk of chunks) {
    const existing = bySession.get(chunk.session_id)
    if (!existing) {
      bySession.set(chunk.session_id, {
        sessionId: chunk.session_id,
        device: chunk.device,
        startedAt: chunk.started_at,
        endedAt: chunk.ended_at,
        bytes: chunk.bytes,
      })
      continue
    }
    if (chunk.started_at < existing.startedAt) existing.startedAt = chunk.started_at
    if (chunk.ended_at > existing.endedAt) existing.endedAt = chunk.ended_at
    existing.bytes += chunk.bytes
  }
  return [...bySession.values()].sort((a, b) => b.endedAt.localeCompare(a.endedAt))
}

// gzip via the browser's built-in CompressionStream (Chrome 80+, every
// browser this app targets). Falls back to plain JSON if it's missing; the
// reader tells the two apart by the gzip magic bytes.
export async function gzipJson(value) {
  const json = JSON.stringify(value)
  if (typeof CompressionStream === 'undefined') {
    return new Blob([json], { type: 'application/json' })
  }
  const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Response(stream).blob()
}

export async function gunzipJson(blob) {
  const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer())
  const isGzip = head[0] === 0x1f && head[1] === 0x8b
  if (!isGzip) return JSON.parse(await blob.text())
  const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'))
  return JSON.parse(await new Response(stream).text())
}
