// Telegram Bot API helpers built on the grammY bot's `api`.
//
// Pure logic (splitMessage) lives in format.ts so it can be unit-tested; this
// module handles the network side (formatting conversion, sending, typing).

import telegramifyMarkdown from 'npm:telegramify-markdown@1'
import { splitMessage } from './format.ts'

const TG_MAX = 4096
const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? ''

/**
 * Send a reply, splitting long text and converting Markdown to Telegram's
 * MarkdownV2. If Telegram rejects the formatting (400 "can't parse entities"),
 * automatically resend that chunk as plain text — so the user always gets the
 * message, unformatted at worst, never an error or a dropped reply.
 */
export async function sendReply(api: any, chatId: number, text: string): Promise<void> {
  const chunks = splitMessage(text, TG_MAX)
  for (const chunk of chunks) {
    try {
      const formatted = telegramifyMarkdown(chunk, 'escape')
      await api.sendMessage(chatId, formatted, { parse_mode: 'MarkdownV2' })
    } catch (_err) {
      // Fallback: plain text, no parse_mode. Guarantees delivery.
      await api.sendMessage(chatId, chunk)
    }
  }
}

/**
 * Send a PNG to a chat as an inline photo via Telegram's Bot API using multipart
 * FormData. We call the HTTP API directly (rather than grammY's InputFile)
 * because grammY's file upload machinery hits a runtime incompatibility in the
 * Supabase Edge runtime.
 */
export async function sendPhoto(
  _api: unknown,
  chatId: number,
  png: Uint8Array,
  caption?: string,
): Promise<number | null> {
  const form = new FormData()
  form.append('chat_id', String(chatId))
  form.append('photo', new Blob([png], { type: 'image/png' }), 'preview.png')
  if (caption) form.append('caption', caption)
  const resp = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
    method: 'POST',
    body: form,
  })
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '')
    throw new Error(`telegram sendPhoto failed (${resp.status}) ${detail}`.trim())
  }
  // Return the sent photo's message_id so a quote-reply can re-activate the
  // proposal it belongs to (the capture flow stores it on the preview job).
  const data = await resp.json().catch(() => null)
  const id = data?.result?.message_id
  return typeof id === 'number' ? id : null
}

/**
 * Show a continuous "typing…" indicator. Telegram's chat action expires after
 * ~5s, so we re-send it on an interval until `stop()` is called. Covers the
 * whole think -> tool -> answer window.
 */
export function startTyping(api: any, chatId: number, intervalMs: number): () => void {
  const ping = () => {
    api.sendChatAction(chatId, 'typing').catch(() => {})
  }
  ping()
  const timer = setInterval(ping, intervalMs)
  return () => clearInterval(timer)
}

/** Register the bot's command menu (the "/" menu in Telegram clients). */
export async function registerCommands(api: any): Promise<void> {
  try {
    await api.setMyCommands([
      { command: 'new', description: 'Start a fresh conversation' },
    ])
  } catch (_err) {
    // Non-fatal: the command still works even if the menu fails to register.
  }
}
