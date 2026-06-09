// Tool registry — the extensibility seam. A future capability = add an entry
// here (definition + handler), not rewiring the bot.
//
// Read tools (always available):
//   - read_current_tracker   : current-month tracker as plain text (for Q&A).
//   - read_tracker_structure : same, but with {{id:…}} markers so the model can
//                              name an exact anchor for an addition.
// Propose tool (only when a capture context is supplied — it needs to send a photo):
//   - propose_tracker_addition : builds the proposed doc, stores a pending job,
//                              renders + sends a preview. NEVER writes to `pages`.

import {
  flattenTrackerToText,
  flattenTrackerToTextWithIds,
  selectCurrentMonthTracker,
} from './trackerText.ts'
import { buildItems, insertRelativeToBlock } from './insertContent.ts'
import { findSectionTitle } from './sectionTitle.ts'
import type { Format, Placement, TiptapNode } from './insertContent.ts'
import type { ToolDef } from './anthropic.ts'

type SupabaseLike = { from: (table: string) => any }

// Side-effecting context the propose tool needs. Injected (rather than imported)
// so this module's read path stays free of Deno-only dependencies.
export type CaptureContext = {
  api: unknown
  chatId: number
  sessionId: string
  sendPhoto: (api: unknown, chatId: number, png: Uint8Array, caption?: string) => Promise<number | null>
  renderPreview: (content: unknown, blockIds: string[]) => Promise<Uint8Array>
}

export type ToolRegistry = {
  defs: ToolDef[]
  runTool: (name: string, input: Record<string, unknown>) => Promise<string>
}

type CurrentPage = { id: string; title?: string; content?: TiptapNode | null; updated_at?: string }

const VALID_FORMATS = new Set<Format>(['bullet_list', 'task_list', 'paragraphs'])
const VALID_PLACEMENTS = new Set<Placement>(['after_block', 'append_to_list'])

const PLACEMENT_RULES =
  'How to choose the anchor and placement (ported from the app\'s AI-insert rules):\n' +
  '- targetBlockId MUST be one of the {{id:…}} markers from read_tracker_structure. ' +
  'Never invent an id. If no good anchor exists, omit it (the items go at the end).\n' +
  '- placement "append_to_list": targetBlockId is a list (its {{id:…}} sits on its own ' +
  'line right after the bullets/tasks). Use this to add lines to an EXISTING list — pick ' +
  'the format (task_list vs bullet_list) that matches that list.\n' +
  '- placement "after_block": targetBlockId is a heading, paragraph, or table cell line. ' +
  'The new content is inserted right after it. Use this to start a new list/paragraph under ' +
  'a category heading or after a specific line.\n' +
  '- format: "task_list" for checklist/to-do items, "bullet_list" for plain bullets, ' +
  '"paragraphs" for prose. items are concise plain-text lines (no markdown, no ids).'

/**
 * Build the tool registry bound to the single known user. The Supabase client
 * here uses the service role; access is scoped in code to `userId`.
 *
 * When `capture` is provided, the propose_tracker_addition tool is included
 * (it sends a preview photo). Read-only callers (e.g. the classify pass) omit it.
 */
export function buildTools(
  supabase: SupabaseLike,
  userId: string,
  now: Date,
  timeZone = 'UTC',
  capture?: CaptureContext,
): ToolRegistry {
  const defs: ToolDef[] = [
    {
      name: 'read_current_tracker',
      description:
        "Read the user's tracker page for the current month and return its full contents " +
        '(including crossed-off/completed items). Use this to answer any question about what is ' +
        'on the tracker this month.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'read_tracker_structure',
      description:
        "Read the current month's tracker WITH a {{id:…}} marker after each block. Call this " +
        'BEFORE propose_tracker_addition so you can pick a real insertion anchor (targetBlockId). ' +
        'The markers are structural metadata, not content to show the user.',
      input_schema: { type: 'object', properties: {} },
    },
  ]

  if (capture) {
    defs.push({
      name: 'propose_tracker_addition',
      description:
        'Propose adding item(s) to the current-month tracker and show the user a preview ' +
        'screenshot with the new content highlighted in place. This does NOT save anything — ' +
        'it only proposes. The user then confirms (and code applies it) or asks for a change. ' +
        'Call read_tracker_structure first to get valid block ids.\n\n' +
        PLACEMENT_RULES,
      input_schema: {
        type: 'object',
        properties: {
          targetBlockId: {
            type: 'string',
            description: 'A {{id:…}} value from read_tracker_structure to anchor the insertion. Omit if none fits.',
          },
          placement: {
            type: 'string',
            enum: ['after_block', 'append_to_list'],
            description: 'append_to_list to extend an existing list; after_block to insert after the anchor.',
          },
          format: {
            type: 'string',
            enum: ['bullet_list', 'task_list', 'paragraphs'],
          },
          items: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Concise plain-text lines to add. If a line has a key date worth flagging ' +
              "(a deadline, event, or time), wrap ONLY the date itself in a {{date:…}} token so it " +
              "gets highlighted in the user's date color. Highlight just the date (a numeric M/D, " +
              'plus a clock time if present) — keep qualifier words like "by", "EOD", or "due" ' +
              'OUTSIDE the token. E.g. "Submit GRC blog post by EOD {{date:6/15}}", ' +
              '"call w/ Sam {{date:6/16 6:59 PM}}", "renew pass {{date:6/15}}". The M/D inside the ' +
              "token also makes it register as a due date. Don't wrap incidental/context dates.",
          },
        },
        required: ['placement', 'format', 'items'],
      },
    })
  }

  async function fetchCurrentPage(): Promise<CurrentPage | null> {
    const { data, error } = await supabase
      .from('pages')
      .select('id, title, content, is_tracker_page, updated_at')
      .eq('user_id', userId)
      .eq('is_tracker_page', true)
    if (error) {
      console.error('fetchCurrentPage error:', error.code ?? error.message)
      return null
    }
    return selectCurrentMonthTracker(data ?? [], now, timeZone) as CurrentPage | null
  }

  async function readCurrentTracker(withIds: boolean): Promise<string> {
    const page = await fetchCurrentPage()
    if (!page) return 'No tracker page was found for the current month.'
    const text = withIds
      ? flattenTrackerToTextWithIds(page.content, page.title)
      : flattenTrackerToText(page.content, page.title)
    // Wrap as untrusted data: the model must treat this as content, not instructions.
    return [`<tracker_data page="${page.title ?? 'Untitled'}">`, text, '</tracker_data>'].join('\n')
  }

  async function proposeTrackerAddition(input: Record<string, unknown>): Promise<string> {
    if (!capture) return 'Proposing additions is not available right now.'

    const placement = String(input.placement ?? '') as Placement
    const format = String(input.format ?? '') as Format
    if (!VALID_PLACEMENTS.has(placement)) return `Invalid placement "${input.placement}".`
    if (!VALID_FORMATS.has(format)) return `Invalid format "${input.format}".`

    const rawTarget = input.targetBlockId
    const targetBlockId =
      typeof rawTarget === 'string' && rawTarget.trim() ? rawTarget.trim() : null

    const items = Array.isArray(input.items)
      ? input.items.map((i) => String(i ?? '').trim()).filter(Boolean)
      : []
    if (!items.length) return 'No items to add were provided.'

    const page = await fetchCurrentPage()
    if (!page?.id || !page.content) return 'No tracker page was found for the current month.'

    const nodes = buildItems(format, items)
    const { doc, insertedBlockIds } = insertRelativeToBlock(
      page.content as TiptapNode,
      targetBlockId,
      placement,
      nodes,
    )
    if (!insertedBlockIds.length) {
      return (
        `Couldn't find block ${targetBlockId} in the current tracker — it may have changed. ` +
        'Call read_tracker_structure again and pick a current anchor.'
      )
    }

    // Store the pending proposal. The write to `pages` only happens later, in
    // code, once the user's reply is classified as a confirmation.
    const { data: job, error } = await supabase
      .from('bot_preview_jobs')
      .insert({
        user_id: userId,
        session_id: capture.sessionId,
        page_id: page.id,
        base_updated_at: page.updated_at,
        proposed_content: doc,
        inserted_block_ids: insertedBlockIds,
        placement: { targetBlockId, position: placement, format, items },
      })
      .select('id')
      .single()
    if (error || !job?.id) {
      console.error('propose: job insert failed:', error?.code ?? error?.message)
      return 'Could not stage the proposal. Please try again.'
    }

    // Name the target section in the caption so the user knows where it lands
    // even though the cropped screenshot may not show the category title.
    const section = targetBlockId
      ? findSectionTitle(page.content as TiptapNode, targetBlockId)
      : null
    const caption = section
      ? `📍 Adding to **${section}**`
      : '📍 Adding to the end of your tracker'

    try {
      const png = await capture.renderPreview(doc, insertedBlockIds)
      const messageId = await capture.sendPhoto(capture.api, capture.chatId, png, caption)
      if (messageId != null) {
        await supabase
          .from('bot_preview_jobs')
          .update({ preview_message_id: messageId })
          .eq('id', job.id)
      }
    } catch (err) {
      // Roll back the staged job so a failed preview doesn't leave a dangling proposal.
      console.error('propose: render/send failed:', String(err))
      await supabase.from('bot_preview_jobs').delete().eq('id', job.id)
      return 'I built the change but couldn’t render the preview. Please try again.'
    }

    return (
      `Preview sent to the user (job ${job.id}). ` +
      'Briefly ask them to confirm to add it, or tell you what to change.'
    )
  }

  async function runTool(name: string, input: Record<string, unknown>): Promise<string> {
    switch (name) {
      case 'read_current_tracker':
        return await readCurrentTracker(false)
      case 'read_tracker_structure':
        return await readCurrentTracker(true)
      case 'propose_tracker_addition':
        return await proposeTrackerAddition(input)
      default:
        return `Unknown tool: ${name}`
    }
  }

  return { defs, runTool }
}
