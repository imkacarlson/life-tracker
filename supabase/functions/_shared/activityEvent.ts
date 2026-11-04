// Server-side writer for public.activity_events, so bot and reminder activity
// lands on the same timeline as the web app's (src/lib/activityLog.js).
//
// Edge functions use the service-role client, so auth.uid() is null and the
// row's user_id must be passed explicitly.

// deno-lint-ignore no-explicit-any
type SupabaseLike = { from: (table: string) => any }

const MAX_TEXT = 1000

export const truncateText = (value: unknown, max = MAX_TEXT): string => {
  const text = String(value ?? '')
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/**
 * Record one event. Never throws: logging must not break the bot or a reminder
 * send.
 *
 * @param sessionId groups related events (the bot conversation id, or one id
 *   per reminder run).
 */
export async function logServerActivity(
  supabase: SupabaseLike,
  {
    userId,
    sessionId,
    eventType,
    pageId = null,
    data = {},
  }: {
    userId: string
    sessionId: string
    eventType: string
    pageId?: string | null
    data?: Record<string, unknown>
  },
): Promise<void> {
  try {
    const { error } = await supabase.from('activity_events').insert({
      user_id: userId,
      session_id: sessionId,
      occurred_at: new Date().toISOString(),
      device: 'telegram',
      event_type: eventType,
      page_id: pageId,
      data,
    })
    if (error) console.error('activity log insert failed:', error.message)
  } catch (err) {
    console.error('activity log insert failed:', String(err))
  }
}
