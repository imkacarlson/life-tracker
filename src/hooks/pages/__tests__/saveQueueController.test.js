import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSaveQueueController } from '../saveQueueController'

const payload = (title, text, updatedAt = '2026-08-09T12:00:00.000Z') => ({
  title,
  content: { type: 'doc', content: [{ type: 'paragraph', text }] },
  updated_at: updatedAt,
})

const makeController = (overrides = {}) => {
  const knownTimestamps = { 'page-a': 'server-old-a', 'page-b': 'server-old-b' }
  const persistPage = overrides.persistPage ??
    vi.fn(async (_pageId, _payload, knownTs) => ({
      data: { updated_at: `${knownTs}-next` },
      error: null,
    }))
  const callbacks = {
    onPendingChange: vi.fn(),
    onStatusChange: vi.fn(),
    onConflict: vi.fn(),
    onError: vi.fn(),
    onSaved: vi.fn(),
    onDraftCleared: vi.fn(),
  }
  const draftStorage = { write: vi.fn(), clear: vi.fn() }
  const controller = createSaveQueueController({
    persistPage,
    persistPageBeacon: overrides.persistPageBeacon,
    fetchServerPage: overrides.fetchServerPage ?? vi.fn(async () => null),
    getKnownUpdatedAt: (pageId) => knownTimestamps[pageId] ?? null,
    setKnownUpdatedAt: (pageId, timestamp) => {
      knownTimestamps[pageId] = timestamp
    },
    draftStorage,
    ...callbacks,
  })
  return {
    controller,
    persistPage,
    persistPageBeacon: overrides.persistPageBeacon,
    knownTimestamps,
    writeDraft: draftStorage.write,
    clearDraft: draftStorage.clear,
    ...callbacks,
  }
}

const schedule = (controller, pageId, nextPayload) => {
  const payloadKey = JSON.stringify(nextPayload)
  controller.schedule({
    pageId,
    payload: nextPayload,
    payloadKey,
  })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('save queue debounce and drafts', () => {
  it('persists only the latest payload after the debounce window', async () => {
    vi.useFakeTimers()
    const { controller, persistPage } = makeController()
    const first = payload('First', 'one')
    const second = payload('Second', 'two')

    schedule(controller, 'page-a', first)
    await vi.advanceTimersByTimeAsync(1000)
    schedule(controller, 'page-a', second)
    await vi.advanceTimersByTimeAsync(1999)
    expect(persistPage).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    expect(persistPage).toHaveBeenCalledTimes(1)
    expect(persistPage).toHaveBeenCalledWith('page-a', second, 'server-old-a')
  })

  it('writes a local draft at 250 ms and clears it after a successful latest save', async () => {
    vi.useFakeTimers()
    const { controller, writeDraft, clearDraft, onDraftCleared } = makeController()
    const nextPayload = payload('Draft', 'body')

    schedule(controller, 'page-a', nextPayload)
    await vi.advanceTimersByTimeAsync(250)
    expect(writeDraft).toHaveBeenCalledWith(
      'page-a',
      expect.objectContaining({ title: 'Draft', content: nextPayload.content }),
    )

    await vi.advanceTimersByTimeAsync(1750)
    expect(clearDraft).toHaveBeenCalledWith('page-a')
    expect(onDraftCleared).toHaveBeenCalledWith('page-a')
  })

  it('flushes drafts and starts saves immediately for lifecycle events', async () => {
    vi.useFakeTimers()
    const { controller, writeDraft, persistPage } = makeController()
    const nextPayload = payload('Flush', 'body')
    schedule(controller, 'page-a', nextPayload)

    controller.flushAll()
    await vi.runAllTimersAsync()

    expect(writeDraft).toHaveBeenCalledWith(
      'page-a',
      expect.objectContaining({ title: 'Flush', content: nextPayload.content }),
    )
    expect(persistPage).toHaveBeenCalledTimes(1)
  })
})

describe('save queue concurrency and failures', () => {
  it('keeps page queues independent', async () => {
    vi.useFakeTimers()
    const { controller, persistPage } = makeController()
    schedule(controller, 'page-a', payload('A', 'one'))
    schedule(controller, 'page-b', payload('B', 'two'))

    await vi.advanceTimersByTimeAsync(2000)

    expect(persistPage).toHaveBeenCalledTimes(2)
    expect(persistPage.mock.calls.map(([pageId]) => pageId).sort()).toEqual([
      'page-a',
      'page-b',
    ])
  })

  it('retries a failed save after five seconds', async () => {
    vi.useFakeTimers()
    const persistPage = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: new Error('offline') })
      .mockResolvedValueOnce({ data: { updated_at: 'server-new' }, error: null })
    const { controller, onError } = makeController({ persistPage })
    schedule(controller, 'page-a', payload('Retry', 'body'))

    await vi.advanceTimersByTimeAsync(2000)
    expect(persistPage).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith('offline')
    await vi.advanceTimersByTimeAsync(4999)
    expect(persistPage).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(persistPage).toHaveBeenCalledTimes(2)
  })

  it('flushes a newer edit after an in-flight save completes', async () => {
    vi.useFakeTimers()
    let resolveFirst
    const firstSave = new Promise((resolve) => {
      resolveFirst = resolve
    })
    const persistPage = vi
      .fn()
      .mockReturnValueOnce(firstSave)
      .mockResolvedValueOnce({ data: { updated_at: 'server-newest' }, error: null })
    const { controller } = makeController({ persistPage })

    schedule(controller, 'page-a', payload('First', 'one'))
    await vi.advanceTimersByTimeAsync(2000)
    schedule(controller, 'page-a', payload('Second', 'two'))
    await vi.advanceTimersByTimeAsync(2000)
    expect(persistPage).toHaveBeenCalledTimes(1)

    resolveFirst({ data: { updated_at: 'server-new' }, error: null })
    await Promise.resolve()
    await vi.runAllTimersAsync()

    expect(persistPage).toHaveBeenCalledTimes(2)
    expect(persistPage.mock.calls[1][1].title).toBe('Second')
  })

  it('surfaces a real OCC conflict without treating it as retryable', async () => {
    vi.useFakeTimers()
    const localPayload = payload('Local', 'local', '2026-08-09T12:00:00.000Z')
    const serverRow = {
      title: 'Remote',
      content: payload('Remote', 'remote').content,
      updated_at: '2026-08-09T12:01:00.000Z',
    }
    const { controller, onConflict, onError, onStatusChange } = makeController({
      persistPage: vi.fn(async () => ({ data: null, error: null })),
      fetchServerPage: vi.fn(async () => serverRow),
    })

    schedule(controller, 'page-a', localPayload)
    await vi.advanceTimersByTimeAsync(2000)

    expect(onConflict).toHaveBeenCalledWith(
      expect.objectContaining({ pageId: 'page-a', serverTitle: 'Remote' }),
    )
    expect(onStatusChange).toHaveBeenLastCalledWith('page-a', 'Conflict')
    expect(onError).not.toHaveBeenCalled()
  })
})

describe('save-time conflict when the other device wrote earlier by the clock', () => {
  // Regression: the phone held a stale copy, the laptop saved, then the phone
  // typed. The phone's edit is newer than the laptop's write, which used to make
  // the conflict check wave it through and silently overwrite the laptop.
  it('surfaces the conflict instead of reporting the rejected save as saved', async () => {
    vi.useFakeTimers()
    const phoneEdit = payload('Page', 'phone typing', '2026-08-09T12:05:00.000Z')
    const laptopRow = {
      title: 'Page',
      content: payload('Page', 'laptop work').content,
      updated_at: '2026-08-09T12:00:00.000Z',
    }
    const persistPage = vi.fn(async () => ({ data: null, error: null }))
    const { controller, onConflict, onSaved, onStatusChange, clearDraft } = makeController({
      persistPage,
      fetchServerPage: vi.fn(async () => laptopRow),
    })

    schedule(controller, 'page-a', phoneEdit)
    await vi.advanceTimersByTimeAsync(2000)

    expect(onConflict).toHaveBeenCalledWith(
      expect.objectContaining({ pageId: 'page-a', serverContent: laptopRow.content }),
    )
    expect(onSaved).not.toHaveBeenCalled()
    expect(clearDraft).not.toHaveBeenCalled()
    expect(onStatusChange).toHaveBeenLastCalledWith('page-a', 'Conflict')
    expect(persistPage).toHaveBeenCalledTimes(1)
  })
})

describe('beacon acknowledgement', () => {
  const deferred = () => {
    let resolve
    const promise = new Promise((r) => {
      resolve = r
    })
    return { promise, resolve }
  }

  it('drops the backstop draft once the beacon is confirmed delivered', async () => {
    vi.useFakeTimers()
    const ack = deferred()
    const { controller, clearDraft, onDraftCleared } = makeController({
      persistPageBeacon: vi.fn(() => ack.promise),
    })
    schedule(controller, 'page-a', payload('Beacon', 'body'))
    controller.flushAll()

    // Until we hear back, the device still counts as having local changes.
    expect(controller.hasLocalChanges('page-a')).toBe(true)

    ack.resolve('delivered')
    await controller.settleBeacon('page-a')

    expect(clearDraft).toHaveBeenCalledWith('page-a')
    expect(onDraftCleared).toHaveBeenCalledWith('page-a')
    expect(controller.hasLocalChanges('page-a')).toBe(false)
  })

  it('rewinds the version and surfaces a conflict when the beacon was rejected', async () => {
    vi.useFakeTimers()
    const ack = deferred()
    const beaconPayload = payload('Beacon', 'phone', '2026-08-09T12:34:56.000Z')
    const serverRow = {
      title: 'Beacon',
      content: payload('Beacon', 'laptop').content,
      updated_at: '2026-08-09T12:30:00.000Z',
    }
    const persistPage = vi.fn(async () => ({ data: null, error: null }))
    const { controller, knownTimestamps, onConflict } = makeController({
      persistPage,
      persistPageBeacon: vi.fn(() => ack.promise),
      fetchServerPage: vi.fn(async () => serverRow),
    })
    schedule(controller, 'page-a', beaconPayload)
    controller.flushAll()
    expect(knownTimestamps['page-a']).toBe('2026-08-09T12:34:56.000Z')

    ack.resolve('rejected')
    await controller.settleBeacon('page-a')
    await vi.runAllTimersAsync()

    // Re-saved against the version we really had, which surfaces the conflict.
    expect(persistPage).toHaveBeenCalledWith('page-a', beaconPayload, 'server-old-a')
    expect(onConflict).toHaveBeenCalledWith(expect.objectContaining({ pageId: 'page-a' }))
  })

  it('retries through the normal path when the beacon failed', async () => {
    vi.useFakeTimers()
    const ack = deferred()
    const beaconPayload = payload('Beacon', 'body', '2026-08-09T12:34:56.000Z')
    const { controller, persistPage, knownTimestamps } = makeController({
      persistPageBeacon: vi.fn(() => ack.promise),
    })
    schedule(controller, 'page-a', beaconPayload)
    controller.flushAll()

    ack.resolve('failed')
    await controller.settleBeacon('page-a')
    await vi.runAllTimersAsync()

    expect(persistPage).toHaveBeenCalledWith('page-a', beaconPayload, 'server-old-a')
    expect(knownTimestamps['page-a']).toBe('server-old-a-next')
  })

  it('settleBeacon resolves immediately when no beacon is outstanding', async () => {
    const { controller } = makeController()
    await expect(controller.settleBeacon('page-a')).resolves.toBeUndefined()
  })
})

describe('flushAll keepalive beacon', () => {
  it('sends the pending save through the beacon instead of the normal path', async () => {
    vi.useFakeTimers()
    const persistPageBeacon = vi.fn(() => true)
    const { controller, persistPage, knownTimestamps, onStatusChange, onSaved } =
      makeController({ persistPageBeacon })
    const nextPayload = payload('Beacon', 'body', '2026-08-09T12:34:56.000Z')
    schedule(controller, 'page-a', nextPayload)

    controller.flushAll()
    await vi.runAllTimersAsync()

    expect(persistPageBeacon).toHaveBeenCalledWith('page-a', nextPayload, 'server-old-a')
    expect(persistPage).not.toHaveBeenCalled()
    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(onStatusChange).toHaveBeenLastCalledWith('page-a', 'Saved')
    // Advanced optimistically so a tab that comes back does not conflict with
    // its own beacon.
    expect(knownTimestamps['page-a']).toBe('2026-08-09T12:34:56.000Z')
  })

  it('leaves the localStorage draft in place as the backstop', async () => {
    vi.useFakeTimers()
    const { controller, writeDraft, clearDraft } = makeController({
      persistPageBeacon: vi.fn(() => true),
    })
    schedule(controller, 'page-a', payload('Beacon', 'body'))

    controller.flushAll()
    await vi.runAllTimersAsync()

    expect(writeDraft).toHaveBeenCalledWith('page-a', expect.objectContaining({ title: 'Beacon' }))
    expect(clearDraft).not.toHaveBeenCalled()
  })

  it('falls back to the normal save when the beacon declines the payload', async () => {
    vi.useFakeTimers()
    const persistPageBeacon = vi.fn(() => false)
    const { controller, persistPage } = makeController({ persistPageBeacon })
    const nextPayload = payload('TooBig', 'body')
    schedule(controller, 'page-a', nextPayload)

    controller.flushAll()
    await vi.runAllTimersAsync()

    expect(persistPageBeacon).toHaveBeenCalledTimes(1)
    expect(persistPage).toHaveBeenCalledTimes(1)
    expect(persistPage).toHaveBeenCalledWith('page-a', nextPayload, 'server-old-a')
  })

  it('does not beacon a page whose save is already in flight', async () => {
    vi.useFakeTimers()
    let resolvePersist
    const persistPage = vi.fn(
      () => new Promise((resolve) => {
        resolvePersist = resolve
      }),
    )
    const persistPageBeacon = vi.fn(() => true)
    const { controller } = makeController({ persistPage, persistPageBeacon })
    schedule(controller, 'page-a', payload('InFlight', 'body'))

    // Let the debounce fire so the normal save is mid-request.
    await vi.advanceTimersByTimeAsync(2000)
    expect(persistPage).toHaveBeenCalledTimes(1)

    controller.flushAll()
    expect(persistPageBeacon).not.toHaveBeenCalled()

    resolvePersist({ data: { updated_at: 'next' }, error: null })
    await vi.runAllTimersAsync()
  })
})
