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

/**
 * Minimal Supabase stub covering the two chains tools.ts uses: the `pages`
 * select and the `bot_preview_jobs` insert/update/delete. `jobs` records what
 * was staged so a test can assert the persisted anchor.
 */
function makeSupabase() {
  const jobs: Array<Record<string, unknown>> = []

  const pagesQuery = {
    select: () => pagesQuery,
    eq: () => pagesQuery,
    then: (resolve: (v: unknown) => unknown) => resolve({ data: [PAGE], error: null }),
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

  return {
    jobs,
    client: {
      from: (table: string) => (table === 'pages' ? pagesQuery : jobsQuery),
    },
  }
}

const CAPTURE = {
  api: null,
  chatId: 1,
  sessionId: 'session-1',
  sendPhoto: async () => 99,
  renderPreview: async () => new Uint8Array([1]),
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
