import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'jsr:@supabase/supabase-js@2'

// AI Find: given a short natural-language query and the current page's blocks
// ({id, text}), return the ids of blocks that semantically match. Mirrors the
// structure/CORS/auth of ai-insert/index.ts.
//
// Cost control: the (larger, stable) block list goes in the SYSTEM prompt with
// cache_control so refining the query within the 5-min TTL re-reads it at ~10%
// cost. The short query is the user message. Default model is Haiku.

const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') || '*'
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Input guardrails (trust boundary).
const MAX_QUERY_CHARS = 300
const MAX_BLOCKS = 500
const MAX_TOTAL_BLOCK_CHARS = 60000
const MAX_BLOCK_TEXT_CHARS = 2000

type Block = { id: string; text: string }

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })

type ProviderConfig = {
  url: string
  buildRequest: (
    model: string,
    systemPrompt: string,
    userMessage: string,
    apiKey: string,
  ) => { headers: Record<string, string>; body: string }
  extractMatchIds: (data: any) => string[]
}

const FIND_TOOL = {
  name: 'report_matches',
  description:
    'Report the ids of the blocks that semantically match the search description. Return an empty array if none match.',
  input_schema: {
    type: 'object',
    properties: {
      matchIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'Block ids (from the provided list) that match the description.',
      },
    },
    required: ['matchIds'],
  },
}

const extractIdsFromText = (text: string): string[] => {
  const direct = String(text || '').trim()
  if (!direct) return []
  const tryParse = (raw: string): string[] | null => {
    try {
      const parsed = JSON.parse(raw)
      const ids = parsed?.matchIds ?? parsed
      if (Array.isArray(ids)) return ids.map((x) => String(x))
      return null
    } catch {
      return null
    }
  }
  const first = direct.indexOf('{')
  const last = direct.lastIndexOf('}')
  if (first !== -1 && last !== -1 && last > first) {
    const out = tryParse(direct.slice(first, last + 1))
    if (out) return out
  }
  return tryParse(direct) ?? []
}

const PROVIDERS: Record<string, ProviderConfig> = {
  anthropic: {
    url: 'https://api.anthropic.com/v1/messages',
    buildRequest: (model, systemPrompt, userMessage, apiKey) => ({
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      // cache_control on the system block caches the stable block list, so
      // refining the query within the TTL re-reads it at ~10% cost.
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
        tools: [FIND_TOOL],
        tool_choice: { type: 'tool', name: FIND_TOOL.name },
        messages: [{ role: 'user', content: userMessage }],
      }),
    }),
    extractMatchIds: (data) => {
      const blocks = Array.isArray(data?.content) ? data.content : []
      for (const block of blocks) {
        if (block.type === 'tool_use' && block.name === FIND_TOOL.name) {
          const ids = block.input?.matchIds
          if (Array.isArray(ids)) return ids.map((x: unknown) => String(x))
        }
      }
      // Fallback: some responses may include plain text.
      const text = blocks.find((b: any) => b.type === 'text')?.text ?? ''
      return extractIdsFromText(text)
    },
  },
  openai: {
    url: 'https://api.openai.com/v1/chat/completions',
    buildRequest: (model, systemPrompt, userMessage, apiKey) => ({
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      }),
    }),
    extractMatchIds: (data) => extractIdsFromText(data.choices?.[0]?.message?.content ?? ''),
  },
  google: {
    url: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
    buildRequest: (model, systemPrompt, userMessage, _apiKey) => ({
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: userMessage }] }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
    }),
    extractMatchIds: (data) =>
      extractIdsFromText(data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''),
  },
}

/**
 * Validate and normalize the incoming blocks. Returns null on malformed input.
 */
const normalizeBlocks = (raw: unknown): Block[] | null => {
  if (!Array.isArray(raw)) return null
  if (raw.length > MAX_BLOCKS) return null
  const blocks: Block[] = []
  let totalChars = 0
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') return null
    const id = String((entry as Record<string, unknown>).id ?? '').trim()
    const text = String((entry as Record<string, unknown>).text ?? '')
      .slice(0, MAX_BLOCK_TEXT_CHARS)
      .trim()
    if (!id || !text) continue
    totalChars += text.length
    if (totalChars > MAX_TOTAL_BLOCK_CHARS) return null
    blocks.push({ id, text })
  }
  return blocks
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return jsonResponse({ success: false, error: 'Not authenticated' }, 401)
  }

  const supabaseClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } },
  )

  const {
    data: { user },
    error: authError,
  } = await supabaseClient.auth.getUser()

  if (authError || !user) {
    return jsonResponse({ success: false, error: 'Invalid token' }, 401)
  }

  try {
    const body = await req.json()
    const provider = String(body?.provider || 'anthropic')
    const model = String(body?.model || 'claude-haiku-4-5-20251001')
    const query = String(body?.query ?? '').trim()

    if (!query) {
      return jsonResponse({ success: false, error: 'Missing query.' }, 400)
    }
    if (query.length > MAX_QUERY_CHARS) {
      return jsonResponse({ success: false, error: 'Query too long.' }, 400)
    }

    const blocks = normalizeBlocks(body?.blocks)
    if (blocks === null) {
      return jsonResponse({ success: false, error: 'Malformed or oversized blocks.' }, 400)
    }
    if (blocks.length === 0) {
      return jsonResponse({ success: true, data: { matchIds: [] } })
    }

    const providerConfig = PROVIDERS[provider]
    if (!providerConfig) {
      return jsonResponse({ success: false, error: `Unknown provider: ${provider}` }, 400)
    }

    const apiKeyEnvMap: Record<string, string> = {
      anthropic: 'ANTHROPIC_API_KEY',
      openai: 'OPENAI_API_KEY',
      google: 'GOOGLE_API_KEY',
    }
    const apiKey = Deno.env.get(apiKeyEnvMap[provider])
    if (!apiKey) {
      return jsonResponse({ success: false, error: `No API key configured for ${provider}` }, 500)
    }

    const allowedIds = new Set(blocks.map((b) => b.id))

    const systemPrompt = `You are a search assistant for a single rich-text page. You are given a list of BLOCKS, each with an "id" and "text". The user will describe what they are looking for in natural language (not an exact string).

Return the ids of the blocks whose text semantically matches the user's description. Match on meaning, not exact words. Be selective — only return blocks that genuinely fit. Return an empty array if nothing matches.

You MUST use ONLY ids that appear in the BLOCKS list. Never invent ids.

BLOCKS:
${JSON.stringify(blocks)}`

    const userMessage = `Find blocks matching: ${query}`

    let fetchUrl = providerConfig.url
    if (provider === 'google') {
      fetchUrl = fetchUrl.replace('{model}', model) + `?key=${apiKey}`
    }

    const { headers, body: requestBody } = providerConfig.buildRequest(
      model,
      systemPrompt,
      userMessage,
      apiKey,
    )
    const response = await fetch(fetchUrl, { method: 'POST', headers, body: requestBody })
    const responseData = await response.json()

    if (!response.ok) {
      console.error('LLM API error:', JSON.stringify(responseData))
      return jsonResponse({ success: false, error: 'LLM API error. Check edge function logs.' }, 502)
    }

    const rawIds = providerConfig.extractMatchIds(responseData)
    // Server-side validation: drop hallucinated ids and dedupe.
    const matchIds = Array.from(new Set(rawIds.filter((id) => allowedIds.has(id))))

    return jsonResponse({ success: true, data: { matchIds } })
  } catch (err) {
    console.error('ai-find error:', err)
    return jsonResponse({ success: false, error: 'Internal error processing AI find request.' }, 500)
  }
})
