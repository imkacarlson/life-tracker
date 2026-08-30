import {
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
  getAccessTokenSync,
  supabase,
} from './supabase'

const persistWithSupabaseClient = (settingsId, payload) =>
  supabase.from('settings').update(payload).eq('id', settingsId)

/**
 * Persist the sports-alert switch with a keepalive request so a reload or tab
 * close cannot cancel the write after the optimistic UI has already changed.
 * Falls back to supabase-js if the synchronous auth token is not ready yet.
 */
export const persistSportsScoresEnabled = async (settingsId, nextEnabled, updatedAt) => {
  const payload = {
    sports_scores_enabled: nextEnabled,
    updated_at: updatedAt,
  }
  const token = getAccessTokenSync()

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !token || typeof fetch !== 'function') {
    return persistWithSupabaseClient(settingsId, payload)
  }

  const url = `${SUPABASE_URL}/rest/v1/settings?id=eq.${encodeURIComponent(settingsId)}`

  try {
    const response = await fetch(url, {
      method: 'PATCH',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(payload),
    })

    if (response.ok) return { error: null }

    const detail = await response.text().catch(() => '')
    return { error: new Error(detail || `Settings update failed (${response.status})`) }
  } catch (error) {
    return { error: error instanceof Error ? error : new Error('Settings update failed') }
  }
}
