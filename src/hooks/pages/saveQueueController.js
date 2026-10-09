import { detectSaveConflict } from '../../utils/draftHelpers'
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
  // Optional: a synchronous variant of persistPage used only by flushAll().
  // Returns false when it declines the payload; otherwise it has dispatched the
  // save and may return a promise of 'delivered' | 'rejected' | 'failed' that
  // settles if the tab lives long enough to hear back (see useSaveQueue).
  persistPageBeacon = null,
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
  // pageId -> promise that settles once we know what happened to a beacon save.
  let beaconAcks = {}

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
        ? detectSaveConflict(pageId, serverRow, {
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

  /**
   * Hand a pending save to the keepalive transport so it survives the tab dying.
   * Used only by flushAll(); normal debounced saves keep the awaited path.
   *
   * The dispatch is fire-and-forget, so treat it as a presumed success: advance
   * the known timestamp the way a real save would, or a tab that comes back from
   * `visibilitychange` would re-save against a stale updated_at and trip the
   * conflict path against its own write. If the request really did die, the
   * localStorage draft flushAll() just wrote is the backstop — and on next load
   * detectConflict() silently drops a draft whose content already matches the
   * server, so a beacon that succeeded costs nothing.
   *
   * When the tab survives (the usual case for a phone app that was only swiped
   * away), the beacon's answer arrives later and handleBeaconAck() settles it.
   *
   * Returns false when the save was not dispatched and the caller should fall
   * back to flush().
   */
  const sendBeacon = (pageId) => {
    if (!persistPageBeacon || inFlight[pageId]) return false
    const queued = queuedPayloads[pageId]
    if (!queued) return false

    const { payload } = queued
    const knownTs = getKnownUpdatedAt(pageId)
    const dispatched = persistPageBeacon(pageId, payload, knownTs)
    if (!dispatched) return false

    queuedPayloads[pageId] = null
    clearScheduled(retryTimers, pageId)
    if (payload.updated_at) setKnownUpdatedAt(pageId, payload.updated_at)
    onSaved({ pageId, payload, outcome: { kind: 'saved', nextKnownTs: payload.updated_at } })
    onStatusChange(pageId, 'Saved')
    // Deliberately not maybeClearDraft() yet: the draft is what makes an
    // undelivered beacon recoverable. handleBeaconAck clears it once we know.
    if (typeof dispatched?.then === 'function') {
      const ack = dispatched
        .then((result) => handleBeaconAck(pageId, queued, knownTs, result))
        .catch(() => handleBeaconAck(pageId, queued, knownTs, 'failed'))
        .finally(() => {
          if (beaconAcks[pageId] === ack) delete beaconAcks[pageId]
        })
      beaconAcks[pageId] = ack
    }
    return true
  }

  /**
   * Settle a beacon save once its response comes back.
   *
   *   delivered -> the server has it; drop the backstop draft so this device
   *                counts as clean and can take in edits from other devices.
   *   rejected  -> another device wrote first (version check matched nothing).
   *   failed    -> the request never landed.
   *
   * For the last two, undo the optimistic version bump and put the payload back
   * in the queue: a rejected save then surfaces as a conflict, a failed one
   * retries like any other failed save.
   */
  const handleBeaconAck = (pageId, queued, previousTs, result) => {
    const { payload, payloadKey } = queued
    if (result === 'delivered') {
      maybeClearDraft(pageId, payloadKey)
      return
    }
    if (result !== 'rejected' && result !== 'failed') return
    // Only rewind if nothing has saved since; a newer save already moved on.
    if (getKnownUpdatedAt(pageId) === payload.updated_at) {
      setKnownUpdatedAt(pageId, previousTs)
    }
    if (!queuedPayloads[pageId] && !inFlight[pageId]) {
      queuedPayloads[pageId] = queued
    }
    void flush(pageId)
  }

  /**
   * Resolve once any outstanding beacon for this page has been settled (or
   * immediately when there is none). The resume path waits on this so it knows
   * whether this device still has unsaved work before pulling in remote edits.
   */
  const settleBeacon = (pageId) => beaconAcks[pageId] ?? Promise.resolve()

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
      if (!sendBeacon(pageId)) void flush(pageId)
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
    beaconAcks = {}
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
    settleBeacon,
  }
}
