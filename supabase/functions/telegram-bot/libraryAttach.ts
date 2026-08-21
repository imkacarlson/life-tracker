// Attaching full text to a capture after the fact.
//
// Some sources can't be fetched server-side — a paywalled article the user has a
// subscription to, a page behind a login. The workaround that needs no browser
// extension: the user selects all, copies, and quote-replies to the capture's
// "Saved 📚" message with the text. That message's id is stored on
// library_sources.telegram_message_id at confirm time, which is what makes the
// lookup a single query — the same mechanism bot_preview_jobs.preview_message_id
// already uses for proposals.
//
// Telegram caps a message at 4096 characters, so a long paste arrives as a .txt
// DOCUMENT rather than text. That is why the bot needs a document handler at
// all; before this there were none, and a document, photo, or voice message fell
// through in complete silence with no reply.

type SupabaseLike = { from: (table: string) => any }

export type AttachTarget = {
  page_id: string
  title: string
  hasText: boolean
}

/** Find the capture whose confirmation message the user quote-replied to. */
export async function findCaptureByMessageId(
  supabase: SupabaseLike,
  userId: string,
  messageId: number | null | undefined,
): Promise<AttachTarget | null> {
  if (!messageId) return null

  const { data: source } = await supabase
    .from('library_sources')
    .select('page_id, source_text')
    .eq('user_id', userId)
    .eq('telegram_message_id', messageId)
    .maybeSingle()
  if (!source?.page_id) return null

  const { data: page } = await supabase
    .from('pages')
    .select('title')
    .eq('id', source.page_id)
    .maybeSingle()

  return {
    page_id: source.page_id,
    title: page?.title ?? 'that capture',
    hasText: Boolean(source.source_text),
  }
}

/**
 * Store pasted text as the capture's source text.
 *
 * Writes ONLY to library_sources — never to the page. The capture page holds the
 * user's own notes and a model-written summary; the full text is what search
 * reads, and putting 10 KB of article into pages.content would ship it through
 * the autosave queue on every ~2s debounce.
 */
export async function attachSourceText(
  supabase: SupabaseLike,
  pageId: string,
  text: string,
  now: Date,
): Promise<boolean> {
  const clean = String(text ?? '').trim()
  if (!clean) return false

  const { error } = await supabase
    .from('library_sources')
    .update({
      source_text: clean,
      extract_status: 'ok',
      extract_error: null,
      fetched_at: now.toISOString(),
    })
    .eq('page_id', pageId)

  if (error) {
    console.error('attachSourceText error:', error.code ?? error.message)
    return false
  }
  return true
}

// A file decoded as UTF-8 that is actually binary comes back mostly as U+FFFD
// replacement characters and NULs. Built from escapes rather than typed
// literally so the source stays free of control characters.
const BINARY_JUNK_RE = new RegExp('[\\uFFFD\\u0000]', 'g')
const BINARY_JUNK_RATIO = 0.02

/**
 * Download a Telegram document and return its text.
 *
 * Only plain text is accepted. A .docx or a PDF would need a parser each, and
 * decoding a binary format as UTF-8 would store mojibake as though it were the
 * article — the exact failure this whole path exists to avoid.
 */
export async function readTextDocument(
  botToken: string,
  fileId: string,
  maxBytes: number,
): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  try {
    const infoResp = await fetch(
      `https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`,
    )
    const info = await infoResp.json().catch(() => null)
    const path = info?.result?.file_path
    if (!path) return { ok: false, reason: 'Telegram wouldn’t give me that file.' }

    const size = Number(info?.result?.file_size ?? 0)
    if (size > maxBytes) return { ok: false, reason: 'That file is too big for me to read.' }

    const fileResp = await fetch(`https://api.telegram.org/file/bot${botToken}/${path}`)
    if (!fileResp.ok) return { ok: false, reason: 'I couldn’t download that file.' }

    const text = await fileResp.text()
    if (!text.trim()) return { ok: false, reason: 'That file looked empty.' }

    const junk = (text.match(BINARY_JUNK_RE) ?? []).length
    if (junk > text.length * BINARY_JUNK_RATIO) {
      return {
        ok: false,
        reason: 'That doesn’t look like plain text — send a .txt and I’ll read it.',
      }
    }
    return { ok: true, text }
  } catch (err) {
    console.error('readTextDocument error:', String(err))
    return { ok: false, reason: 'Something went wrong reading that file.' }
  }
}
