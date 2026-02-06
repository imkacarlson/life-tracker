import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'jsr:@supabase/supabase-js@2'

import {
  buildCandidatesForModel,
  mapTasksFromCids,
  parseTaskBuckets,
} from './dailyHelpers.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const PROVIDERS: Record<string, {
  url: string
  buildRequest: (model: string, systemPrompt: string, userMessage: string, apiKey: string) => { headers: Record<string, string>, body: string }
  extractResponse: (data: any) => string
}> = {
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

const appendWarning = (existing: string | null, next: string) => (existing ? `${existing} ${next}` : next)

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

  const { data: { user }, error: authError } = await supabaseClient.auth.getUser()
  if (authError || !user) {
    return jsonResponse({ error: 'Invalid token' }, 401)
  }

  try {
    const { provider, model, trackerPages, today, dayOfWeek } = await req.json()

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

    const { candidates, cidToBlockId, cidToText } = buildCandidatesForModel(trackerPages, today)

    if (!candidates.length) {
      return jsonResponse({
        asap: [],
        fyi: [],
        stale: [],
        rawText: '',
        warning: null,
      })
    }

    const systemPrompt = `You are a daily planner assistant. Today is ${today} (${dayOfWeek}).

The user provides compact candidate tasks in JSON. Use only those candidates.
Each candidate has metadata fields:
- due_bucket: overdue | today | soon | later | none
- is_overdue: boolean
- has_explicit_date: boolean
- age_days: integer or null

Rules:
- Metadata fields are deterministic server metadata. They are NOT literal due dates.
- has_explicit_date=true means the source item contains a user-highlighted due date.
- If has_explicit_date=false, treat date-like text as context/status notes, not due dates.
- Do not infer due dates from age_days or any metadata value.
- Use only candidate text + metadata to prioritize and bucket tasks.
- If due_bucket is later, omit the item.
- STALE is only for has_explicit_date=false and age_days >= 7.
- ASAP is overdue/today items plus undated urgent items.
- FYI is due_bucket=soon.
- Keep task text concise and actionable.
- Use cids (not block IDs) in output.

Respond with ONLY a JSON object, no other text. Use this exact shape:
{"asap":[{"task":"short task description","cids":["c1","c2"],"priority":"high"|"medium"|"low"}],"fyi":[{"task":"short task description","cids":["c1"],"priority":"high"|"medium"|"low"}],"stale":[{"task":"short task description","cids":["c1"],"priority":"high"|"medium"|"low"}]}

If a bucket is empty, return an empty array.`

    const userMessage = [
      `TODAY: ${today}`,
      `DAY_OF_WEEK: ${dayOfWeek}`,
      `CANDIDATES_JSON: ${JSON.stringify(candidates)}`,
    ].join('\n')

    let fetchUrl = providerConfig.url
    if (provider === 'google') {
      fetchUrl = fetchUrl.replace('{model}', model) + `?key=${apiKey}`
    }

    const { headers, body } = providerConfig.buildRequest(model, systemPrompt, userMessage, apiKey)

    const response = await fetch(fetchUrl, { method: 'POST', headers, body })
    const data = await response.json()

    if (!response.ok) {
      return jsonResponse({ error: 'LLM API error', details: data }, 502)
    }

    const rawText = providerConfig.extractResponse(data)
    const parsed = parseTaskBuckets(rawText)

    const allowedCids = new Set(candidates.map((candidate) => candidate.cid))

    const mappedAsap = mapTasksFromCids(parsed.asap, allowedCids, cidToBlockId, cidToText)
    const mappedFyi = mapTasksFromCids(parsed.fyi, allowedCids, cidToBlockId, cidToText)
    const mappedStale = mapTasksFromCids(parsed.stale, allowedCids, cidToBlockId, cidToText)

    const asap = mappedAsap.mapped
    const fyi = mappedFyi.mapped
    const stale = mappedStale.mapped

    const totalParsedCount =
      (parsed.asap?.length || 0) +
      (parsed.fyi?.length || 0) +
      (parsed.stale?.length || 0)
    const totalMappedCount = asap.length + fyi.length + stale.length

    let warning =
      parsed.format === 'asap_fyi'
        ? null
        : 'FYI: AI response did not follow the ASAP/FYI format. Results may be incomplete.'

    if (totalParsedCount > totalMappedCount) {
      warning = appendWarning(
        warning,
        'FYI: Some tasks were removed because AI returned missing or invalid candidate IDs.',
      )
    }

    if (
      mappedAsap.removedForInvalidCids > 0 ||
      mappedFyi.removedForInvalidCids > 0 ||
      mappedStale.removedForInvalidCids > 0
    ) {
      warning = appendWarning(
        warning,
        'FYI: AI output must use cids from CANDIDATES_JSON. Non-cid references were ignored.',
      )
    }

    return jsonResponse({
      asap,
      fyi,
      stale,
      rawText,
      warning,
    })
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500)
  }
})
