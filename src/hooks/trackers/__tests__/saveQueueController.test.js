import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectConflict } from '../../../utils/draftHelpers'
import { classifySaveResult } from '../../../utils/saveConflict'
import { createSaveQueueController } from '../saveQueueController'

const payload = (title, text, updatedAt = '2026-08-09T12:00:00.000Z') => ({
  title,
  content: { type: 'doc', content: [{ type: 'paragraph', text }] },
  updated_at: updatedAt,
})

const makeController = (overrides = {}) => {
  const knownTimestamps = { 'page-a': 'server-old-a', 'page-b': 'server-old-b' }
  const persistPage = overrides.persistPage ??
    vi.fn(async (_trackerId, _payload, knownTs) => ({
      data: { updated_at: `${knownTs}-next` },
      error: null,
    }))
  const callbacks = {
    writeDraft: vi.fn(),
    clearDraft: vi.fn(),
    onPendingChange: vi.fn(),
    onStatusChange: vi.fn(),
    onConflict: vi.fn(),
    onError: vi.fn(),
    onSaved: vi.fn(),
    onActiveDraftCleared: vi.fn(),
  }
  const controller = createSaveQueueController({
    persistPage,
    fetchServerPage: overrides.fetchServerPage ?? vi.fn(async () => null),
    classifyResult: classifySaveResult,
    detectConflict,
    getKnownUpdatedAt: (trackerId) => knownTimestamps[trackerId] ?? null,
    setKnownUpdatedAt: (trackerId, timestamp) => {
      knownTimestamps[trackerId] = timestamp
    },
    getActiveTrackerId: () => overrides.activeTrackerId ?? 'page-a',
    getOldContent: () => ({ type: 'doc', content: [] }),
    ...callbacks,
  })
  return { controller, persistPage, knownTimestamps, ...callbacks }
}

const schedule = (controller, trackerId, nextPayload) => {
  const payloadKey = JSON.stringify(nextPayload)
  controller.schedule({
    trackerId,
    payload: nextPayload,
    payloadKey,
    draft: {
      title: nextPayload.title,
      content: nextPayload.content,
      ts: Date.now(),
    },
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
    const { controller, writeDraft, clearDraft, onActiveDraftCleared } = makeController()
    const nextPayload = payload('Draft', 'body')

    schedule(controller, 'page-a', nextPayload)
    await vi.advanceTimersByTimeAsync(250)
    expect(writeDraft).toHaveBeenCalledWith(
      'page-a',
      expect.objectContaining({ title: 'Draft', content: nextPayload.content }),
    )

    await vi.advanceTimersByTimeAsync(1750)
    expect(clearDraft).toHaveBeenCalledWith('page-a')
    expect(onActiveDraftCleared).toHaveBeenCalledTimes(1)
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
    expect(persistPage.mock.calls.map(([trackerId]) => trackerId).sort()).toEqual([
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
      expect.objectContaining({ trackerId: 'page-a', serverTitle: 'Remote' }),
    )
    expect(onStatusChange).toHaveBeenLastCalledWith('Conflict')
    expect(onError).not.toHaveBeenCalled()
  })
})
