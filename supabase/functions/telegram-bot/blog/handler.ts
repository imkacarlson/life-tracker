// /blog command flow: paste a weekly race recap, get a WordPress draft back.
//
// Pipeline: capture recap -> fetch live rosters -> ask Claude to format into
// WordPress block markup + title suggestions -> create a draft -> reply the
// edit link. Any failure is reported back to Telegram (the one error behavior
// the user wants); typing always stops via finally.

import { sendReply, startTyping } from '../telegram.ts'
import { fetchRosters } from './roster.ts'
import { buildPrompt } from './prompt.ts'
import { extractTag, formatRecap } from './claude.ts'
import { createDraft } from './wordpress.ts'

const TYPING_INTERVAL_MS = 4000
const POST_TITLE = 'GRC Blog Post - Claude (AI) Draft'
const USAGE = 'Send /blog followed by the recap text, e.g.\n\n/blog RACES\n\n<paste this week’s recap>'

/** Append the title suggestions to the bottom of the post body, like the .flo. */
function composeBody(formatted: string, titles: string | null): string {
  if (!titles) return formatted
  return (
    `${formatted}\n\n` +
    '<!-- wp:heading -->\n' +
    '<h2 class="wp-block-heading">Title suggestions</h2>\n' +
    '<!-- /wp:heading -->\n\n' +
    '<!-- wp:paragraph -->\n' +
    `<p>${titles.replace(/\n/g, '<br>')}</p>\n` +
    '<!-- /wp:paragraph -->'
  )
}

// `ctx` is a grammY CommandContext; typed loosely to avoid importing grammY types
// here (the bot wires the real type at the call site in index.ts).
// deno-lint-ignore no-explicit-any
export async function handleBlog(ctx: any): Promise<void> {
  const recap = (ctx.match ?? '').trim()
  const chatId = ctx.chat.id

  if (!recap) {
    await sendReply(ctx.api, chatId, USAGE)
    return
  }

  const stopTyping = startTyping(ctx.api, chatId, TYPING_INTERVAL_MS)
  try {
    // Abort on roster failure rather than risk posting broken profile links.
    const { mens, womens } = await fetchRosters()

    const prompt = buildPrompt(recap, mens, womens)
    const raw = await formatRecap(prompt)

    const formatted = extractTag('formatted_results', raw)
    if (!formatted) {
      throw new Error(
        'Claude response had no <formatted_results> section — not posting a blank draft.',
      )
    }
    const titles = extractTag('title_suggestions', raw)

    const body = composeBody(formatted, titles)
    const { editLink } = await createDraft(body, POST_TITLE)

    await sendReply(ctx.api, chatId, `✅ Draft created: ${editLink}`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('blog handler error:', message)
    await sendReply(ctx.api, chatId, `⚠️ Blog draft failed: ${message}`)
  } finally {
    stopTyping()
  }
}
