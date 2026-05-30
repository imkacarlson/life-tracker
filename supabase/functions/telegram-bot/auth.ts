// Pure auth helper (no Deno / jsr imports) so it can be unit-tested.

/**
 * The bot only ever serves its single allowed user, and only in that user's own
 * private chat. In a Telegram private chat, chat.id === from.id, so we require
 * BOTH to equal the allowed id. This also pins the reply destination: even a
 * forged update (with a stolen webhook secret) cannot redirect tracker data to
 * another chat, because we never act on — or reply to — a mismatched chat.
 */
export function isAuthorized(
  fromId: number | string | null | undefined,
  chatId: number | string | null | undefined,
  allowedId: number | string | null | undefined,
): boolean {
  if (allowedId === null || allowedId === undefined || allowedId === '') return false
  return String(fromId) === String(allowedId) && String(chatId) === String(allowedId)
}
