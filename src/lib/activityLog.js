import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY, getAccessTokenSync } from './supabase'
import { isTouchOnlyDevice } from '../utils/device'
import {
  describeClickTarget,
  describeShortcut,
  trimRecentEvents,
  truncate,
} from '../utils/activityHelpers'

// Activity log: records what happens in the app into Supabase
// (activity_events), and keeps a short in-memory trail that gets attached to a
// glitch flag when the user taps the flag button.
//
// Module-level on purpose: errors and taps can happen before React mounts or
// after it crashes, and every part of the app logs through the same queue.

const ENABLED_KEY = 'activityRecording:enabled'
const PENDING_KEY = 'activityRecording:pending'
const PENDING_FLAGS_KEY = 'activityRecording:pendingFlags'

const FLUSH_INTERVAL_MS = 10_000
const PERSIST_THROTTLE_MS = 2_000
const MAX_PENDING = 2000
const BATCH_SIZE = 500
// keepalive requests are capped at 64KB by the browser.
const KEEPALIVE_MAX_BYTES = 60_000

const RECENT_WINDOW_MS = 5 * 60_000
const RECENT_MAX = 500
// How far back a glitch flag looks.
const FLAG_WINDOW_MS = 3 * 60_000

const readJson = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : JSON.parse(raw)
  } catch {
    return fallback
  }
}

const writeJson = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Quota or private mode: the in-memory queue still works.
  }
}

const newId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : // Fallback for old browsers; only needs to be unique, not secure.
      'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () =>
        Math.floor(Math.random() * 16).toString(16),
      )

const sessionId = newId()
let device = 'desktop'
let started = false
let userId = null
let currentPageId = null
let enabled = readJson(ENABLED_KEY, true) !== false
const enabledListeners = new Set()

// Events not yet uploaded, and the trail of recent events for glitch flags.
let pending = []
let recent = []
let flushing = false
let persistTimer = null

const persistPending = () => {
  if (persistTimer) return
  persistTimer = setTimeout(() => {
    persistTimer = null
    writeJson(PENDING_KEY, pending)
  }, PERSIST_THROTTLE_MS)
}

const persistPendingNow = () => {
  if (persistTimer) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
  writeJson(PENDING_KEY, pending)
}

/**
 * Record one event. Safe to call anywhere, any time; it never throws.
 *
 * @param {string} type  e.g. 'page_open', 'edit', 'error'
 * @param {object} data  small JSON-serializable details
 * @param {{ pageId?: string|null }} options  override the current page
 */
export function logActivity(type, data = {}, { pageId } = {}) {
  if (!enabled) return
  try {
    const event = {
      session_id: sessionId,
      occurred_at: new Date().toISOString(),
      device,
      event_type: type,
      page_id: pageId === undefined ? currentPageId : pageId,
      data,
    }
    recent.push(event)
    recent = trimRecentEvents(recent, Date.now(), RECENT_WINDOW_MS, RECENT_MAX)
    pending.push(event)
    if (pending.length > MAX_PENDING) pending = pending.slice(pending.length - MAX_PENDING)
    persistPending()
  } catch {
    // Logging must never break the app.
  }
}

/** Upload queued events through supabase-js. Failures stay queued for the next tick. */
export async function flushActivity() {
  if (flushing || !userId) return
  flushing = true
  try {
    await flushPendingFlags()
    while (pending.length > 0) {
      const batch = pending.slice(0, BATCH_SIZE)
      const { error } = await supabase.from('activity_events').insert(batch)
      if (error) break
      // Events logged during the await were appended after the batch.
      pending = pending.slice(batch.length)
      persistPendingNow()
    }
  } catch {
    // Offline or similar; retry on the next tick.
  } finally {
    flushing = false
  }
}

// Used when the app is being hidden or closed: there is no time to await
// supabase-js, so post directly with keepalive (same approach as the save
// queue's beacon in useSaveQueue.js).
const flushWithKeepalive = () => {
  persistPendingNow()
  const token = getAccessTokenSync()
  if (flushing || !userId || !token || !SUPABASE_URL || pending.length === 0) return
  if (typeof fetch !== 'function') return

  const batch = []
  let size = 2
  for (const event of pending) {
    const eventSize = JSON.stringify(event).length + 1
    if (size + eventSize > KEEPALIVE_MAX_BYTES) break
    batch.push(event)
    size += eventSize
  }
  if (batch.length === 0) return

  // Take the batch out now so a regular flush can't send it twice; put it back
  // if the request fails.
  const sent = new Set(batch)
  pending = pending.filter((event) => !sent.has(event))
  persistPendingNow()

  const restore = () => {
    pending = [...batch, ...pending].slice(-MAX_PENDING)
    persistPendingNow()
  }

  try {
    fetch(`${SUPABASE_URL}/rest/v1/activity_events`, {
      method: 'POST',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(batch),
    })
      .then((response) => {
        if (!response.ok) restore()
      })
      .catch(restore)
  } catch {
    restore()
  }
}

// ---------------------------------------------------------------------------
// Glitch flags

let pendingFlags = []

const savePendingFlags = () => writeJson(PENDING_FLAGS_KEY, pendingFlags)

async function flushPendingFlags() {
  while (pendingFlags.length > 0) {
    const flag = pendingFlags[0]
    const sentNote = flag.note
    const { error } = await supabase.from('glitch_flags').upsert({ ...flag })
    if (error) return
    // A note typed while the upload was in flight changes the queued flag;
    // keep it queued so the loop upserts again with the note.
    if (flag.note !== sentNote) continue
    pendingFlags = pendingFlags.filter((queued) => queued !== flag)
    savePendingFlags()
  }
}

/**
 * Save a glitch flag: the time, page, device and the last few minutes of
 * events. Works even when recording is turned off (the trail is then empty).
 * If the upload fails the flag is kept locally and retried.
 *
 * @returns {{ id: string, flaggedAt: string }}
 */
export function flagGlitch() {
  const flaggedAt = new Date().toISOString()
  const flag = {
    id: newId(),
    session_id: sessionId,
    flagged_at: flaggedAt,
    device,
    page_id: currentPageId,
    recent_events: trimRecentEvents(recent, Date.now(), FLAG_WINDOW_MS, RECENT_MAX),
    context: {
      url: typeof location !== 'undefined' ? location.href : null,
      viewport:
        typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : null,
      online: typeof navigator !== 'undefined' ? navigator.onLine : null,
      pending_events: pending.length,
      recording_enabled: enabled,
    },
  }
  logActivity('glitch_flagged', { flag_id: flag.id })

  pendingFlags.push(flag)
  savePendingFlags()
  // Not awaited: the note box should open instantly, and the flag is already
  // safe in localStorage while it uploads.
  flushActivity()
  return { id: flag.id, flaggedAt }
}

/** Attach the optional note typed after flagging. */
export async function addGlitchNote(flagId, note) {
  const text = truncate(note.trim(), 2000)
  if (!text) return
  const queued = pendingFlags.find((flag) => flag.id === flagId)
  if (queued) {
    // Still waiting to upload: the note rides along with it.
    queued.note = text
    savePendingFlags()
    await flushActivity()
    return
  }
  const { error } = await supabase.from('glitch_flags').update({ note: text }).eq('id', flagId)
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Context setters, used by useActivityTracking

export const setActivityUser = (id) => {
  userId = id ?? null
  if (userId) flushActivity()
}

export const setActivityPage = (pageId) => {
  currentPageId = pageId ?? null
}

// ---------------------------------------------------------------------------
// On/off switch (per device, in Settings)

export const isActivityRecordingEnabled = () => enabled

export const setActivityRecordingEnabled = (value) => {
  if (value === enabled) return
  if (!value) logActivity('recording_disabled')
  enabled = value
  writeJson(ENABLED_KEY, value)
  if (value) logActivity('recording_enabled')
  enabledListeners.forEach((listener) => listener(value))
}

export const subscribeActivityRecordingEnabled = (listener) => {
  enabledListeners.add(listener)
  return () => enabledListeners.delete(listener)
}

// ---------------------------------------------------------------------------
// Global listeners: errors, app lifecycle, taps and shortcuts

const describeReason = (reason) =>
  reason instanceof Error
    ? { message: truncate(reason.message, 500), stack: truncate(reason.stack, 2000) }
    : { message: truncate(typeof reason === 'string' ? reason : JSON.stringify(reason), 500) }

const stringifyArg = (arg) => {
  if (arg instanceof Error) return arg.stack || arg.message
  if (typeof arg === 'string') return arg
  try {
    return JSON.stringify(arg)
  } catch {
    return String(arg)
  }
}

// Wrap console.error/warn so problems the app already reports are kept too.
const wrapConsole = (level, eventType) => {
  const original = console[level]
  let inside = false
  console[level] = (...args) => {
    original.apply(console, args)
    if (inside) return
    inside = true
    try {
      logActivity(eventType, { message: truncate(args.map(stringifyArg).join(' '), 1000) })
    } finally {
      inside = false
    }
  }
}

/** Install global listeners once. Called from useActivityTracking. */
export function startActivityLog() {
  if (started || typeof window === 'undefined') return
  started = true
  device = isTouchOnlyDevice() ? 'phone' : 'desktop'

  // Anything left from a previous launch that never uploaded (crash, force close).
  const leftover = readJson(PENDING_KEY, [])
  if (Array.isArray(leftover)) pending = [...leftover, ...pending].slice(-MAX_PENDING)
  const leftoverFlags = readJson(PENDING_FLAGS_KEY, [])
  if (Array.isArray(leftoverFlags)) pendingFlags = leftoverFlags

  logActivity('app_start', {
    user_agent: truncate(navigator.userAgent, 300),
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    standalone: window.matchMedia?.('(display-mode: standalone)').matches ?? false,
    online: navigator.onLine,
  })

  window.addEventListener('error', (event) => {
    logActivity('error', {
      message: truncate(event.message, 500),
      source: truncate(event.filename, 300),
      line: event.lineno,
      column: event.colno,
      stack: truncate(event.error?.stack, 2000),
    })
  })
  window.addEventListener('unhandledrejection', (event) => {
    logActivity('unhandled_rejection', describeReason(event.reason))
  })
  wrapConsole('error', 'console_error')
  wrapConsole('warn', 'console_warn')

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      logActivity('app_hidden')
      flushWithKeepalive()
    } else {
      logActivity('app_visible')
      flushActivity()
    }
  })
  window.addEventListener('pagehide', () => {
    logActivity('app_close')
    flushWithKeepalive()
  })
  window.addEventListener('online', () => {
    logActivity('online')
    flushActivity()
  })
  window.addEventListener('offline', () => logActivity('offline'))

  // Capture phase so taps are seen even when a handler stops propagation.
  document.addEventListener(
    'click',
    (event) => {
      const target = describeClickTarget(event.target)
      if (!target) return
      logActivity('tap', { ...target, pointer: event.pointerType || null })
    },
    true,
  )
  document.addEventListener(
    'keydown',
    (event) => {
      const combo = describeShortcut(event)
      if (combo) logActivity('shortcut', { combo })
    },
    true,
  )

  setInterval(flushActivity, FLUSH_INTERVAL_MS)
}
