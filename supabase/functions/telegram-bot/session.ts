// Idle-window session + turn persistence.
//
// The pure decision `shouldReuseSession` has no Deno / jsr imports and is
// unit-tested. The DB helpers take the Supabase client as a parameter (rather
// than importing it), so this module stays importable under Vitest too.

// Minimal shape of the Supabase client methods we use, to avoid a jsr import here.
type SupabaseLike = {
  from: (table: string) => any
}

export type Turn = { role: 'user' | 'assistant'; content: string }

/**
 * Continue the same conversation if the last activity was within the idle window.
 */
export function shouldReuseSession(
  lastActivityAt: string | Date | number | null | undefined,
  now: Date,
  idleMinutes: number,
): boolean {
  if (lastActivityAt === null || lastActivityAt === undefined) return false
  const last =
    typeof lastActivityAt === 'string'
      ? Date.parse(lastActivityAt)
      : lastActivityAt instanceof Date
        ? lastActivityAt.getTime()
        : Number(lastActivityAt)
  if (Number.isNaN(last)) return false
  return now.getTime() - last <= idleMinutes * 60 * 1000
}

/**
 * Find the chat's most recent active session and reuse it if still within the
 * idle window (bumping last_activity_at); otherwise start a fresh session.
 */
export async function resolveSession(
  supabase: SupabaseLike,
  userId: string,
  chatId: number,
  idleMinutes: number,
  now: Date,
): Promise<string> {
  const { data: existing } = await supabase
    .from('bot_sessions')
    .select('id, last_activity_at')
    .eq('telegram_chat_id', chatId)
    .eq('status', 'active')
    .order('last_activity_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existing && shouldReuseSession(existing.last_activity_at, now, idleMinutes)) {
    await supabase
      .from('bot_sessions')
      .update({ last_activity_at: now.toISOString() })
      .eq('id', existing.id)
    return existing.id
  }

  const { data: created, error } = await supabase
    .from('bot_sessions')
    .insert({ user_id: userId, telegram_chat_id: chatId, last_activity_at: now.toISOString() })
    .select('id')
    .single()

  if (error || !created) throw new Error(`Failed to create session: ${error?.message ?? 'unknown'}`)
  return created.id
}

/** Load the last N turns of a session, oldest first (for the model's context). */
export async function loadRecentTurns(
  supabase: SupabaseLike,
  sessionId: string,
  maxTurns: number,
): Promise<Turn[]> {
  const { data } = await supabase
    .from('bot_messages')
    .select('role, content')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(maxTurns)

  const rows = (data ?? []) as Turn[]
  return rows.reverse()
}

/**
 * Persist the inbound user turn. Returns { duplicate: true } when this exact
 * Telegram message was already recorded (unique-index 23505) — the caller
 * should then stop, since the update was already processed.
 */
export async function persistUserTurn(
  supabase: SupabaseLike,
  sessionId: string,
  content: string,
  telegramMessageId: number,
): Promise<{ duplicate: boolean }> {
  const { error } = await supabase
    .from('bot_messages')
    .insert({
      session_id: sessionId,
      role: 'user',
      content,
      telegram_message_id: telegramMessageId,
    })

  if (error) {
    if (error.code === '23505') return { duplicate: true }
    throw new Error(`Failed to persist user turn: ${error.message}`)
  }
  return { duplicate: false }
}

/** Persist the assistant's reply. */
export async function persistAssistantTurn(
  supabase: SupabaseLike,
  sessionId: string,
  content: string,
): Promise<void> {
  await supabase
    .from('bot_messages')
    .insert({ session_id: sessionId, role: 'assistant', content })
}

/** Close the active session for a chat (used by /new). */
export async function closeActiveSessions(
  supabase: SupabaseLike,
  chatId: number,
): Promise<void> {
  await supabase
    .from('bot_sessions')
    .update({ status: 'closed' })
    .eq('telegram_chat_id', chatId)
    .eq('status', 'active')
}
