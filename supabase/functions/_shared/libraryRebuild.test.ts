import { describe, expect, it, vi } from 'vitest'

import { HOME_SECTION_TITLE, SECTION_INDEX_TITLE, runLibraryRebuild } from './libraryRebuild.ts'

const NOW = new Date('2026-08-20T18:00:00Z')
const USER = 'user-1'

const capturePage = (over: Record<string, unknown>) => ({
  user_id: USER,
  library_role: 'capture',
  library_rebuilt_at: null,
  content: {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { id: 'h-sum', level: 2 }, content: [{ type: 'text', text: 'Summary' }] },
      { type: 'paragraph', attrs: { id: 'p-sum' }, content: [{ type: 'text', text: 'A model-written summary.' }] },
      { type: 'heading', attrs: { id: 'h-notes', level: 2 }, content: [{ type: 'text', text: 'My notes' }] },
      {
        type: 'bulletList',
        attrs: { id: 'bl' },
        content: [
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                attrs: { id: 'n1' },
                content: [{ type: 'text', text: 'Aug 20 — the thought they sent' }],
              },
            ],
          },
        ],
      },
    ],
  },
  ...over,
})

/**
 * A Library with two sections: Running (a capture arrived today) and Film
 * (nothing since July). Each has a topic that was last rebuilt on Aug 1, so
 * Running's topic is stale and Film's is not — which is the scoping signal.
 */
function fixture() {
  return {
    notebooks: [{ id: 'nb-lib', user_id: USER, type: 'library' }],
    sections: [
      { id: 'sec-running', title: 'Running', notebook_id: 'nb-lib', sort_order: null },
      { id: 'sec-film', title: 'Film', notebook_id: 'nb-lib', sort_order: null },
    ],
    pages: [
      capturePage({
        id: 'cap-running',
        title: 'A tough first marathon',
        section_id: 'sec-running',
        created_at: '2026-08-20T16:46:00Z',
      }),
      capturePage({
        id: 'cap-film',
        title: 'An old note',
        section_id: 'sec-film',
        created_at: '2026-07-01T00:00:00Z',
      }),
      {
        id: 'topic-fueling',
        title: 'Fueling',
        section_id: 'sec-running',
        user_id: USER,
        library_role: 'topic',
        library_rebuilt_at: '2026-08-01T00:00:00Z',
        created_at: '2026-06-01T00:00:00Z',
        content: { type: 'doc', content: [] },
      },
      {
        id: 'topic-westerns',
        title: 'Westerns',
        section_id: 'sec-film',
        user_id: USER,
        library_role: 'topic',
        library_rebuilt_at: '2026-08-01T00:00:00Z',
        created_at: '2026-06-01T00:00:00Z',
        content: { type: 'doc', content: [] },
      },
    ] as any[],
    library_sources: [
      { page_id: 'cap-running', source_meta: { showName: 'Long Run Radio' } },
    ],
    library_topic_members: [
      { topic_page_id: 'topic-fueling', capture_page_id: 'cap-running', user_id: USER },
    ],
    library_activity: [] as any[],
  }
}

type Db = ReturnType<typeof fixture>
type Write = { table: string; op: 'insert' | 'update'; id?: string; payload: any }

/**
 * Minimal Supabase stub, in the style of telegram-bot/tools.test.ts: a thenable
 * builder that ignores filters it doesn't need and records every write. The
 * point of recording writes rather than diffing the db is the dry-run test —
 * "wrote nothing" has to mean no call was made, not that the result looked the
 * same.
 */
function makeSupabase(db: Db) {
  const writes: Write[] = []
  let seq = 0

  const query = (table: string) => {
    const state: any = { table, op: 'select', filters: [] as Array<[string, unknown]>, payload: null }

    const run = () => {
      const rows = (db as any)[table] ?? []

      if (state.op === 'insert') {
        const payloads = Array.isArray(state.payload) ? state.payload : [state.payload]
        const inserted = payloads.map((payload: any) => {
          seq += 1
          const row = {
            id: payload.id ?? `${table}-new-${seq}`,
            created_at: NOW.toISOString(),
            ...payload,
          }
          rows.push(row)
          writes.push({ table, op: 'insert', payload })
          return row
        })
        ;(db as any)[table] = rows
        return { data: state.single ? inserted[0] : inserted, error: null }
      }

      if (state.op === 'update') {
        const id = state.filters.find(([col]: [string, unknown]) => col === 'id')?.[1] as string
        writes.push({ table, op: 'update', id, payload: state.payload })
        const row = rows.find((candidate: any) => candidate.id === id)
        if (row) Object.assign(row, state.payload)
        return { data: row ?? null, error: null }
      }

      let data = [...rows]
      if (table === 'library_activity') {
        data.sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at)))
        if (state.limit != null) data = data.slice(0, state.limit)
      }
      return { data: state.single ? (data[0] ?? null) : data, error: null }
    }

    const builder: any = {
      select: () => builder,
      insert: (payload: any) => {
        state.op = 'insert'
        state.payload = payload
        return builder
      },
      update: (payload: any) => {
        state.op = 'update'
        state.payload = payload
        return builder
      },
      eq: (col: string, value: unknown) => {
        state.filters.push([col, value])
        return builder
      },
      in: () => builder,
      order: () => builder,
      limit: (n: number) => {
        state.limit = n
        return builder
      },
      single: () => {
        state.single = true
        return builder
      },
      maybeSingle: () => {
        state.single = true
        return builder
      },
      then: (resolve: any, reject: any) => Promise.resolve(run()).then(resolve, reject),
    }
    return builder
  }

  return { supabase: { from: query }, writes }
}

const pagesNamed = (db: Db, role: string) =>
  db.pages.filter((page: any) => page.library_role === role)

describe('runLibraryRebuild', () => {
  it('rebuilds a stale topic and logs the skip for one that has no new captures', async () => {
    const db = fixture()
    const { supabase, writes } = makeSupabase(db)

    const { summary, log } = await runLibraryRebuild(supabase, { timeZone: 'UTC', now: NOW })

    expect(summary.ok).toBe(true)
    expect(summary.topicsRebuilt).toBe(1)
    expect(summary.topicsSkipped).toBe(1)

    // The skip is LOGGED, not silent — that is what makes the scoping visible
    // in Activity rather than something the user has to take on faith.
    const skip = log.find((entry) => entry.kind === 'skipped')
    expect(skip?.summary).toContain('Westerns')
    expect(skip?.summary).toContain('Film')

    expect(writes.some((write) => write.op === 'update' && write.id === 'topic-fueling')).toBe(true)
    expect(writes.some((write) => write.op === 'update' && write.id === 'topic-westerns')).toBe(false)
  })

  it('honours sectionIds — a capture only re-renders its own section', async () => {
    const db = fixture()
    const { supabase, writes } = makeSupabase(db)

    const { summary, log } = await runLibraryRebuild(supabase, {
      timeZone: 'UTC',
      now: NOW,
      sectionIds: ['sec-running'],
    })

    // Film is out of scope entirely: not rebuilt, and not even reported as a
    // skip, because a skip means "considered and passed over".
    expect(summary.sectionsRebuilt).toBe(1)
    expect(summary.topicsRebuilt).toBe(1)
    expect(summary.topicsSkipped).toBe(0)
    expect(log.some((entry) => entry.summary.includes('Westerns'))).toBe(false)

    const fronts = pagesNamed(db, 'section_index')
    expect(fronts.map((page: any) => page.section_id)).toEqual(['sec-running'])

    // Lately and Activity are Library-wide, so they rebuild regardless of scope.
    expect(summary.latelyRebuilt).toBe(1)
    expect(pagesNamed(db, 'activity')).toHaveLength(1)
  })

  it('creates the home section once, then reuses it', async () => {
    const db = fixture()
    const { supabase, writes } = makeSupabase(db)

    const first = await runLibraryRebuild(supabase, { timeZone: 'UTC', now: NOW })
    expect(first.summary.homeSectionCreated).toBe(true)
    expect(first.log.some((entry) => entry.summary.includes(`created the "${HOME_SECTION_TITLE}" section`))).toBe(true)

    const second = await runLibraryRebuild(supabase, { timeZone: 'UTC', now: NOW })
    expect(second.summary.homeSectionCreated).toBe(false)

    const created = writes.filter((write) => write.table === 'sections' && write.op === 'insert')
    expect(created).toHaveLength(1)
    expect(created[0].payload.title).toBe(HOME_SECTION_TITLE)
    // Existing sections carry a null sort_order and the app orders nullsFirst,
    // so any integer puts Overview at the bottom of the sidebar.
    expect(Number.isInteger(created[0].payload.sort_order)).toBe(true)

    // Lately and Activity live there — not squatting in whichever section
    // happened to be first.
    const homeId = db.sections.find((section) => section.title === HOME_SECTION_TITLE)?.id
    expect(pagesNamed(db, 'lately')[0].section_id).toBe(homeId)
    expect(pagesNamed(db, 'activity')[0].section_id).toBe(homeId)
    expect(pagesNamed(db, 'lately')).toHaveLength(1)
    expect(pagesNamed(db, 'activity')).toHaveLength(1)
  })

  it('gives every other section a front page called Overview, but not the home section', async () => {
    const db = fixture()
    const { supabase } = makeSupabase(db)

    await runLibraryRebuild(supabase, { timeZone: 'UTC', now: NOW })
    await runLibraryRebuild(supabase, { timeZone: 'UTC', now: NOW })

    const homeId = db.sections.find((section) => section.title === HOME_SECTION_TITLE)?.id
    const fronts = pagesNamed(db, 'section_index')

    expect(fronts.map((page: any) => page.title)).toEqual([SECTION_INDEX_TITLE, SECTION_INDEX_TITLE])
    expect(fronts.map((page: any) => page.section_id).sort()).toEqual(['sec-film', 'sec-running'])
    expect(fronts.some((page: any) => page.section_id === homeId)).toBe(false)
  })

  it('finds the home section by what it holds, so renaming it never spawns a second', async () => {
    const db = fixture()
    const { supabase, writes } = makeSupabase(db)

    await runLibraryRebuild(supabase, { timeZone: 'UTC', now: NOW })

    // The user renames it to whatever they like. Lately and Activity stay put.
    const home: any = db.sections.find((section) => section.title === HOME_SECTION_TITLE)
    home.title = 'Shelf'

    const { summary } = await runLibraryRebuild(supabase, { timeZone: 'UTC', now: NOW })

    expect(summary.homeSectionCreated).toBe(false)
    expect(writes.filter((write) => write.table === 'sections' && write.op === 'insert')).toHaveLength(1)
    expect(db.sections.filter((section) => section.title === HOME_SECTION_TITLE)).toHaveLength(0)
    // And they still live in the renamed section, not a fresh one.
    expect(pagesNamed(db, 'lately')[0].section_id).toBe(home.id)
    expect(pagesNamed(db, 'activity')[0].section_id).toBe(home.id)
    // Still no front-page index inside it.
    expect(pagesNamed(db, 'section_index').some((page: any) => page.section_id === home.id)).toBe(false)
  })

  it('writes absolutely nothing in a dry run, but says what it would do', async () => {
    const db = fixture()
    const { supabase, writes } = makeSupabase(db)

    const { summary, log } = await runLibraryRebuild(supabase, {
      timeZone: 'UTC',
      now: NOW,
      dryRun: true,
    })

    expect(summary.dryRun).toBe(true)
    expect(writes).toEqual([])
    expect(db.library_activity).toEqual([])

    const said = log.map((entry) => entry.summary).join('\n')
    expect(said).toContain(`would create the "${HOME_SECTION_TITLE}" section`)
    expect(said).toContain('would create the "Lately" page')
    expect(said).toContain('would create the "Activity" page')
    expect(said).toContain(`would create the "${SECTION_INDEX_TITLE}" page`)
  })

  it('never writes a capture page', async () => {
    const db = fixture()
    const { supabase, writes } = makeSupabase(db)

    await runLibraryRebuild(supabase, { timeZone: 'UTC', now: NOW })

    // The structural safety property: the user's own words live on capture
    // pages, and no code path here touches one.
    const captureIds = pagesNamed(db, 'capture').map((page: any) => page.id)
    const touched = writes
      .filter((write) => write.table === 'pages' && write.op === 'update')
      .map((write) => write.id)
    for (const id of captureIds) expect(touched).not.toContain(id)
  })

  it('refuses if something ever hands it a capture page, loudly', async () => {
    const db = fixture()
    // A topic row pointing at content that is really a capture is the shape of
    // the bug this guards against: role is the only thing writeOwnedPage trusts.
    ;(db.pages.find((page: any) => page.id === 'topic-fueling') as any).library_role = 'capture'
    const { supabase, writes } = makeSupabase(db)
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})

    await runLibraryRebuild(supabase, { timeZone: 'UTC', now: NOW })

    expect(writes.some((write) => write.op === 'update' && write.id === 'topic-fueling')).toBe(false)
    errors.mockRestore()
  })

  it('quotes the user’s own note onto the section front page', async () => {
    const db = fixture()
    const { supabase, writes } = makeSupabase(db)

    await runLibraryRebuild(supabase, { timeZone: 'UTC', now: NOW, sectionIds: ['sec-running'] })

    const front = pagesNamed(db, 'section_index')[0]
    const flat = JSON.stringify(front.content)
    expect(flat).toContain('A tough first marathon')
    expect(flat).toContain('the thought they sent')
    expect(flat).toContain('Long Run Radio')
    // Recall, not synthesis: the model-written summary stays on the capture.
    expect(flat).not.toContain('A model-written summary')
    expect(writes.length).toBeGreaterThan(0)
  })

  it('lets Lately reach back a month, not a week', async () => {
    const db = fixture()
    // Saved twelve days before NOW: invisible under the old 7-day window,
    // present under 30. The cron cadence is weekly; the window is not.
    db.pages.push(
      capturePage({
        id: 'cap-fortnight',
        title: 'Saved a fortnight ago',
        section_id: 'sec-running',
        created_at: '2026-08-08T09:00:00Z',
      }) as any,
    )
    const { supabase } = makeSupabase(db)

    await runLibraryRebuild(supabase, { timeZone: 'UTC', now: NOW })

    const lately: any = pagesNamed(db, 'lately')[0]
    const flat = JSON.stringify(lately.content)
    expect(flat).toContain('Saved a fortnight ago')
    // Still bounded — the July capture is well outside it.
    expect(flat).not.toContain('An old note')
    expect(flat).not.toContain('Week of')
  })

  it('says what kind of thing each saved item is', async () => {
    const db = fixture()
    ;(db.library_sources[0] as any).source_type = 'podcast'
    const { supabase } = makeSupabase(db)

    await runLibraryRebuild(supabase, { timeZone: 'UTC', now: NOW, sectionIds: ['sec-running'] })

    const front: any = pagesNamed(db, 'section_index')[0]
    expect(JSON.stringify(front.content)).toContain('Podcast · Long Run Radio')
  })

  it('carries the stored filing reason onto the topic catalog', async () => {
    const db = fixture()
    ;(db.library_topic_members[0] as any).reason = 'the fueling stretch near the end'
    const { supabase } = makeSupabase(db)

    await runLibraryRebuild(supabase, { timeZone: 'UTC', now: NOW, sectionIds: ['sec-running'] })

    const topic: any = db.pages.find((page: any) => page.id === 'topic-fueling')
    expect(JSON.stringify(topic.content)).toContain('filed here: the fueling stretch near the end')
  })

  it('renders a membership with no reason exactly as before', async () => {
    // Every row in library_topic_members predating this change has a null
    // reason, and must render as a plain catalog line rather than a stub.
    const db = fixture()
    const { supabase } = makeSupabase(db)

    await runLibraryRebuild(supabase, { timeZone: 'UTC', now: NOW, sectionIds: ['sec-running'] })

    const topic: any = db.pages.find((page: any) => page.id === 'topic-fueling')
    const flat = JSON.stringify(topic.content)
    expect(flat).toContain('A tough first marathon')
    expect(flat).not.toContain('filed here')
  })

  it('reports a load failure instead of throwing', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = {
      from: () => ({
        select: () => ({
          eq: () => Promise.resolve({ data: null, error: { message: 'boom' } }),
        }),
      }),
    }

    const { summary } = await runLibraryRebuild(broken as any, { timeZone: 'UTC', now: NOW })
    expect(summary.ok).toBe(false)
    expect(summary.error).toBe('Failed to load notebooks')
    errors.mockRestore()
  })

  it('stops quietly when there is no Library at all', async () => {
    const db = { ...fixture(), notebooks: [] }
    const { supabase, writes } = makeSupabase(db as any)

    const { summary } = await runLibraryRebuild(supabase, { timeZone: 'UTC', now: NOW })
    expect(summary.ok).toBe(true)
    expect(summary.note).toBe('no library notebooks')
    expect(writes).toEqual([])
  })
})
