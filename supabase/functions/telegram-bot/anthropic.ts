// Claude call with a minimal agentic loop (tool_use -> tool_result -> final text).
//
// Reuses the request shape from generate-daily/index.ts (URL, anthropic-version
// header, x-api-key, max_tokens) but, unlike generate-daily, sends a multi-turn
// `messages` array plus `tools` so the model can call read_current_tracker.

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

export type ChatMessage = { role: 'user' | 'assistant'; content: unknown }

export type ToolDef = {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

type CallArgs = {
  system: string
  messages: ChatMessage[]
  tools: ToolDef[]
  runTool: (name: string, input: Record<string, unknown>) => Promise<string>
  model: string
  maxTokens?: number
  maxIterations?: number
  /**
   * Reasoning effort. Only send this for models that support it (Sonnet 5 /
   * Opus 5) — Haiku 4.5 rejects `output_config`, so the classify pass omits it.
   */
  effort?: Effort
  /**
   * Adaptive extended thinking. The older `{type:'enabled', budget_tokens}`
   * shape 400s on Sonnet 5 / Opus 5; adaptive + `effort` replaces it.
   */
  thinking?: { type: 'adaptive' }
}

/**
 * Run Claude until it produces a final text answer, executing any tool calls
 * along the way. Returns the concatenated text of the final assistant turn.
 */
export async function callClaude({
  system,
  messages,
  tools,
  runTool,
  model,
  maxTokens = 2048,
  maxIterations = 4,
  effort,
  thinking,
}: CallArgs): Promise<string> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')

  const working = [...messages]

  for (let i = 0; i < maxIterations; i++) {
    const response = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      // Two cache breakpoints (of the 4 allowed):
      //  1. on the system block — pins the stable tools+system prefix.
      //  2. top-level `cache_control` — Anthropic's automatic caching. The
      //     breakpoint lands on the last cacheable block and moves forward as
      //     the conversation grows, so the big read_tracker_structure tool
      //     result is cached instead of re-billed on every later iteration.
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        tools,
        messages: working,
        cache_control: { type: 'ephemeral' },
        ...(effort ? { output_config: { effort } } : {}),
        ...(thinking ? { thinking } : {}),
      }),
    })

    const data = await response.json()
    if (!response.ok) {
      console.error('Anthropic API error:', response.status, data?.error?.type ?? '')
      throw new Error('Anthropic API error')
    }

    // Cheap observability: proves caching is being hit and shows how much of the
    // budget thinking consumed. Shows up in `supabase functions logs`.
    const u = data.usage ?? {}
    console.log(
      `claude usage [${model} iter=${i}] in=${u.input_tokens ?? 0} ` +
        `cache_write=${u.cache_creation_input_tokens ?? 0} cache_read=${u.cache_read_input_tokens ?? 0} ` +
        `out=${u.output_tokens ?? 0} thinking=${u.output_tokens_details?.thinking_tokens ?? 0}`,
    )

    const content = Array.isArray(data.content) ? data.content : []

    if (data.stop_reason === 'tool_use') {
      // Record the assistant's tool-call turn, then answer each tool_use.
      working.push({ role: 'assistant', content })

      const toolResults = []
      for (const block of content) {
        if (block.type !== 'tool_use') continue
        let resultText: string
        try {
          resultText = await runTool(block.name, block.input ?? {})
        } catch (err) {
          console.error('Tool error:', block.name, String(err))
          resultText = `Error running tool ${block.name}.`
        }
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: resultText })
      }

      working.push({ role: 'user', content: toolResults })
      continue
    }

    // Final answer: concatenate text blocks.
    const text = content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('')
      .trim()
    return text || "Sorry, I couldn't come up with a response."
  }

  return 'That took too many steps — please try rephrasing.'
}
