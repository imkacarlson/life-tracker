import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'jsr:@supabase/supabase-js@2'

import {
  buildDaily,
  buildTrackerContext,
  parseDateResolutions,
} from './dailyHelpers.ts'

const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') || '*'
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
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

    const { markdown, cidToBlockId, cidToText, candidates, highlightedCids } =
      buildTrackerContext(trackerPages, today)

    // Only bail out when there is genuinely nothing to reason about. Everything
    // else — including "nothing is due" — is the model's call now.
    if (!markdown.trim()) {
      return jsonResponse({
        asap: [],
        fyi: [],
        rawText: '',
        warning: null,
      })
    }

    const systemPrompt = `You are a structured-data extractor for a daily planner. Today is ${today} (${dayOfWeek}).

A deterministic parser already decides WHICH items make today's list, from highlighted MM/DD
dates in the tracker. You do NOT decide what belongs on the list. You have exactly three narrow
jobs, all strictly additive: (1) resolve a due date's YEAR when it is stated in plain language,
(2) phrase each candidate as a clean one-liner from its section/parent context, and (3) flag a
highlighted line that clearly encodes a due date the parser MISSED (e.g. a typo).

You are given the user's ENTIRE tracker as lightweight markdown. Every linkable line ends with a
stable anchor like ⟦c12⟧. Highlighted text is written as [like this]. You also get CANDIDATES:
the lines the parser already matched ("cid | raw MM/DD | line text").

Output ONLY this JSON object, no other text:
{"resolutions":[{"cid":"c1","iso_date":"2027-04-15"|null,"task":"short one-liner"}],"flagged":[{"cid":"c9","iso_date":"2026-03-15","task":"short one-liner"}]}

resolutions — one entry per CANDIDATE cid:
- "iso_date": set a full ISO date ONLY when the line states the year in some form (slash digits,
  written digits, or plain language like "two years out" / "next spring"). Otherwise use null.
  Only the YEAR you provide is used; the parser keeps the month/day. Do not guess a year that
  isn't stated — use null.
- "task": a self-contained one-liner using the section heading and parent/sibling bullets
  (e.g. "Wedding: Book photographer"). Keep it concise and actionable.

flagged — ONLY highlighted lines that clearly encode a due date the parser missed (e.g. a
mistyped date like 4//15, 4/l5, 41/5) and are NOT already in CANDIDATES:
- Reference the line by its ⟦cid⟧ anchor (cid without brackets).
- Give your best-guess "iso_date" (full ISO date) and a "task" one-liner.
- NEVER flag a non-highlighted line. NEVER duplicate a candidate. If nothing qualifies, return [].

Respond with ONLY the JSON object.`

    const candidateLines = candidates.map(
      (candidate) =>
        `${candidate.cid} | "${candidate.dateText}" | ${cidToText.get(candidate.cid) ?? ''}`,
    )

    const userMessage = [
      `TODAY: ${today}`,
      `DAY_OF_WEEK: ${dayOfWeek}`,
      '',
      'TRACKER_MARKDOWN:',
      markdown,
      '',
      'CANDIDATES:',
      candidateLines.length ? candidateLines.join('\n') : '(none)',
    ].join('\n')

    let fetchUrl = providerConfig.url
    if (provider === 'google') {
      fetchUrl = fetchUrl.replace('{model}', model) + `?key=${apiKey}`
    }

    const { headers, body } = providerConfig.buildRequest(model, systemPrompt, userMessage, apiKey)

    const response = await fetch(fetchUrl, { method: 'POST', headers, body })
    const data = await response.json()

    if (!response.ok) {
      console.error('LLM API error:', JSON.stringify(data))
      return jsonResponse({ error: 'LLM API error. Check edge function logs for details.' }, 502)
    }

    const rawText = providerConfig.extractResponse(data)
    const parsed = parseDateResolutions(rawText)

    // The deterministic candidates decide the list; the AI only resolves a
    // plain-language year, phrases each task, and can additively flag a
    // highlighted date the parser couldn't read. The list stands even if the AI
    // call or parse fails.
    const { asap, fyi, feedback } = buildDaily(
      candidates,
      parsed,
      cidToBlockId,
      cidToText,
      highlightedCids,
      today,
    )

    // Surface any additively-flagged items (informational), plus a note when the
    // AI response wasn't the expected JSON object (so phrasing/year-resolution
    // may be missing, though the deterministic list is intact).
    const warningParts: string[] = [...feedback]
    if (parsed.format !== 'resolved') {
      warningParts.push(
        'FYI: AI response did not follow the expected format. Task phrasing may be incomplete.',
      )
    }
    const warning = warningParts.length ? warningParts.join('\n') : null

    return jsonResponse({
      asap,
      fyi,
      rawText,
      warning,
    })
  } catch (err) {
    console.error('generate-daily error:', err)
    return jsonResponse({ error: 'Internal error processing daily generation request.' }, 500)
  }
})
