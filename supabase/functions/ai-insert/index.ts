import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type ProviderConfig = {
  url: string
  buildRequest: (
    model: string,
    systemPrompt: string,
    userMessage: string,
    apiKey: string,
  ) => { headers: Record<string, string>, body: string }
  extractResponse: (data: any) => string
}

type AiInsertPayload = {
  targetBlockId: string | null
  placement: 'after'
  format: 'bullet_list' | 'task_list' | 'paragraphs'
  items: string[]
  notes: string | null
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
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    }),
    extractResponse: (data) => data.content?.[0]?.text ?? '',
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
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      }),
    }),
    extractResponse: (data) => data.choices?.[0]?.message?.content ?? '',
  },
  google: {
    url: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
    buildRequest: (model, systemPrompt, userMessage, _apiKey) => ({
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: userMessage }] }],
      }),
    }),
    extractResponse: (data) => data.candidates?.[0]?.content?.parts?.[0]?.text ?? '',
  },
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
    },
  })

const extractBlockIds = (pageText: string) => {
  const matches = pageText.matchAll(/\{\{id:([^}]+)\}\}/g)
  const ids = new Set<string>()
  for (const match of matches) {
    const candidate = String(match[1] || '').trim()
    if (candidate) ids.add(candidate)
  }
  return Array.from(ids)
}

const parseJsonFromText = (rawText: string) => {
  const direct = String(rawText || '').trim()
  if (!direct) return null

  try {
    return JSON.parse(direct)
  } catch {
    // continue
  }

  const fencedMatch = direct.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fencedMatch?.[1]) {
    try {
      return JSON.parse(fencedMatch[1].trim())
    } catch {
      // continue
    }
  }

  const firstBrace = direct.indexOf('{')
  const lastBrace = direct.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(direct.slice(firstBrace, lastBrace + 1))
    } catch {
      return null
    }
  }

  return null
}

const normalizeFormat = (value: unknown): AiInsertPayload['format'] => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')

  if (normalized === 'task_list' || normalized === 'task' || normalized === 'tasks') {
    return 'task_list'
  }

  if (normalized === 'paragraphs' || normalized === 'paragraph') {
    return 'paragraphs'
  }

  return 'bullet_list'
}

const normalizeItems = (value: unknown) => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean)
  }

  if (typeof value === 'string') {
    return value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
  }

  return []
}

const parseAiInsertPayload = (rawText: string): AiInsertPayload => {
  const parsed = parseJsonFromText(rawText)
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('AI response did not contain valid JSON.')
  }

  const targetBlockCandidate =
    (parsed as Record<string, unknown>).targetBlockId ??
    (parsed as Record<string, unknown>).target_block_id ??
    (parsed as Record<string, unknown>).blockId ??
    (parsed as Record<string, unknown>).block_id

  const targetBlockId =
    typeof targetBlockCandidate === 'string' && targetBlockCandidate.trim()
      ? targetBlockCandidate.trim()
      : null

  const format = normalizeFormat((parsed as Record<string, unknown>).format)

  const primaryItems = normalizeItems((parsed as Record<string, unknown>).items)
  const items = primaryItems.length
    ? primaryItems
    : normalizeItems((parsed as Record<string, unknown>).content)

  if (!items.length) {
    throw new Error('AI Insert response did not include any items.')
  }

  const notes =
    typeof (parsed as Record<string, unknown>).notes === 'string' &&
    String((parsed as Record<string, unknown>).notes).trim()
      ? String((parsed as Record<string, unknown>).notes).trim()
      : null

  return {
    targetBlockId,
    placement: 'after',
    format,
    items,
    notes,
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return jsonResponse({ error: 'Not authenticated' }, 401)
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
    return jsonResponse({ error: 'Invalid token' }, 401)
  }

  try {
    const { provider, model, pastedText, pageTitle, pageText, pageId } = await req.json()

    if (!provider || !model || !pastedText || !pageText) {
      return jsonResponse({ error: 'Missing required fields.' }, 400)
    }

    const providerConfig = PROVIDERS[provider]
    if (!providerConfig) {
      return jsonResponse({ error: `Unknown provider: ${provider}` }, 400)
    }

    const apiKeyEnvMap: Record<string, string> = {
      anthropic: 'ANTHROPIC_API_KEY',
      openai: 'OPENAI_API_KEY',
      google: 'GOOGLE_API_KEY',
    }

    const apiKey = Deno.env.get(apiKeyEnvMap[provider])
    if (!apiKey) {
      return jsonResponse({ error: `No API key configured for ${provider}` }, 500)
    }

    const availableBlockIds = extractBlockIds(String(pageText))
    const availableIdsSet = new Set(availableBlockIds)

    const systemPrompt = `You are an assistant that places pasted notes into a single rich-text page.

You must return ONLY valid JSON with this exact shape:
{"targetBlockId":"string or null","placement":"after","format":"bullet_list|task_list|paragraphs","items":["string"],"notes":"string or null"}

Rules:
- Use ONLY the provided page content and available block IDs.
- targetBlockId must be one ID from AVAILABLE_BLOCK_IDS, otherwise return null.
- placement must always be "after".
- format must be one of: bullet_list, task_list, paragraphs.
- items must be concise plain-text lines (no markdown, no IDs, no commentary).
- Keep all important details from pasted content, but compress wording.
- If no strong anchor exists, return targetBlockId as null.
- Never output text outside the JSON object.`

    const userMessage = [
      `PAGE_ID: ${String(pageId || '')}`,
      `PAGE_TITLE: ${String(pageTitle || 'Untitled')}`,
      `AVAILABLE_BLOCK_IDS: ${JSON.stringify(availableBlockIds)}`,
      `PASTED_CONTENT:\n${String(pastedText)}`,
      `PAGE_TEXT:\n${String(pageText)}`,
    ].join('\n\n')

    let fetchUrl = providerConfig.url
    if (provider === 'google') {
      fetchUrl = fetchUrl.replace('{model}', String(model)) + `?key=${apiKey}`
    }

    const { headers, body } = providerConfig.buildRequest(String(model), systemPrompt, userMessage, apiKey)
    const response = await fetch(fetchUrl, { method: 'POST', headers, body })
    const responseData = await response.json()

    if (!response.ok) {
      return jsonResponse({ error: 'LLM API error', details: responseData }, 502)
    }

    const rawText = providerConfig.extractResponse(responseData)
    const parsed = parseAiInsertPayload(rawText)

    const targetBlockId =
      parsed.targetBlockId && availableIdsSet.has(parsed.targetBlockId)
        ? parsed.targetBlockId
        : null

    const notes =
      parsed.targetBlockId && !targetBlockId
        ? 'AI target was not found on the current page. Falling back to top insertion.'
        : parsed.notes

    return jsonResponse({
      targetBlockId,
      placement: 'after',
      format: parsed.format,
      items: parsed.items,
      notes,
    })
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500)
  }
})
