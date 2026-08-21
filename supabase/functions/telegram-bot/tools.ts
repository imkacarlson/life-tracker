// Tool registry — the extensibility seam. A future capability = add an entry
// here (definition + handler), not rewiring the bot.
//
// Read tools (always available):
//   - read_current_tracker   : current-month tracker as plain text (for Q&A).
//   - read_tracker_structure : same, but with short {{b12}} handles so the model
//                              can name an exact anchor for an addition.
// Propose tools (only when a capture context is supplied — they need to send a photo):
//   - propose_tracker_addition : builds the proposed doc, stores a pending job,
//                              renders + sends a preview. NEVER writes to `pages`.
//   - save_to_library          : same propose/preview/confirm shape, for things
//                              the user wants to KEEP rather than DO.

import {
  flattenTrackerToText,
  flattenTrackerToTextWithHandles,
  selectCurrentMonthTracker,
} from './trackerText.ts'
import { buildItems, insertRelativeToBlock } from './insertContent.ts'
import { findSectionTitle } from './sectionTitle.ts'
import {
  buildNewCaptureDoc,
  createTopicPage,
  extractionCaveat,
  findExistingCapture,
  listLibrarySections,
  listSectionTopics,
  revertLibraryPage,
  summarizeSource,
} from './library.ts'
import type { FetchedSource } from './library.ts'
import { appendDatedNote, shortDateLabel } from '../_shared/libraryPage.ts'
import { runLibraryRebuild } from '../_shared/libraryRebuild.ts'
import { fenceExternalContent } from '../_shared/externalContent.ts'
import { buildDeepLink } from '../_shared/deepLink.ts'
import type { Format, Placement, TiptapNode } from './insertContent.ts'
import type { ToolDef } from '../_shared/anthropic.ts'

type SupabaseLike = {
  from: (table: string) => any
  rpc?: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: any }>
}

/** One row from the search_library SQL function. */
type SearchHit = {
  page_id: string
  title: string
  snippet: string
  rank: number
  matched_in: 'page' | 'source_text'
  library_role: string | null
  section_id: string | null
}

// Side-effecting context the propose tool needs. Injected (rather than imported)
// so this module's read path stays free of Deno-only dependencies.
export type CaptureContext = {
  api: unknown
  chatId: number
  sessionId: string
  sendPhoto: (api: unknown, chatId: number, png: Uint8Array, caption?: string) => Promise<number | null>
  renderPreview: (content: unknown, blockIds: string[]) => Promise<Uint8Array>
  /** Reads whatever the user shared (see fetchSource.ts). */
  fetchSource: (shareText: string) => Promise<FetchedSource>
  /** Model for the no-tools summarize pass (see library.ts summarizeSource). */
  summarizeModel: string
}

export type ToolRegistry = {
  defs: ToolDef[]
  runTool: (name: string, input: Record<string, unknown>) => Promise<string>
}

type CurrentPage = { id: string; title?: string; content?: TiptapNode | null; updated_at?: string }

const VALID_FORMATS = new Set<Format>(['bullet_list', 'task_list', 'paragraphs'])
const VALID_PLACEMENTS = new Set<Placement>(['after_block', 'append_to_list'])

// The ONE distinction that decides which propose tool runs. Stated on both tool
// descriptions (and in BASE_PROMPT) because routing is the model's job and this
// is all it has to go on.
//
// A URL is explicitly NOT a signal: the user pastes links into the tracker
// constantly. What separates them is whether the message names something to DO.
const ROUTING_RULE =
  'CHOOSING BETWEEN THE TRACKER AND THE LIBRARY — the question is: is this ' +
  'something to DO, or something to REMEMBER?\n' +
  '- Something to do -> propose_tracker_addition. "sign up for the lottery [link]", ' +
  '"email the caterer", "renew the pass by Friday". It has an action in it.\n' +
  '- Something to keep -> save_to_library. "[link] this was interesting, they said ' +
  'longer intervals may be counterproductive", "worth rereading before the fall build". ' +
  'It is a thing they ran across and want to find again later.\n' +
  '- A URL IS NOT A SIGNAL EITHER WAY. The user pastes links into their tracker all ' +
  'the time. Judge the words around it, not the presence of a link.\n' +
  '- If the message is a BARE LINK with no words, do not guess: ask which one they ' +
  'want, in one short line. Guessing wrong is worse than one extra question.'

const PLACEMENT_RULES =
  'How to choose the anchor and placement (ported from the app\'s AI-insert rules):\n' +
  '- targetBlockId MUST be one of the {{b…}} handles from read_tracker_structure (pass it ' +
  'bare, e.g. "b12"). Never invent a handle. ' +
  'If no good anchor exists, omit it (the items go at the end).\n' +
  '- Default placement = the BOTTOM of the section the item belongs to. The user writes ' +
  'oldest-at-top / newest-at-bottom, so a new item continues at the end of its section.\n' +
  '- placement "append_to_list": targetBlockId is a list (its {{b…}} handle sits on its own ' +
  'line right after the bullets/tasks). This appends to the BOTTOM of that list and keeps ' +
  'one clean list. PREFER this when the section\'s existing list is already bullets — anchor ' +
  'on that list so the new bullet lands at the bottom of the section.\n' +
  '- Bullet-into-a-checkbox-section case: append_to_list forces new items to match the ' +
  'target list\'s type, so appending into a task/checkbox list always yields checkboxes. ' +
  'If the section\'s existing list is a checkbox/task list and the user did NOT ask for a ' +
  'checkbox, use placement "after_block" anchored on the LAST line of that list with ' +
  'format "bullet_list", so the bullet lands at the bottom of the section as its own plain ' +
  'bullet. This is the one spot where after_block + bullet_list beats append_to_list.\n' +
  '- placement "after_block": targetBlockId is a heading, paragraph, table cell, or list ' +
  'line. The new content is inserted right after it. Use this to start a new list/paragraph ' +
  'under a category heading, or (per the case above) to add a plain bullet after the last ' +
  'line of a checkbox list.\n' +
  '- format: default "bullet_list" for plain bullets, "task_list" only when the user ' +
  'explicitly asks for a checklist/to-do/checkboxes, "paragraphs" for prose. items are ' +
  'concise plain-text lines (no markdown, no handles).\n' +
  '- Last resort: if no section fits, omit targetBlockId and the items go to the end of ' +
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
  appUrl = '',
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
    {
      name: 'search_library',
      description:
        "Search everything the user has ever saved — their Library captures AND their tracker " +
        'pages — by keyword. This is the tool for "I know I saved something about X, what was ' +
        'it?" and for "what was on my plate for the wedding".\n\n' +
        'Returns titles, a matching snippet, and a link for each hit. It deliberately does NOT ' +
        'return full article text: narrow with a search first, and only then, if you genuinely ' +
        'need more, ask the user. Results say whether the match was in the page itself or in ' +
        "the stored full text of a source, so you can tell them where you found it.\n\n" +
        'Query syntax is web-search style: bare words are ANDed, "quoted phrases" match exactly, ' +
        'OR works, and a leading - excludes.',
      input_schema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'Keywords, in the user\'s own vocabulary. Prefer the distinctive words from ' +
              'their question over a full sentence.',
          },
          limit: {
            type: 'number',
            description: 'Maximum hits to return. Default 8, max 20.',
          },
        },
        required: ['query'],
      },
    },
  ]

  if (capture) {
    defs.push({
      name: 'propose_tracker_addition',
      description:
        'Propose adding item(s) to the current-month tracker — things the user needs to DO ' +
        '— and show them a preview screenshot with the new content highlighted in place. ' +
        'This does NOT save anything; it only proposes. The user then confirms (and code ' +
        'applies it) or asks for a change. Call read_tracker_structure first to get valid ' +
        'block handles.\n\n' +
        ROUTING_RULE +
        '\n\n' +
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
            enum: ['after_block', 'append_to_list'],
            description: 'append_to_list to extend an existing list; after_block to insert after the anchor.',
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

    defs.push({
      name: 'save_to_library',
      description:
        "Save something the user wants to KEEP and find again later into their Library — an " +
        'article, a podcast episode, a thread, or just a thought. Code fetches and reads the ' +
        'source, writes a short summary, files it into the section you name, and shows the ' +
        'user a preview. This does NOT save anything; it only proposes.\n\n' +
        'Pass the user\'s message through as `shareText` verbatim (link and all) — the fetcher ' +
        'needs the raw text to work out what it is. Put only the user\'s OWN thought in ' +
        '`note`; leave it empty if they just sent a link.\n\n' +
        'SECTIONS ARE THE USER\'S. Call list_library_sections first and file into one of ' +
        'them. If none fits, say so and ask whether they want a new one — never invent one.\n\n' +
        ROUTING_RULE,
      input_schema: {
        type: 'object',
        properties: {
          shareText: {
            type: 'string',
            description:
              "The user's message verbatim, including any link and any app chrome they " +
              'pasted (show name, episode title). Do not clean it up — the extractor uses ' +
              'all of it to identify the source.',
          },
          note: {
            type: 'string',
            description:
              "Only the user's own thought about the thing, in their words, e.g. \"they said " +
              'longer intervals may be counterproductive". Empty string if they sent a bare ' +
              'link with no comment. Never write a note on their behalf.',
          },
          sectionId: {
            type: 'string',
            description:
              'The id of an EXISTING Library section from list_library_sections. Required.',
          },
        },
        required: ['shareText', 'sectionId'],
      },
    })

    defs.push({
      name: 'create_library_topic',
      description:
        'Create a topic page in a Library section and file the things already saved there ' +
        'into it. Use this ONLY when the user explicitly asks for a topic ("make a topic for ' +
        'calf pain", "yes, create that one"). Never call it on your own initiative — topics ' +
        'exist because the user made them.\n\n' +
        'You may SUGGEST one in conversation ("7 things mention calf pain — want a topic for ' +
        'that?") and wait for their answer. Suggesting is fine; creating without being asked ' +
        'is not.',
      input_schema: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: "The topic name, in the user's words.",
          },
          sectionId: {
            type: 'string',
            description: 'An EXISTING Library section id from list_library_sections.',
          },
        },
        required: ['title', 'sectionId'],
      },
    })

    defs.push({
      name: 'revert_library_page',
      description:
        'Put a Library page back to what it looked like before the weekly rebuild last wrote ' +
        'it. Use when the user says a topic page, section front page, or Lately got worse — ' +
        '"undo that", "put Fueling back".\n\n' +
        'Only works on pages the rebuild owns (topic, section front page, Lately, Activity). ' +
        'It CANNOT touch a capture page, because nothing ever rewrites one — the notes on a ' +
        'capture are the user\'s and are never at risk.\n\n' +
        'Use search_library or list_library_sections to find the page id first.',
      input_schema: {
        type: 'object',
        properties: {
          pageId: {
            type: 'string',
            description: 'The id of the page to put back.',
          },
        },
        required: ['pageId'],
      },
    })

    defs.push({
      name: 'list_library_sections',
      description:
        "List the sections of the user's Library, so save_to_library can file into a real " +
        'one. Sections are created by the user only — if nothing fits, ask them rather than ' +
        'inventing one.',
      input_schema: { type: 'object', properties: {} },
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

  /**
   * Search everything the user saved.
   *
   * The whole cost story for this feature lives in this function: narrowing in
   * Postgres BEFORE any model sees anything. Eight snippets is on the order of a
   * thousand tokens; loading the Library into context instead would be over a
   * million. So this returns titles, snippets, and links — never full source
   * text.
   */
  async function searchLibrary(input: Record<string, unknown>): Promise<string> {
    const query = String(input.query ?? '').trim()
    if (!query) return 'No search query was provided.'
    const limit = Math.min(Math.max(Number(input.limit) || 8, 1), 20)

    if (typeof supabase.rpc !== 'function') return 'Search is not available right now.'
    const { data, error } = await supabase.rpc('search_library', {
      p_user_id: userId,
      p_query: query,
      p_limit: limit,
    })
    if (error) {
      console.error('search_library error:', error.code ?? error.message)
      return 'The search failed. Try different words.'
    }

    const hits = (data ?? []) as SearchHit[]
    if (!hits.length) return `Nothing saved matches "${query}".`

    // One batched lookup so each hit can carry a working link.
    const sectionIds = [...new Set(hits.map((hit) => hit.section_id).filter(Boolean))]
    const notebookBySection = new Map<string, string>()
    if (sectionIds.length) {
      const { data: sections } = await supabase
        .from('sections')
        .select('id, notebook_id')
        .in('id', sectionIds)
      for (const section of sections ?? []) notebookBySection.set(section.id, section.notebook_id)
    }

    const lines = hits.map((hit) => {
      const where =
        hit.matched_in === 'source_text'
          ? 'matched in the saved full text'
          : 'matched on the page'
      const kind = hit.library_role === 'capture' ? 'library' : (hit.library_role ?? 'tracker')
      const deepLink = buildDeepLink(
        {
          notebookId: hit.section_id ? notebookBySection.get(hit.section_id) : null,
          sectionId: hit.section_id,
          pageId: hit.page_id,
        },
        appUrl,
      )
      // ts_headline marks matches with <b>…</b>; strip it so the model doesn't
      // echo raw HTML into a Telegram reply.
      const snippet = String(hit.snippet ?? '').replace(/<\/?b>/g, '').replace(/\s+/g, ' ').trim()
      return [
        `- ${hit.title} [${kind}] (${where})`,
        `  ${snippet}`,
        deepLink ? `  link: ${deepLink}` : null,
      ]
        .filter(Boolean)
        .join('\n')
    })

    // Snippets can quote source_text, which is third-party content the user did
    // not write. Fence it: same trust boundary as the summarize pass.
    return fenceExternalContent('article', lines.join('\n'), {
      title: `search results for ${query}`,
      maxChars: 8000,
    })
  }

  async function createTopic(input: Record<string, unknown>): Promise<string> {
    if (!capture) return 'Creating a topic is not available right now.'

    const title = String(input.title ?? '').trim()
    const sectionId = String(input.sectionId ?? '').trim()
    if (!title) return 'No topic name was given. Ask the user what to call it.'

    const sections = await listLibrarySections(supabase, userId)
    const section = sections.find((entry) => entry.id === sectionId)
    if (!section) {
      return (
        `"${sectionId}" is not one of the user's Library sections. Call list_library_sections ` +
        'and use a real one.'
      )
    }

    const created = await createTopicPage(supabase, {
      userId,
      sectionId,
      title,
      timeZone,
      model: capture.summarizeModel,
      now,
    })
    if (!created) return 'Could not create that topic. Please try again.'

    // Re-render the section's front page so it actually lists the topic that was
    // just made. Without this the front page keeps saying "No topics in this
    // section yet" until the next capture — it tells the user to make a topic,
    // they make one, and it denies it happened.
    //
    // The topic page itself does NOT need re-rendering: createTopicPage already
    // wrote its catalog, and the rebuild's scoping check will skip it for
    // exactly that reason (and log the skip, which is honest). What this is for
    // is the front page, Lately and Activity.
    //
    // Same shape as the post-capture hook in index.ts: scoped to one section,
    // zero model calls, and inside a try/catch that only logs — the topic is
    // already committed, so a rendering failure must never turn a successful
    // creation into an error message.
    try {
      const { summary } = await runLibraryRebuild(supabase, {
        timeZone,
        sectionIds: [sectionId],
        now,
      })
      if (!summary.ok) console.error('post-topic rebuild failed:', summary.error)
    } catch (err) {
      console.error('post-topic rebuild error:', String(err))
    }

    return (
      `Created the topic "${title}" in ${section.title} and filed ${created.memberCount} ` +
      'existing item(s) into it. Tell the user briefly; anything they save to that section ' +
      'from now on will be considered for it.'
    )
  }

  async function revertPage(input: Record<string, unknown>): Promise<string> {
    const pageId = String(input.pageId ?? '').trim()
    if (!pageId) return 'No page was given to revert.'

    const result = await revertLibraryPage(supabase, { userId, pageId, now })
    if (result.ok) return `Put "${result.title}" back to its previous version.`
    switch (result.reason) {
      case 'not_found':
        return "That page isn't one of the user's. Find the right page id first."
      case 'not_owned':
        return (
          'That page is a capture, not a rebuilt page. Nothing ever rewrites a capture, so ' +
          'there is nothing to undo — tell the user their notes on it were never touched.'
        )
      case 'no_history':
        return 'That page has no previous version stored — it has not been rebuilt yet.'
      default:
        return 'Could not revert that page just now.'
    }
  }

  async function listSections(): Promise<string> {
    const sections = await listLibrarySections(supabase, userId)
    if (!sections.length) {
      return (
        'The user has no Library notebook (or it has no sections) yet. Tell them to create ' +
        'one in the app — sections are theirs to make, not yours.'
      )
    }
    return sections.map((section) => `${section.id} — ${section.title}`).join('\n')
  }

  /**
   * Propose a Library capture. Two modes, decided by a DB lookup rather than by
   * the model:
   *   new     the canonical URL is unseen -> build a fresh capture page.
   *   append  we already have this source -> add a dated note to that page,
   *           which is an ordinary OCC update of an existing page.
   */
  async function saveToLibrary(input: Record<string, unknown>): Promise<string> {
    if (!capture) return 'Saving to the library is not available right now.'

    const shareText = String(input.shareText ?? '').trim()
    const note = String(input.note ?? '').trim()
    const sectionId = String(input.sectionId ?? '').trim()
    if (!shareText) return 'No content to save was provided.'

    const sections = await listLibrarySections(supabase, userId)
    if (!sections.length) {
      return (
        'There is no Library notebook with sections yet. Tell the user to create one in the ' +
        'app first — you must not create it for them.'
      )
    }
    const section = sections.find((entry) => entry.id === sectionId)
    if (!section) {
      return (
        `"${sectionId}" is not one of the user's Library sections. Call list_library_sections ` +
        'and file into a real one, or ask the user which section this belongs in.'
      )
    }

    // 1. Read the source. Never throws; an unreadable source degrades to a note
    //    and the caveat below tells the user so.
    const source = await capture.fetchSource(shareText)
    const caveat = extractionCaveat(source)

    // 2. Already have it? Plain DB lookup on the partial unique index — not a
    //    model decision.
    const existing = await findExistingCapture(supabase, userId, source.canonicalUrl)

    let doc: TiptapNode
    let blockIds: string[]
    let placement: Record<string, unknown>
    let pageId: string | null = null
    let baseUpdatedAt: string | null = null
    let captionTitle: string

    if (existing) {
      if (!note) {
        return (
          `The user already has "${existing.title}" saved, and this message adds no new ` +
          'thought. Tell them it is already in their Library and ask if they want to add a ' +
          'note to it.'
        )
      }
      const appended = appendDatedNote(existing.content, note, shortDateLabel(now, timeZone))
      doc = appended.doc
      blockIds = appended.blockId ? [appended.blockId] : []
      pageId = existing.page_id
      baseUpdatedAt = existing.updated_at
      captionTitle = existing.title
      placement = { mode: 'append', sectionId: existing.section_id, note, title: existing.title }
    } else {
      // 3. Summarize in a separate call with NO TOOLS (see library.ts). Topic
      //    membership rides along on the same call — it already has the content
      //    in hand, so deciding here costs nothing extra.
      const topics = await listSectionTopics(supabase, userId, sectionId)
      const { title, summary, topics: topicPlacements } = await summarizeSource(
        source,
        note,
        capture.summarizeModel,
        topics.map((topic) => ({ id: topic.id, title: topic.title })),
      )
      doc = buildNewCaptureDoc({ summary, note, source, now, timeZone })
      blockIds = []
      captionTitle = title
      placement = {
        mode: 'new',
        sectionId,
        title,
        summary,
        note,
        topics: topicPlacements,
        source: {
          sourceType: source.sourceType,
          url: source.url,
          canonicalUrl: source.canonicalUrl,
          markdown: source.markdown,
          meta: source.meta,
          status: source.status,
          error: source.error ?? null,
        },
      }
    }

    const { data: job, error } = await supabase
      .from('bot_preview_jobs')
      .insert({
        user_id: userId,
        session_id: capture.sessionId,
        kind: 'library_capture',
        page_id: pageId,
        base_updated_at: baseUpdatedAt,
        proposed_content: doc,
        inserted_block_ids: blockIds,
        placement,
      })
      .select('id')
      .single()
    if (error || !job?.id) {
      console.error('saveToLibrary: job insert failed:', error?.code ?? error?.message)
      return 'Could not stage the capture. Please try again.'
    }

    const caption = existing
      ? `📚 Adding a note to **${captionTitle}**`
      : `📚 Saving to **${section.title}**`

    try {
      const png = await capture.renderPreview(doc, blockIds)
      const messageId = await capture.sendPhoto(capture.api, capture.chatId, png, caption)
      if (messageId != null) {
        await supabase
          .from('bot_preview_jobs')
          .update({ preview_message_id: messageId })
          .eq('id', job.id)
      }
    } catch (err) {
      console.error('saveToLibrary: render/send failed:', String(err))
      await supabase.from('bot_preview_jobs').delete().eq('id', job.id)
      return 'I read the source but couldn\u2019t render the preview. Please try again.'
    }

    const caveatLine = caveat ? ` Tell the user, in your own words: ${caveat}` : ''
    return (
      `Preview sent to the user (job ${job.id}).${caveatLine} ` +
      'Briefly ask them to confirm to save it, or tell you what to change.'
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
      case 'search_library':
        return await searchLibrary(input)
      case 'create_library_topic':
        return await createTopic(input)
      case 'revert_library_page':
        return await revertPage(input)
      case 'list_library_sections':
        return await listSections()
      case 'save_to_library':
        return await saveToLibrary(input)
      default:
        return `Unknown tool: ${name}`
    }
  }

  return { defs, runTool }
}
