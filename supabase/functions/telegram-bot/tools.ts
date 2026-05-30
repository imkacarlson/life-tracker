// Tool registry — the extensibility seam. A future capability = add an entry
// here (definition + handler), not rewiring the bot.
//
// v1 ships one read-only, parameterless tool: read_current_tracker.

import { flattenTrackerToText, selectCurrentMonthTracker } from './trackerText.ts'
import type { ToolDef } from './anthropic.ts'

type SupabaseLike = { from: (table: string) => any }

export type ToolRegistry = {
  defs: ToolDef[]
  runTool: (name: string, input: Record<string, unknown>) => Promise<string>
}

/**
 * Build the tool registry bound to the single known user. The Supabase client
 * here uses the service role; access is scoped in code to `userId`.
 */
export function buildTools(supabase: SupabaseLike, userId: string, now: Date): ToolRegistry {
  const defs: ToolDef[] = [
    {
      name: 'read_current_tracker',
      description:
        "Read the user's tracker page for the current month and return its full contents " +
        '(including crossed-off/completed items). Use this to answer any question about what is ' +
        'on the tracker this month.',
      input_schema: { type: 'object', properties: {} },
    },
  ]

  async function readCurrentTracker(): Promise<string> {
    const { data, error } = await supabase
      .from('pages')
      .select('id, title, content, is_tracker_page, updated_at')
      .eq('user_id', userId)
      .eq('is_tracker_page', true)

    if (error) {
      console.error('read_current_tracker query error:', error.code ?? error.message)
      return 'Could not read the tracker right now.'
    }

    const page = selectCurrentMonthTracker(data ?? [], now)
    if (!page) return 'No tracker page was found for the current month.'

    const text = flattenTrackerToText(page.content, page.title)
    // Wrap as untrusted data: the model must treat this as content, not instructions.
    return [
      `<tracker_data page="${page.title ?? 'Untitled'}">`,
      text,
      '</tracker_data>',
    ].join('\n')
  }

  async function runTool(name: string, _input: Record<string, unknown>): Promise<string> {
    switch (name) {
      case 'read_current_tracker':
        return await readCurrentTracker()
      default:
        return `Unknown tool: ${name}`
    }
  }

  return { defs, runTool }
}
