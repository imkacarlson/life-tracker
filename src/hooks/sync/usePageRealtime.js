import { useEffect } from 'react'
import { supabase } from '../../lib/supabase'

/**
 * Subscribe to Postgres realtime UPDATE events for a single active page.
 *
 * The handler fires whenever a different device writes the row. The caller
 * decides what to do:
 *   - editor is clean -> swap content in, advance OCC token
 *   - editor is dirty -> just remember the new server version so the next
 *     save attempt enters the conflict gate immediately
 *
 * Echoes of our own writes are filtered upstream by comparing
 * `payload.new.updated_at` to the token we just stored.
 *
 * @param {string|null} pageId       The active page id, or null to unsubscribe.
 * @param {(payload: { new: { id: string, content: unknown, updated_at: string, title: string } }) => void} onRemoteChange
 */
export function usePageRealtime(pageId, onRemoteChange) {
  useEffect(() => {
    if (!pageId) return
    const channel = supabase
      .channel(`page:${pageId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'pages', filter: `id=eq.${pageId}` },
        (payload) => {
          if (payload?.new) onRemoteChange(payload)
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [pageId, onRemoteChange])
}
