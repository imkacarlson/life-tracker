import { beforeEach, describe, expect, it } from 'vitest'

import { buildTools } from './tools.ts'

// Real block ids in the fixture doc. read_tracker_structure allocates handles
// b1, b2, … over these in document order.
const HEAD_ID = '11111111-1111-4111-8111-111111111111'
const PARA_ID = '22222222-2222-4222-8222-222222222222'
const LI_ID = '33333333-3333-4333-8333-333333333333'
const LIST_ID = '44444444-4444-4444-8444-444444444444'

const PAGE = {
  id: 'page-1',
  title: 'May 2026 Tracker',
  is_tracker_page: true,
  updated_at: '2026-05-20T00:00:00Z',
  content: {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { id: HEAD_ID }, content: [{ type: 'text', text: 'Running' }] },
      {
        type: 'paragraph',
        attrs: { id: PARA_ID },
        content: [{ type: 'text', text: 'First note' }],
      },
      {
        type: 'bulletList',
        attrs: { id: LIST_ID },
        content: [
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                attrs: { id: LI_ID },
                content: [{ type: 'text', text: 'Buy gels' }],
              },
            ],
          },
        ],
      },
    ],
  },
}

const LIBRARY_SECTION = { id: 'sec-lib-1', title: 'Endurance', notebook_id: 'nb-lib' }

const EXISTING_CAPTURE_PAGE = {
  id: 'cap-1',
  title: 'Carbohydrate intake during long runs',
  updated_at: '2026-05-01T00:00:00Z',
  section_id: LIBRARY_SECTION.id,
  content: {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { id: 'h-sum', level: 2 }, content: [{ type: 'text', text: 'Summary' }] },
      { type: 'paragraph', attrs: { id: 'p-sum' }, content: [{ type: 'text', text: 'Existing summary.' }] },
      { type: 'heading', attrs: { id: 'h-notes', level: 2 }, content: [{ type: 'text', text: 'My notes' }] },
      {
        type: 'bulletList',
        attrs: { id: 'bl-notes' },
        content: [
          {
            type: 'listItem',
            content: [{ type: 'paragraph', attrs: { id: 'p-note-1' }, content: [{ type: 'text', text: 'May 1 — first thought' }] }],
          },
        ],
      },
    ],
  },
}

/**
 * Minimal Supabase stub covering the chains tools.ts uses: the `pages` select,
 * the `bot_preview_jobs` insert/update/delete, and the Library lookups
 * (notebooks -> sections, library_sources -> pages). `jobs` records what was
 * staged so a test can assert the persisted anchor or filing recipe.
 *
 * `opts.existingCanonicalUrl` simulates "I already have this one" — the partial
 * unique index that turns a proposal from "create" into "append a dated note".
 */
function makeSupabase(
  opts: {
    existingCanonicalUrl?: string
    librarySections?: Array<{ id: string; title: string }>
    searchHits?: Array<Record<string, unknown>>
  } = {},
) {
  const jobs: Array<Record<string, unknown>> = []
  const sections = opts.librarySections ?? [LIBRARY_SECTION]

  // Chainable stub: .select().eq().eq()… resolves to `result`, and also supports
  // .maybeSingle()/.single()/.limit()/.order() the same way.
  const chain = (result: unknown): any => {
    const self: any = {
      select: () => self,
      eq: () => self,
      in: () => self,
      order: () => self,
      limit: () => self,
      maybeSingle: async () => result,
      single: async () => result,
      then: (resolve: (v: unknown) => unknown) => resolve(result),
    }
    return self
  }

  const jobsQuery = {
    insert: (row: Record<string, unknown>) => {
      jobs.push(row)
      return {
        select: () => ({ single: async () => ({ data: { id: 'job-1' }, error: null }) }),
      }
    },
    update: () => ({ eq: async () => ({ error: null }) }),
    delete: () => ({ eq: async () => ({ error: null }) }),
  }

  let pagesCall = 0
  const searchCalls: Array<Record<string, unknown>> = []

  return {
    jobs,
    searchCalls,
    client: {
      from: (table: string) => {
        switch (table) {
          case 'bot_preview_jobs':
            return jobsQuery
          case 'notebooks':
            return chain({ data: [{ id: 'nb-lib' }], error: null })
          case 'sections':
            return chain({ data: sections, error: null })
          case 'library_sources':
            return chain({
              data: opts.existingCanonicalUrl ? { page_id: EXISTING_CAPTURE_PAGE.id } : null,
              error: null,
            })
          case 'pages': {
            // The tracker read wants the array of tracker pages; the Library
            // dedup lookup wants one capture page. Distinguish by call order:
            // findExistingCapture only runs after library_sources returned a hit.
            pagesCall += 1
            if (opts.existingCanonicalUrl) {
              return chain({ data: EXISTING_CAPTURE_PAGE, error: null })
            }
            return chain({ data: [PAGE], error: null })
          }
          default:
            return chain({ data: null, error: null })
        }
      },
      rpc: async (fn: string, args: Record<string, unknown>) => {
        searchCalls.push({ fn, ...args })
        return { data: opts.searchHits ?? [], error: null }
      },
    },
    get pagesCall() {
      return pagesCall
    },
  }
}

const FETCHED_ARTICLE = {
  status: 'ok' as const,
  sourceType: 'article' as const,
  url: 'https://example.com/fueling',
  canonicalUrl: 'https://example.com/fueling',
  title: 'Carbohydrate intake during long runs',
  markdown: 'Long-form article text about carbohydrate intake.',
  meta: { site: 'example.com', author: 'A Writer' },
}

const CAPTURE = {
  api: null,
  chatId: 1,
  sessionId: 'session-1',
  sendPhoto: async () => 99,
  renderPreview: async () => new Uint8Array([1]),
  fetchSource: async () => FETCHED_ARTICLE,
  summarizeModel: 'test-model',
}

const NOW = new Date('2026-05-20T12:00:00Z')

describe('propose_tracker_addition anchor resolution', () => {
  let supabase: ReturnType<typeof makeSupabase>
  let tools: ReturnType<typeof buildTools>

  beforeEach(() => {
    supabase = makeSupabase()
    tools = buildTools(supabase.client, 'user-1', NOW, 'UTC', CAPTURE)
  })

  const propose = (targetBlockId?: string) =>
    tools.runTool('propose_tracker_addition', {
      ...(targetBlockId === undefined ? {} : { targetBlockId }),
      placement: 'after_block',
      format: 'bullet_list',
      items: ['Buy more gels'],
    })

  /** The handle the structure read assigned to a given real block id. */
  async function handleFor(blockId: string): Promise<string> {
    const text = await tools.runTool('read_tracker_structure', {})
    const order = [HEAD_ID, PARA_ID, LI_ID, LIST_ID]
    expect(text).toContain('{{b1}}') // sanity: handles really were emitted
    return `b${order.indexOf(blockId) + 1}`
  }

  it('resolves a bare handle to the real block uuid before persisting', async () => {
    const handle = await handleFor(PARA_ID)
    const result = await propose(handle)

    expect(result).toContain('Preview sent')
    // The staged job must carry the UUID: it is replayed up to 48h later, long
    // after the in-memory handle map is gone.
    expect((supabase.jobs[0].placement as { targetBlockId: string }).targetBlockId).toBe(PARA_ID)
  })

  it('tolerates the model wrapping the handle in {{…}}', async () => {
    const handle = await handleFor(HEAD_ID)
    await propose(`{{${handle}}}`)
    expect((supabase.jobs[0].placement as { targetBlockId: string }).targetBlockId).toBe(HEAD_ID)
  })

  it('tolerates a stale "id:" prefix from the old marker convention', async () => {
    const handle = await handleFor(PARA_ID)
    await propose(`{{id:${handle}}}`)
    expect((supabase.jobs[0].placement as { targetBlockId: string }).targetBlockId).toBe(PARA_ID)
  })

  it('rebuilds the map when propose is called without reading first', async () => {
    // No read_tracker_structure call — handle generation is deterministic, so
    // re-flattening recovers the same b2 -> PARA_ID mapping.
    await propose('b2')
    expect((supabase.jobs[0].placement as { targetBlockId: string }).targetBlockId).toBe(PARA_ID)
  })

  it('accepts a real uuid that exists in the doc', async () => {
    await handleFor(PARA_ID)
    await propose(PARA_ID)
    expect((supabase.jobs[0].placement as { targetBlockId: string }).targetBlockId).toBe(PARA_ID)
  })

  it('rejects an unknown handle and asks for a fresh structure read', async () => {
    await handleFor(PARA_ID)
    const result = await propose('b999')

    expect(result).toContain('read_tracker_structure')
    expect(supabase.jobs).toHaveLength(0) // nothing staged
  })

  it('treats an absent or empty anchor as "append to the end of the doc"', async () => {
    for (const value of [undefined, '', '   ']) {
      supabase = makeSupabase()
      tools = buildTools(supabase.client, 'user-1', NOW, 'UTC', CAPTURE)
      const result = await propose(value)
      expect(result).toContain('Preview sent')
      expect((supabase.jobs[0].placement as { targetBlockId: null }).targetBlockId).toBeNull()
    }
  })
})

describe('tool routing — tracker vs library', () => {
  const tools = buildTools(makeSupabase().client, 'user-1', NOW, 'UTC', CAPTURE)
  const def = (name: string) => tools.defs.find((d) => d.name === name)

  it('offers both propose tools when a capture context exists', () => {
    expect(def('propose_tracker_addition')).toBeTruthy()
    expect(def('save_to_library')).toBeTruthy()
    expect(def('list_library_sections')).toBeTruthy()
  })

  it('offers neither propose tool without one (the read-only classify pass)', () => {
    const readOnly = buildTools(makeSupabase().client, 'user-1', NOW, 'UTC')
    const names = readOnly.defs.map((d) => d.name)
    expect(names).not.toContain('propose_tracker_addition')
    expect(names).not.toContain('save_to_library')
    // Search IS a read tool: answering "what was that hydration thing?" needs no
    // capture context, so it is available in every conversation.
    expect(names).toEqual([
      'read_current_tracker',
      'read_tracker_structure',
      'search_library',
    ])
  })

  it('states the do-vs-remember rule on BOTH propose tools', () => {
    // Routing is the model's job and the descriptions are all it has to go on,
    // so the rule cannot live on only one of them.
    for (const name of ['propose_tracker_addition', 'save_to_library']) {
      expect(def(name)!.description).toContain('something to DO, or something to REMEMBER')
    }
  })

  it('rules out a URL as a routing signal on both', () => {
    for (const name of ['propose_tracker_addition', 'save_to_library']) {
      expect(def(name)!.description).toContain('A URL IS NOT A SIGNAL')
    }
  })

  it('tells the model to ask rather than guess on a bare link', () => {
    expect(def('save_to_library')!.description).toContain('BARE LINK with no words, do not guess')
  })
})

describe('save_to_library — new capture', () => {
  let supabase: ReturnType<typeof makeSupabase>
  let tools: ReturnType<typeof buildTools>

  beforeEach(() => {
    supabase = makeSupabase()
    tools = buildTools(supabase.client, 'user-1', NOW, 'UTC', {
      ...CAPTURE,
      // Skip the real Claude summarize call; the fenced-prompt behavior is
      // covered in _shared/externalContent.test.ts.
      summarizeModel: 'test-model',
    })
  })

  const save = (input: Record<string, unknown> = {}) =>
    tools.runTool('save_to_library', {
      shareText: 'https://example.com/fueling — good breakdown of carb intake',
      note: 'worth revisiting before the fall build',
      sectionId: LIBRARY_SECTION.id,
      ...input,
    })

  it('lists the sections the user actually has', async () => {
    const listed = await tools.runTool('list_library_sections', {})
    expect(listed).toContain(LIBRARY_SECTION.id)
    expect(listed).toContain('Endurance')
  })

  it('stages a capture and sends a preview', async () => {
    const result = await save()
    expect(result).toContain('Preview sent')
    expect(supabase.jobs).toHaveLength(1)
  })

  it('stages it as a library_capture with NO target page', async () => {
    await save()
    const job = supabase.jobs[0]
    expect(job.kind).toBe('library_capture')
    // A brand-new capture has nothing to OCC against — see the migration's
    // bot_preview_jobs_target_required constraint.
    expect(job.page_id).toBeNull()
    expect(job.base_updated_at).toBeNull()
  })

  it('carries the filing recipe, including the raw source, in placement', async () => {
    await save()
    const placement = supabase.jobs[0].placement as Record<string, any>
    expect(placement.mode).toBe('new')
    expect(placement.sectionId).toBe(LIBRARY_SECTION.id)
    expect(placement.note).toBe('worth revisiting before the fall build')
    expect(placement.source.canonicalUrl).toBe('https://example.com/fueling')
    expect(placement.source.markdown).toContain('carbohydrate intake')
  })

  it('never writes to pages — only a preview job is staged', async () => {
    await save()
    // The whole safety property: the model's path ends at bot_preview_jobs.
    expect(supabase.jobs).toHaveLength(1)
    expect(supabase.jobs[0]).not.toHaveProperty('content')
  })

  it('refuses a section the user does not have, rather than inventing one', async () => {
    const result = await save({ sectionId: 'sec-does-not-exist' })
    expect(result).toContain('not one of')
    expect(result).toContain('list_library_sections')
    expect(supabase.jobs).toHaveLength(0)
  })

  it('tells the model to send the user the caveat when the source was blocked', async () => {
    const blocked = buildTools(supabase.client, 'user-1', NOW, 'UTC', {
      ...CAPTURE,
      fetchSource: async () => ({
        ...FETCHED_ARTICLE,
        status: 'blocked' as const,
        markdown: '',
        error: 'The site returned 403.',
      }),
    })
    const result = await blocked.runTool('save_to_library', {
      shareText: 'https://www.nytimes.com/some-article — interesting',
      note: 'interesting',
      sectionId: LIBRARY_SECTION.id,
    })
    // Silently storing a paywall teaser as though it were the article is the
    // failure mode this whole path is designed against.
    expect(result).toContain('the site blocked it')
  })

  it('refuses when the user has no Library sections at all', async () => {
    const empty = makeSupabase({ librarySections: [] })
    const emptyTools = buildTools(empty.client, 'user-1', NOW, 'UTC', CAPTURE)
    const result = await emptyTools.runTool('save_to_library', {
      shareText: 'https://example.com/x',
      note: 'x',
      sectionId: 'anything',
    })
    expect(result).toContain('create one in the')
    expect(empty.jobs).toHaveLength(0)
  })

  it('rejects an empty share', async () => {
    expect(await save({ shareText: '   ' })).toContain('No content to save')
    expect(supabase.jobs).toHaveLength(0)
  })
})

describe('save_to_library — already have this one', () => {
  let supabase: ReturnType<typeof makeSupabase>
  let tools: ReturnType<typeof buildTools>

  beforeEach(() => {
    supabase = makeSupabase({ existingCanonicalUrl: FETCHED_ARTICLE.canonicalUrl })
    tools = buildTools(supabase.client, 'user-1', NOW, 'UTC', CAPTURE)
  })

  it('appends a dated note instead of creating a second page', async () => {
    const result = await tools.runTool('save_to_library', {
      shareText: 'https://example.com/fueling — second thought',
      note: 'the 30-60g range is what stuck with me',
      sectionId: LIBRARY_SECTION.id,
    })

    expect(result).toContain('Preview sent')
    const job = supabase.jobs[0]
    expect((job.placement as Record<string, unknown>).mode).toBe('append')
    // In append mode this IS an ordinary OCC update, so the target columns mean
    // exactly what they always mean.
    expect(job.page_id).toBe('cap-1')
    expect(job.base_updated_at).toBe('2026-05-01T00:00:00Z')
  })

  it('keeps the existing notes and adds the new one after them', async () => {
    await tools.runTool('save_to_library', {
      shareText: 'https://example.com/fueling',
      note: 'the 30-60g range is what stuck with me',
      sectionId: LIBRARY_SECTION.id,
    })
    const doc = JSON.stringify(supabase.jobs[0].proposed_content)
    expect(doc).toContain('May 1 — first thought')
    expect(doc).toContain('the 30-60g range is what stuck with me')
    // The model-written summary is untouched.
    expect(doc).toContain('Existing summary.')
  })

  it('asks rather than duplicating when there is no new thought', async () => {
    const result = await tools.runTool('save_to_library', {
      shareText: 'https://example.com/fueling',
      note: '',
      sectionId: LIBRARY_SECTION.id,
    })
    expect(result).toContain('already')
    expect(supabase.jobs).toHaveLength(0)
  })
})

describe('save_to_library — degrading rather than losing the capture', () => {
  it('still stages the link and the note when summarizing fails', async () => {
    // In this environment callClaude throws (no Deno env), which is exactly the
    // shape of a real API outage. The capture must survive it: a link and the
    // user's own thought are the parts that matter, and the summary is not.
    const supabase = makeSupabase()
    const tools = buildTools(supabase.client, 'user-1', NOW, 'UTC', CAPTURE)

    const result = await tools.runTool('save_to_library', {
      shareText: 'https://example.com/fueling',
      note: 'worth revisiting before the fall build',
      sectionId: LIBRARY_SECTION.id,
    })

    expect(result).toContain('Preview sent')
    const doc = JSON.stringify(supabase.jobs[0].proposed_content)
    expect(doc).toContain('worth revisiting before the fall build')
    expect(doc).toContain('https://example.com/fueling')
  })
})

describe('search_library', () => {
  const HITS = [
    {
      page_id: 'cap-1',
      title: 'Carbohydrate intake during long runs',
      snippet: 'the <b>hydration</b> and carbohydrate story for efforts over two hours',
      rank: 0.4,
      matched_in: 'source_text',
      library_role: 'capture',
      section_id: 'sec-lib-1',
    },
    {
      page_id: 'trk-1',
      title: 'June 2026 Tracker',
      snippet: 'Wedding Planning — book the <b>hydration</b> station',
      rank: 0.1,
      matched_in: 'page',
      library_role: null,
      section_id: 'sec-lib-1',
    },
  ]

  const build = (hits = HITS) => {
    const supabase = makeSupabase({ searchHits: hits })
    return {
      supabase,
      tools: buildTools(supabase.client, 'user-1', NOW, 'UTC', CAPTURE, 'https://app.example'),
    }
  }

  it('passes the query and a clamped limit to the SQL function', async () => {
    const { supabase, tools } = build()
    await tools.runTool('search_library', { query: 'hydration', limit: 99 })
    expect(supabase.searchCalls[0]).toMatchObject({
      fn: 'search_library',
      p_user_id: 'user-1',
      p_query: 'hydration',
      p_limit: 20, // clamped from 99
    })
  })

  it('defaults the limit when the model omits it', async () => {
    const { supabase, tools } = build()
    await tools.runTool('search_library', { query: 'hydration' })
    expect(supabase.searchCalls[0].p_limit).toBe(8)
  })

  it('returns titles, snippets, and working links', async () => {
    const { tools } = build()
    const result = await tools.runTool('search_library', { query: 'hydration' })
    expect(result).toContain('Carbohydrate intake during long runs')
    expect(result).toContain('June 2026 Tracker')
    expect(result).toContain('https://app.example/#nb=nb-lib&sec=sec-lib-1&pg=cap-1')
  })

  it('says WHERE each hit matched', async () => {
    // The reason matched_in exists: an answer can say "found it in the
    // transcript" instead of silently citing a page whose visible summary
    // doesn't contain the search term.
    const { tools } = build()
    const result = await tools.runTool('search_library', { query: 'hydration' })
    expect(result).toContain('matched in the saved full text')
    expect(result).toContain('matched on the page')
  })

  it('labels tracker hits distinctly from library hits', async () => {
    const { tools } = build()
    const result = await tools.runTool('search_library', { query: 'hydration' })
    expect(result).toContain('[library]')
    expect(result).toContain('[tracker]')
  })

  it('fences the results — snippets can quote third-party source text', async () => {
    const { tools } = build()
    const result = await tools.runTool('search_library', { query: 'hydration' })
    expect(result).toContain('<external_content')
    expect(result.trim().endsWith('</external_content>')).toBe(true)
  })

  it('strips the headline markup so it never reaches a Telegram reply', async () => {
    const { tools } = build()
    const result = await tools.runTool('search_library', { query: 'hydration' })
    expect(result).not.toContain('<b>')
    expect(result).toContain('hydration and carbohydrate story')
  })

  it('says plainly when nothing matches', async () => {
    const { tools } = build([])
    const result = await tools.runTool('search_library', { query: 'sourdough' })
    expect(result).toContain('Nothing saved matches')
  })

  it('rejects an empty query', async () => {
    const { supabase, tools } = build()
    expect(await tools.runTool('search_library', { query: '  ' })).toContain('No search query')
    expect(supabase.searchCalls).toHaveLength(0)
  })
})
