const DEFAULT_DELAYS = {
  draft: 250,
  save: 2000,
  retry: 5000,
}

export function createSaveQueueController({
  persistPage,
  fetchServerPage,
  classifyResult,
  detectConflict,
  getKnownUpdatedAt,
  setKnownUpdatedAt,
  getActiveTrackerId,
  getOldContent,
  writeDraft,
  clearDraft,
  onPendingChange,
  onStatusChange,
  onConflict,
  onError,
  onSaved,
  onActiveDraftCleared,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  now = Date.now,
  delays = DEFAULT_DELAYS,
}) {
  let saveTimers = {}
  let retryTimers = {}
  let inFlight = {}
  let queuedPayloads = {}
  let draftWriteTimers = {}
  let latestDraftKeys = {}
  let pendingTitles = {}

  const isActive = (trackerId) => trackerId === getActiveTrackerId()

  const hasPendingForTracker = (trackerId) => {
    if (!trackerId) return false
    return Boolean(
      saveTimers[trackerId] ||
        retryTimers[trackerId] ||
        inFlight[trackerId] ||
        queuedPayloads[trackerId],
    )
  }

  const hasPending = () => {
    const ids = new Set([
      ...Object.keys(saveTimers),
      ...Object.keys(retryTimers),
      ...Object.keys(inFlight),
      ...Object.keys(queuedPayloads),
    ])
    return Array.from(ids).some(hasPendingForTracker)
  }

  const notifyPending = () => {
    const next = hasPending()
    onPendingChange(next)
    return next
  }

  const hasLocalChanges = (trackerId) =>
    Boolean(
      trackerId &&
        (queuedPayloads[trackerId] || inFlight[trackerId] || latestDraftKeys[trackerId]),
    )

  const scheduleLocalDraftWrite = (trackerId, draft, draftKey) => {
    latestDraftKeys[trackerId] = draftKey
    const existingTimer = draftWriteTimers[trackerId]
    if (existingTimer) clearTimer(existingTimer)
    draftWriteTimers[trackerId] = setTimer(() => {
      writeDraft(trackerId, draft)
      draftWriteTimers[trackerId] = null
    }, delays.draft)
  }

  const maybeClearLocalDraft = (trackerId, payloadKey) => {
    if (!trackerId || !payloadKey || hasPendingForTracker(trackerId)) return
    const latestKey = latestDraftKeys[trackerId]
    if (!latestKey || latestKey !== payloadKey) return
    const existingTimer = draftWriteTimers[trackerId]
    if (existingTimer) {
      clearTimer(existingTimer)
      draftWriteTimers[trackerId] = null
    }
    clearDraft(trackerId)
    delete latestDraftKeys[trackerId]
    if (isActive(trackerId)) onActiveDraftCleared()
  }

  async function flush(trackerId) {
    if (!trackerId || inFlight[trackerId]) return
    const queued = queuedPayloads[trackerId]
    if (!queued) {
      notifyPending()
      return
    }

    const saveTimer = saveTimers[trackerId]
    if (saveTimer) {
      clearTimer(saveTimer)
      saveTimers[trackerId] = null
    }

    queuedPayloads[trackerId] = null
    inFlight[trackerId] = true
    notifyPending()

    const { payload, payloadKey } = queued
    const oldContent = getOldContent(trackerId)
    const knownTs = getKnownUpdatedAt(trackerId)
    const { data, error } = await persistPage(trackerId, payload, knownTs)
    inFlight[trackerId] = false

    const outcome = classifyResult({ data, error, knownTs })
    if (outcome.kind === 'conflict') {
      const serverRow = await fetchServerPage(trackerId)
      const conflictDescriptor = serverRow
        ? detectConflict(trackerId, serverRow, {
            ts: Date.parse(payload.updated_at) || now(),
            content: payload.content,
            title: payload.title,
          })
        : null
      if (conflictDescriptor) {
        const retryTimer = retryTimers[trackerId]
        if (retryTimer) {
          clearTimer(retryTimer)
          retryTimers[trackerId] = null
        }
        if (serverRow?.updated_at) setKnownUpdatedAt(trackerId, serverRow.updated_at)
        if (isActive(trackerId)) onStatusChange('Conflict')
        onConflict(conflictDescriptor)
        notifyPending()
        return
      }
      if (serverRow?.updated_at) setKnownUpdatedAt(trackerId, serverRow.updated_at)
    } else if (outcome.kind === 'error') {
      if (!queuedPayloads[trackerId]) {
        queuedPayloads[trackerId] = queued
      }
      if (!retryTimers[trackerId]) {
        retryTimers[trackerId] = setTimer(() => {
          retryTimers[trackerId] = null
          void flush(trackerId)
          notifyPending()
        }, delays.retry)
      }
      onError(outcome.error?.message ?? 'Save failed')
      if (isActive(trackerId)) onStatusChange('Error')
      notifyPending()
      return
    } else if (outcome.kind === 'ok' && outcome.nextKnownTs) {
      setKnownUpdatedAt(trackerId, outcome.nextKnownTs)
    }

    const retryTimer = retryTimers[trackerId]
    if (retryTimer) {
      clearTimer(retryTimer)
      retryTimers[trackerId] = null
    }
    if (pendingTitles[trackerId] === payload.title) {
      delete pendingTitles[trackerId]
    }

    onSaved({ trackerId, payload, outcome, oldContent })
    if (isActive(trackerId)) onStatusChange('Saved')
    maybeClearLocalDraft(trackerId, payloadKey)

    if (queuedPayloads[trackerId]) {
      setTimer(() => void flush(trackerId), 0)
    }
    notifyPending()
  }

  const schedule = ({ trackerId, payload, payloadKey, draft }) => {
    scheduleLocalDraftWrite(trackerId, draft, payloadKey)
    queuedPayloads[trackerId] = { payload, payloadKey }

    const existingTimer = saveTimers[trackerId]
    if (existingTimer) clearTimer(existingTimer)
    const retryTimer = retryTimers[trackerId]
    if (retryTimer) {
      clearTimer(retryTimer)
      retryTimers[trackerId] = null
    }
    if (isActive(trackerId)) onStatusChange('Saving...')

    saveTimers[trackerId] = setTimer(() => {
      saveTimers[trackerId] = null
      void flush(trackerId)
      notifyPending()
    }, delays.save)
    notifyPending()
  }

  const flushAllPendingDrafts = () => {
    for (const trackerId of Object.keys(draftWriteTimers)) {
      const timer = draftWriteTimers[trackerId]
      if (!timer) continue
      clearTimer(timer)
      draftWriteTimers[trackerId] = null
      const pending = queuedPayloads[trackerId]
      if (pending) {
        writeDraft(trackerId, {
          title: pending.payload.title,
          content: pending.payload.content,
          ts: now(),
        })
      }
    }
  }

  const flushAll = () => {
    flushAllPendingDrafts()
    for (const trackerId of Object.keys(saveTimers)) {
      const timer = saveTimers[trackerId]
      if (!timer) continue
      clearTimer(timer)
      saveTimers[trackerId] = null
      void flush(trackerId)
    }
    notifyPending()
  }

  const reset = () => {
    pendingTitles = {}
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
    Object.values(retryTimers).forEach((timer) => {
      if (timer) clearTimer(timer)
    })
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
    getPendingTitle: (trackerId) => pendingTitles[trackerId],
    setPendingTitle: (trackerId, title) => {
      pendingTitles[trackerId] = title
    },
    clearPendingTitle: (trackerId) => {
      delete pendingTitles[trackerId]
    },
    discardConflict: (trackerId) => {
      queuedPayloads[trackerId] = null
      const retryTimer = retryTimers[trackerId]
      if (retryTimer) {
        clearTimer(retryTimer)
        retryTimers[trackerId] = null
      }
    },
  }
}
