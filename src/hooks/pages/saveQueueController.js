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

  const clearScheduled = (timers, pageId) => {
    if (!timers[pageId]) return
    clearTimeout(timers[pageId])
    timers[pageId] = null
  }

  const hasPendingForPage = (pageId) =>
    Boolean(
      pageId &&
        (saveTimers[pageId] ||
          retryTimers[pageId] ||
          inFlight[pageId] ||
          queuedPayloads[pageId]),
    )

  const hasPending = () =>
    [saveTimers, retryTimers, inFlight, queuedPayloads].some((entries) =>
      Object.values(entries).some(Boolean),
    )

  const notifyPending = () => onPendingChange(hasPending())

  const hasLocalChanges = (pageId) =>
    Boolean(
      pageId &&
        (queuedPayloads[pageId] || inFlight[pageId] || latestDraftKeys[pageId]),
    )

  const scheduleDraftWrite = (pageId, draft, draftKey) => {
    latestDraftKeys[pageId] = draftKey
    clearScheduled(draftWriteTimers, pageId)
    draftWriteTimers[pageId] = setTimeout(() => {
      draftStorage.write(pageId, draft)
      draftWriteTimers[pageId] = null
    }, DRAFT_DELAY)
  }

  const maybeClearDraft = (pageId, payloadKey) => {
    if (!payloadKey || hasPendingForPage(pageId)) return
    if (latestDraftKeys[pageId] !== payloadKey) return
    clearScheduled(draftWriteTimers, pageId)
    draftStorage.clear(pageId)
    delete latestDraftKeys[pageId]
    onDraftCleared(pageId)
  }

  async function flush(pageId) {
    if (!pageId || inFlight[pageId]) return
    const queued = queuedPayloads[pageId]
    if (!queued) {
      notifyPending()
      return
    }

    clearScheduled(saveTimers, pageId)
    queuedPayloads[pageId] = null
    inFlight[pageId] = true
    notifyPending()

    const { payload, payloadKey } = queued
    const knownTs = getKnownUpdatedAt(pageId)
    const { data, error } = await persistPage(pageId, payload, knownTs)
    inFlight[pageId] = false

    const outcome = classifySaveResult({ data, error, knownTs })
    if (outcome.kind === 'conflict') {
      const serverRow = await fetchServerPage(pageId)
      const conflict = serverRow
        ? detectConflict(pageId, serverRow, {
            ts: Date.parse(payload.updated_at) || Date.now(),
            content: payload.content,
            title: payload.title,
          })
        : null
      if (conflict) {
        clearScheduled(retryTimers, pageId)
        if (serverRow.updated_at) setKnownUpdatedAt(pageId, serverRow.updated_at)
        onStatusChange(pageId, 'Conflict')
        onConflict(conflict)
        notifyPending()
        return
      }
      if (serverRow?.updated_at) setKnownUpdatedAt(pageId, serverRow.updated_at)
    } else if (outcome.kind === 'error') {
      queuedPayloads[pageId] ||= queued
      if (!retryTimers[pageId]) {
        retryTimers[pageId] = setTimeout(() => {
          retryTimers[pageId] = null
          void flush(pageId)
          notifyPending()
        }, RETRY_DELAY)
      }
      onError(outcome.error?.message ?? 'Save failed')
      onStatusChange(pageId, 'Error')
      notifyPending()
      return
    } else if (outcome.nextKnownTs) {
      setKnownUpdatedAt(pageId, outcome.nextKnownTs)
    }

    clearScheduled(retryTimers, pageId)
    onSaved({ pageId, payload, outcome })
    onStatusChange(pageId, 'Saved')
    maybeClearDraft(pageId, payloadKey)

    if (queuedPayloads[pageId]) setTimeout(() => void flush(pageId), 0)
    notifyPending()
  }

  const schedule = ({ pageId, payload, payloadKey }) => {
    scheduleDraftWrite(
      pageId,
      { title: payload.title, content: payload.content, ts: Date.now() },
      payloadKey,
    )
    queuedPayloads[pageId] = { payload, payloadKey }
    clearScheduled(saveTimers, pageId)
    clearScheduled(retryTimers, pageId)
    onStatusChange(pageId, 'Saving...')

    saveTimers[pageId] = setTimeout(() => {
      saveTimers[pageId] = null
      void flush(pageId)
      notifyPending()
    }, SAVE_DELAY)
    notifyPending()
  }

  const flushAll = () => {
    for (const [pageId, timer] of Object.entries(draftWriteTimers)) {
      if (!timer) continue
      clearScheduled(draftWriteTimers, pageId)
      const pending = queuedPayloads[pageId]
      if (pending) {
        draftStorage.write(pageId, {
          title: pending.payload.title,
          content: pending.payload.content,
          ts: Date.now(),
        })
      }
    }
    for (const [pageId, timer] of Object.entries(saveTimers)) {
      if (!timer) continue
      clearScheduled(saveTimers, pageId)
      void flush(pageId)
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
    Object.keys(retryTimers).forEach((pageId) => clearScheduled(retryTimers, pageId))
  }

  const discardConflict = (pageId) => {
    queuedPayloads[pageId] = null
    clearScheduled(retryTimers, pageId)
  }

  return {
    schedule,
    flush,
    flushAll,
    reset,
    dispose,
    hasPending,
    hasPendingForPage,
    hasLocalChanges,
    discardConflict,
  }
}
