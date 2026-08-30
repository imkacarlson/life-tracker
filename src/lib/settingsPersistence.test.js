import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getAccessTokenSync: vi.fn(),
  from: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
}))

vi.mock('./supabase', () => ({
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
  getAccessTokenSync: mocks.getAccessTokenSync,
  supabase: { from: mocks.from },
}))

import { persistSportsScoresEnabled } from './settingsPersistence'

describe('persistSportsScoresEnabled', () => {
  beforeEach(() => {
    mocks.getAccessTokenSync.mockReturnValue('access-token')
    mocks.eq.mockResolvedValue({ error: null })
    mocks.update.mockReturnValue({ eq: mocks.eq })
    mocks.from.mockReturnValue({ update: mocks.update })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('uses a keepalive PATCH that can survive navigation', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    const result = await persistSportsScoresEnabled(
      'settings/id',
      false,
      '2026-08-29T21:00:00.000Z',
    )

    expect(result).toEqual({ error: null })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.supabase.co/rest/v1/settings?id=eq.settings%2Fid',
      expect.objectContaining({
        method: 'PATCH',
        keepalive: true,
        headers: expect.objectContaining({
          apikey: 'anon-key',
          Authorization: 'Bearer access-token',
        }),
        body: JSON.stringify({
          sports_scores_enabled: false,
          updated_at: '2026-08-29T21:00:00.000Z',
        }),
      }),
    )
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('falls back to supabase-js until the synchronous auth token is ready', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    mocks.getAccessTokenSync.mockReturnValue(null)

    const result = await persistSportsScoresEnabled(
      'settings-id',
      true,
      '2026-08-29T21:00:00.000Z',
    )

    expect(result).toEqual({ error: null })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mocks.from).toHaveBeenCalledWith('settings')
    expect(mocks.update).toHaveBeenCalledWith({
      sports_scores_enabled: true,
      updated_at: '2026-08-29T21:00:00.000Z',
    })
    expect(mocks.eq).toHaveBeenCalledWith('id', 'settings-id')
  })

  it('returns a useful error when PostgREST rejects the update', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: vi.fn().mockResolvedValue('permission denied'),
      }),
    )

    const result = await persistSportsScoresEnabled(
      'settings-id',
      true,
      '2026-08-29T21:00:00.000Z',
    )

    expect(result.error?.message).toBe('permission denied')
  })
})
