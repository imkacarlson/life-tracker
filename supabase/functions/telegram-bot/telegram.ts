// Telegram Bot API helpers built on the grammY bot's `api`.
//
// Pure logic (splitMessage) lives in format.ts so it can be unit-tested; this
// module handles the network side (formatting conversion, sending, typing).

import telegramifyMarkdown from 'npm:telegramify-markdown@1'
import { InputFile } from 'https://deno.land/x/grammy@v1.30.0/mod.ts'
import { splitMessage } from './format.ts'

const TG_MAX = 4096

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
 * Send a PNG as an inline photo. Telegram re-compresses photos, so small text
 * softens — convenient for a quick look, less sharp for reading.
 */
export async function sendPhoto(
  api: any,
  chatId: number,
  png: Uint8Array,
  caption?: string,
): Promise<void> {
  await api.sendPhoto(chatId, new InputFile(png, 'preview.png'), caption ? { caption } : undefined)
}

/**
 * Send a PNG as an uncompressed document/file. Stays crisp (tap to view full
 * resolution) — best when the preview text needs to be readable.
 */
export async function sendDocument(
  api: any,
  chatId: number,
  png: Uint8Array,
  caption?: string,
): Promise<void> {
  await api.sendDocument(
    chatId,
    new InputFile(png, 'preview.png'),
    caption ? { caption } : undefined,
  )
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
      { command: 'preview', description: 'Preview this month’s tracker (test)' },
    ])
  } catch (_err) {
    // Non-fatal: the command still works even if the menu fails to register.
  }
}
