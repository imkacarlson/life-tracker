// Pure formatting helpers (no Deno / jsr imports) so they can be unit-tested.

/**
 * Split text into chunks no longer than `max`, preferring to break on paragraph
 * boundaries, then line breaks, then spaces, and only hard-cutting as a last
 * resort. We split BEFORE applying Telegram formatting so we never slice through
 * a formatting entity.
 */
export function splitMessage(text: string | null | undefined, max = 4096): string[] {
  const result: string[] = []
  let remaining = (text ?? '').trim()
  if (!remaining) return []

  while (remaining.length > max) {
    // Prefer a newline boundary within the window, else a space, else hard cut.
    let cut = remaining.lastIndexOf('\n', max)
    if (cut <= 0) cut = remaining.lastIndexOf(' ', max)
    if (cut <= 0) cut = max

    const chunk = remaining.slice(0, cut).trim()
    if (chunk) result.push(chunk)
    remaining = remaining.slice(cut).trim()
  }

  if (remaining) result.push(remaining)
  return result
}
