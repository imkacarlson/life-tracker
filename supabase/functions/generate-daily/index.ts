import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'jsr:@supabase/supabase-js@2'

import {
  buildTrackerContext,
  mapTasksByBucket,
  parseTaskBuckets,
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

    const { markdown, cidToBlockId, cidToText, dateHints } = buildTrackerContext(trackerPages, today)

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

    const systemPrompt = `You are a daily planner assistant. Today is ${today} (${dayOfWeek}).

You are given the user's ENTIRE tracker as lightweight markdown. Every line that can be
linked has a stable anchor like ⟦c12⟧ at the end. Highlighted text is written as [like this];
the user highlights due dates in the tracker. You also get DATE_HINTS: a deterministic first
pass over highlighted dates ("cid | raw date | parsed ISO date | bucket"). The hints are
ADVISORY ONLY — you make the final decision about what belongs on today's list.

Decide which items belong on today's daily list:
- ASAP: due today or overdue.
- FYI: due within about the next 2 days, or a genuine heads-up worth surfacing today.

Judgment principles (follow these carefully):
- Only include items with a real, explicit due date. Leave undated items off entirely — do
  NOT add tasks just to fill the list.
- An EMPTY daily is a valid, good outcome. If nothing is genuinely due, return empty arrays.
  Never pad the list; a tracker full of undated content must not spill in.
- Distinguish a DUE date from a date used as CONTEXT. Journal/log-style dates (e.g. a date
  tagged at the front of an update noting WHEN it was written) are NOT due dates. Judge how
  the date is framed in the sentence.
- Respect the intended year. Skip items clearly meant for a future year even if a bare date
  matches today (e.g. "(of 2028)"). Trust DATE_HINTS' parsed ISO date and bucket for this.
- Handle plain-language or slightly typo'd dates ("June 2nd", "Jun 2") using judgment, even if
  they are not highlighted and not in DATE_HINTS.
- Ignore background, recurring, notes, and status lines.
- Make each task self-contained using its section/parent context (e.g. "Wedding: Book
  photographer"). For FYI items, include the due date inline when the source has one, in its
  original format.
- Keep task text concise and actionable.
- Reference lines ONLY by the ⟦cid⟧ anchors that actually appear in the tracker. Never invent
  anchors. Put the cids (without the ⟦⟧ brackets) in the "cids" array.

Respond with ONLY a JSON object, no other text. Use this exact shape:
{"asap":[{"task":"short task description","cids":["c1","c2"],"priority":"high"|"medium"|"low"}],"fyi":[{"task":"short task description","cids":["c1"],"priority":"high"|"medium"|"low"}]}

If a bucket is empty, return an empty array.`

    const hintLines = dateHints.map(
      (hint) => `${hint.cid} | "${hint.dateText}" | parsed ${hint.parsedIso} | ${hint.bucket}`,
    )

    const userMessage = [
      `TODAY: ${today}`,
      `DAY_OF_WEEK: ${dayOfWeek}`,
      '',
      'TRACKER_MARKDOWN:',
      markdown,
      '',
      'DATE_HINTS:',
      hintLines.length ? hintLines.join('\n') : '(none)',
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
    const parsed = parseTaskBuckets(rawText)

    // The model is the final judge of placement now. We honor its ASAP/FYI
    // buckets, resolve cids to block ids for cross-off linking, and silently
    // drop any cids it invented or that don't exist in the tracker.
    const routed = mapTasksByBucket(parsed, cidToBlockId, cidToText)
    const asap = routed.asap
    const fyi = routed.fyi

    // Only warn when the model failed to produce the expected ASAP/FYI shape at
    // all — that genuinely means results may be incomplete. Dropped/re-routed
    // cids are handled deterministically and need no user-facing warning.
    const warning =
      parsed.format === 'asap_fyi'
        ? null
        : 'FYI: AI response did not follow the ASAP/FYI format. Results may be incomplete.'

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
