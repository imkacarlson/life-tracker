import { detectConflict } from '../../utils/draftHelpers'
import { clearPageDraft, writePageDraft } from '../../utils/localDrafts'
import { classifySaveResult } from '../../utils/saveConflict'

const DRAFT_DELAY = 250
const SAVE_DELAY = 2000
const RETRY_DELAY = 5000

const defaultDraftStorage = {
  write: writePageDraft,
  clear: clearPageDraft,
}

export function createSaveQueueController({
  persistPage,
  fetchServerPage,
  getKnownUpdatedAt,
  setKnownUpdatedAt,
  onPendingChange,
  onStatusChange,
  onConflict,
  onError,
  onSaved,
  onDraftCleared,
  draftStorage = defaultDraftStorage,
}) {
  let saveTimers = {}
  let retryTimers = {}
  let inFlight = {}
  let queuedPayloads = {}
  let draftWriteTimers = {}
  let latestDraftKeys = {}

  const clearScheduled = (timers, trackerId) => {
    if (!timers[trackerId]) return
    clearTimeout(timers[trackerId])
    timers[trackerId] = null
  }

  const hasPendingForTracker = (trackerId) =>
    Boolean(
      trackerId &&
        (saveTimers[trackerId] ||
          retryTimers[trackerId] ||
          inFlight[trackerId] ||
          queuedPayloads[trackerId]),
    )

  const hasPending = () =>
    [saveTimers, retryTimers, inFlight, queuedPayloads].some((entries) =>
      Object.values(entries).some(Boolean),
    )

  const notifyPending = () => onPendingChange(hasPending())

  const hasLocalChanges = (trackerId) =>
    Boolean(
      trackerId &&
        (queuedPayloads[trackerId] || inFlight[trackerId] || latestDraftKeys[trackerId]),
    )

  const scheduleDraftWrite = (trackerId, draft, draftKey) => {
    latestDraftKeys[trackerId] = draftKey
    clearScheduled(draftWriteTimers, trackerId)
    draftWriteTimers[trackerId] = setTimeout(() => {
      draftStorage.write(trackerId, draft)
      draftWriteTimers[trackerId] = null
    }, DRAFT_DELAY)
  }

  const maybeClearDraft = (trackerId, payloadKey) => {
    if (!payloadKey || hasPendingForTracker(trackerId)) return
    if (latestDraftKeys[trackerId] !== payloadKey) return
    clearScheduled(draftWriteTimers, trackerId)
    draftStorage.clear(trackerId)
    delete latestDraftKeys[trackerId]
    onDraftCleared(trackerId)
  }

  async function flush(trackerId) {
    if (!trackerId || inFlight[trackerId]) return
    const queued = queuedPayloads[trackerId]
    if (!queued) {
      notifyPending()
      return
    }

    clearScheduled(saveTimers, trackerId)
    queuedPayloads[trackerId] = null
    inFlight[trackerId] = true
    notifyPending()

    const { payload, payloadKey } = queued
    const knownTs = getKnownUpdatedAt(trackerId)
    const { data, error } = await persistPage(trackerId, payload, knownTs)
    inFlight[trackerId] = false

    const outcome = classifySaveResult({ data, error, knownTs })
    if (outcome.kind === 'conflict') {
      const serverRow = await fetchServerPage(trackerId)
      const conflict = serverRow
        ? detectConflict(trackerId, serverRow, {
            ts: Date.parse(payload.updated_at) || Date.now(),
            content: payload.content,
            title: payload.title,
          })
        : null
      if (conflict) {
        clearScheduled(retryTimers, trackerId)
        if (serverRow.updated_at) setKnownUpdatedAt(trackerId, serverRow.updated_at)
        onStatusChange(trackerId, 'Conflict')
        onConflict(conflict)
        notifyPending()
        return
      }
      if (serverRow?.updated_at) setKnownUpdatedAt(trackerId, serverRow.updated_at)
    } else if (outcome.kind === 'error') {
      queuedPayloads[trackerId] ||= queued
      if (!retryTimers[trackerId]) {
        retryTimers[trackerId] = setTimeout(() => {
          retryTimers[trackerId] = null
          void flush(trackerId)
          notifyPending()
        }, RETRY_DELAY)
      }
      onError(outcome.error?.message ?? 'Save failed')
      onStatusChange(trackerId, 'Error')
      notifyPending()
      return
    } else if (outcome.nextKnownTs) {
      setKnownUpdatedAt(trackerId, outcome.nextKnownTs)
    }

    clearScheduled(retryTimers, trackerId)
    onSaved({ trackerId, payload, outcome })
    onStatusChange(trackerId, 'Saved')
    maybeClearDraft(trackerId, payloadKey)

    if (queuedPayloads[trackerId]) setTimeout(() => void flush(trackerId), 0)
    notifyPending()
  }

  const schedule = ({ trackerId, payload, payloadKey }) => {
    scheduleDraftWrite(
      trackerId,
      { title: payload.title, content: payload.content, ts: Date.now() },
      payloadKey,
    )
    queuedPayloads[trackerId] = { payload, payloadKey }
    clearScheduled(saveTimers, trackerId)
    clearScheduled(retryTimers, trackerId)
    onStatusChange(trackerId, 'Saving...')

    saveTimers[trackerId] = setTimeout(() => {
      saveTimers[trackerId] = null
      void flush(trackerId)
      notifyPending()
    }, SAVE_DELAY)
    notifyPending()
  }

  const flushAll = () => {
    for (const [trackerId, timer] of Object.entries(draftWriteTimers)) {
      if (!timer) continue
      clearScheduled(draftWriteTimers, trackerId)
      const pending = queuedPayloads[trackerId]
      if (pending) {
        draftStorage.write(trackerId, {
          title: pending.payload.title,
          content: pending.payload.content,
          ts: Date.now(),
        })
      }
    }
    for (const [trackerId, timer] of Object.entries(saveTimers)) {
      if (!timer) continue
      clearScheduled(saveTimers, trackerId)
      void flush(trackerId)
    }
    notifyPending()
  }

  const reset = () => {
    saveTimers = {}
    retryTimers = {}
    inFlight = {}
    queuedPayloads = {}
    draftWriteTimers = {}
    latestDraftKeys = {}
    onPendingChange(false)
  }

  const dispose = () => {
    flushAll()
    Object.keys(retryTimers).forEach((trackerId) => clearScheduled(retryTimers, trackerId))
  }

  const discardConflict = (trackerId) => {
    queuedPayloads[trackerId] = null
    clearScheduled(retryTimers, trackerId)
  }

  return {
    schedule,
    flush,
    flushAll,
    reset,
    dispose,
    hasPending,
    hasPendingForTracker,
    hasLocalChanges,
    discardConflict,
  }
}
