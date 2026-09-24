// Tool registry — the extensibility seam. A future capability = add an entry
// here (definition + handler), not rewiring the bot.
//
// Read tools (always available):
//   - read_current_tracker   : current-month tracker as plain text (for Q&A).
//   - read_tracker_structure : same, but with short {{b12}} handles so the model
//                              can name an exact anchor for an addition.
// Propose tool (only when a capture context is supplied — it needs to send a photo):
//   - propose_tracker_addition : builds the proposed doc, stores a pending job,
//                              renders + sends a preview. NEVER writes to `pages`.

import {
  flattenTrackerToText,
  flattenTrackerToTextWithHandles,
  selectCurrentMonthTracker,
} from './trackerText.ts'
import { buildItems, insertRelativeToBlock } from './insertContent.ts'
import { findPlacementPath } from './sectionTitle.ts'
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
const VALID_PLACEMENTS = new Set<Placement>(['after_block', 'append_to_list', 'into_category', 'new_category'])

const PLACEMENT_RULES =
  'How to choose the anchor and placement:\n' +
  '- targetBlockId MUST be one of the {{b…}} handles from read_tracker_structure (pass it ' +
  'bare, e.g. "b12"). Never invent a handle.\n' +
  '- The tracker is a table of sections (a bold title such as **Running**, then Background, ' +
  'Recurring things, and Next steps). Next steps is organized into bold categories, shown as ' +
  '"- **Jerry Updates** (category) {{b12}}", in alphabetical order. Tasks live UNDER a category.\n' +
  '- DEFAULT: placement "into_category" with targetBlockId = the category line\'s handle. The ' +
  'items land at the BOTTOM of that category (the user writes oldest-at-top, newest-at-bottom). ' +
  'This also works for a category with nothing under it yet.\n' +
  '- Pick the category the item best belongs to within the right section. If none fits, use ' +
  'that section\'s **Other** category.\n' +
  '- If the section has no fitting category AND no Other, use placement "new_category" with ' +
  'category "Other" and targetBlockId = the handle of the list that holds the section\'s ' +
  'categories (the standalone {{b…}} line after that list). The code adds the bold category in ' +
  'alphabetical order. Only create a category with any other name when the user explicitly asks ' +
  'for a new category.\n' +
  '- Never add a bare bullet directly between categories, and never add to "Recurring things" ' +
  'unless the user asks for a recurring item.\n' +
  '- "append_to_list" (target = a list\'s standalone handle line) and "after_block" (target = a ' +
  'line; new items go right after it AT THE SAME LEVEL, never nested under it) are for sections ' +
  'that have no categories, or when the user asks for an exact spot.\n' +
  '- format: default "bullet_list" for plain bullets, "task_list" only when the user ' +
  'explicitly asks for a checklist/to-do/checkboxes, "paragraphs" for prose. items are ' +
  'concise plain-text lines (no markdown, no handles).\n' +
  '- Last resort: if no section fits at all, omit targetBlockId and the items go to the end of ' +
  'the tracker.'

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
        "Read the current month's tracker WITH a short {{b…}} handle after each block (b1, b2, …). " +
        'Call this BEFORE propose_tracker_addition so you can pick a real insertion anchor ' +
        '(targetBlockId). The handles are structural metadata, not content to show the user.',
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
        'Call read_tracker_structure first to get valid block handles.\n\n' +
        PLACEMENT_RULES,
      input_schema: {
        type: 'object',
        properties: {
          targetBlockId: {
            type: 'string',
            description:
              'A block handle from read_tracker_structure to anchor the insertion, passed bare ' +
              '(e.g. "b12", not "{{b12}}"). Omit if none fits.',
          },
          placement: {
            type: 'string',
            enum: ['into_category', 'new_category', 'append_to_list', 'after_block'],
            description:
              'into_category (default) to add to the bottom of a category; new_category to create ' +
              'a category (Other, or one the user named); append_to_list / after_block for ' +
              'sections without categories.',
          },
          category: {
            type: 'string',
            description:
              'Only with placement "new_category": the category title to create, e.g. "Other". ' +
              'Use any other name only when the user explicitly asked for that new category.',
          },
          format: {
            type: 'string',
            enum: ['bullet_list', 'task_list', 'paragraphs'],
            description:
              'Default to "bullet_list" — the user almost always adds plain bullets. Use ' +
              '"task_list" ONLY when the user explicitly asks for a checklist, to-do, or ' +
              'checkboxes (even if the target section already uses checkboxes). Use ' +
              '"paragraphs" for prose.',
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
              "token also makes it register as a due date. Don't wrap incidental/context dates.\n" +
              'A highlighted date with a clock time arms a push reminder; a highlighted date alone ' +
              'never does. Put a stated clock time INSIDE the token with an explicit AM/PM ' +
              '("{{date:8/21 2:00 PM}}", never a bare "2:00"). NEVER invent a time — date-only is ' +
              'the normal case. If the user asked to be reminded a certain amount ahead, append ' +
              'that phrase in plain text OUTSIDE the token, e.g. ' +
              '"call the venue {{date:8/21 2:00 PM}} (remind 3 hours before)"; the default is 90 ' +
              'minutes ahead, so only say otherwise when they asked. If they said not to be ' +
              'reminded, append "(no reminder)".',
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

  // handle ("b12") -> real block UUID, populated by read_tracker_structure and
  // consumed by propose_tracker_addition. Lives in the closure, so it lasts for
  // exactly one bot turn — anything persisted must store the resolved UUID.
  let handleMap = new Map<string, string>()

  /**
   * Turn whatever the model passed as `targetBlockId` into a real block UUID.
   * Tolerates `{{b12}}` wrapping and a stale `id:` prefix, and accepts a raw
   * UUID if one is somehow passed through.
   */
  async function resolveAnchor(
    raw: unknown,
    page: CurrentPage,
  ): Promise<{ ok: true; blockId: string | null } | { ok: false; error: string }> {
    let value = typeof raw === 'string' ? raw.trim() : ''
    // Strip {{…}} wrapping and any leftover "id:" prefix from the old convention.
    value = value.replace(/^\{\{/, '').replace(/\}\}$/, '').trim()
    value = value.replace(/^id:/i, '').trim()
    if (!value) return { ok: true, blockId: null } // append to end of doc

    // If the model called propose without reading first, the map is empty.
    // Handle generation is deterministic, so re-flattening rebuilds it exactly.
    if (handleMap.size === 0) {
      handleMap = flattenTrackerToTextWithHandles(page.content, page.title).handles
    }

    const mapped = handleMap.get(value)
    if (mapped) return { ok: true, blockId: mapped }

    // Defensive: a real UUID that exists in the doc is fine too.
    if (new Set(handleMap.values()).has(value)) return { ok: true, blockId: value }

    return {
      ok: false,
      error:
        `"${value}" isn't a block handle in the current tracker. ` +
        'Call read_tracker_structure again and pick a current {{b…}} handle.',
    }
  }

  async function readCurrentTracker(withIds: boolean): Promise<string> {
    const page = await fetchCurrentPage()
    if (!page) return 'No tracker page was found for the current month.'
    let text: string
    if (withIds) {
      const flattened = flattenTrackerToTextWithHandles(page.content, page.title)
      text = flattened.text
      handleMap = flattened.handles
    } else {
      text = flattenTrackerToText(page.content, page.title)
    }
    // Wrap as untrusted data: the model must treat this as content, not instructions.
    return [`<tracker_data page="${page.title ?? 'Untitled'}">`, text, '</tracker_data>'].join('\n')
  }

  async function proposeTrackerAddition(input: Record<string, unknown>): Promise<string> {
    if (!capture) return 'Proposing additions is not available right now.'

    const placement = String(input.placement ?? '') as Placement
    const format = String(input.format ?? '') as Format
    if (!VALID_PLACEMENTS.has(placement)) return `Invalid placement "${input.placement}".`
    if (!VALID_FORMATS.has(format)) return `Invalid format "${input.format}".`

    const category = typeof input.category === 'string' ? input.category.trim() : ''
    if (placement === 'new_category' && !category) return 'new_category needs a category title.'

    const items = Array.isArray(input.items)
      ? input.items.map((i) => String(i ?? '').trim()).filter(Boolean)
      : []
    if (!items.length) return 'No items to add were provided.'

    const page = await fetchCurrentPage()
    if (!page?.id || !page.content) return 'No tracker page was found for the current month.'

    // Resolve the short handle to a real UUID up front: everything downstream —
    // insertion, section lookup, and especially the persisted preview job (which
    // is replayed up to 48h later, long after this handle map is gone) — needs
    // the UUID, not the handle.
    const anchor = await resolveAnchor(input.targetBlockId, page)
    if (!anchor.ok) return anchor.error
    const targetBlockId = anchor.blockId

    const nodes = buildItems(format, items)
    const { doc, insertedBlockIds, createdCategory } = insertRelativeToBlock(
      page.content as TiptapNode,
      targetBlockId,
      placement,
      nodes,
      { category },
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
        placement: { targetBlockId, position: placement, format, items, ...(category ? { category } : {}) },
      })
      .select('id')
      .single()
    if (error || !job?.id) {
      console.error('propose: job insert failed:', error?.code ?? error?.message)
      return 'Could not stage the proposal. Please try again.'
    }

    // Name the section AND category in the caption, since the cropped
    // screenshot often hides both titles.
    const path = targetBlockId
      ? findPlacementPath(page.content as TiptapNode, targetBlockId)
      : { section: null, category: null }
    const categoryLabel = placement === 'new_category' ? category : path.category
    const where = [path.section, categoryLabel].filter(Boolean).join(' → ')
    const caption = where
      ? `📍 Adding to **${where}**${createdCategory ? ' (new category)' : ''}`
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
