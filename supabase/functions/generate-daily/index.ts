import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'jsr:@supabase/supabase-js@2'

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
        'Authorization': `Bearer ${apiKey}`,
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
    buildRequest: (model, systemPrompt, userMessage, apiKey) => ({
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: userMessage }] }],
      }),
    }),
    extractResponse: (data) => data.candidates?.[0]?.content?.parts?.[0]?.text ?? '',
  },
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  }

  const supabaseClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } },
  )

  const { data: { user }, error: authError } = await supabaseClient.auth.getUser()
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Invalid token' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  }

  try {
    const { provider, model, trackerPages, today, dayOfWeek } = await req.json()

    const providerConfig = PROVIDERS[provider]
    if (!providerConfig) {
      return new Response(JSON.stringify({ error: `Unknown provider: ${provider}` }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      })
    }

    const apiKeyEnvMap: Record<string, string> = {
      anthropic: 'ANTHROPIC_API_KEY',
      openai: 'OPENAI_API_KEY',
      google: 'GOOGLE_API_KEY',
    }
    const apiKey = Deno.env.get(apiKeyEnvMap[provider])
    if (!apiKey) {
      return new Response(JSON.stringify({ error: `No API key configured for ${provider}` }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      })
    }

    const systemPrompt = `You are a daily planner assistant. The user will give you their notes/tracker pages as structured text with paragraph block IDs. Today is ${today} (${dayOfWeek}).

Your job: generate a prioritized daily task list based on what needs to be done today.

Rules:
- Look for tasks with dates due today or overdue
- Dates may be embedded in text (examples: "by 3/7", "by end of day 3/7", "EOD 3/7", "on 3/7", "due 3/7") and may be wrapped in brackets
- Assume numeric dates are MM/DD in the current year when no year is provided
- If a task’s date is BEFORE today, include it and append " (overdue)" to the task text
- Include recurring tasks that apply to today
- Flag upcoming deadlines within the next 1-2 days
- If a task has no explicit date but seems important to do today, include it in ASAP
- SKIP anything with strikethrough (marked with ~~text~~) - those are completed
- For each task, include the block_id of the source paragraph so we can link back to it
- If a task relates to multiple source paragraphs, include all relevant block_ids

Respond with ONLY a JSON object, no other text. Do NOT return a JSON array or wrap in code fences. Use this shape:
{"asap":[{"task":"short task description","block_ids":["uuid1","uuid2"],"priority":"high"|"medium"|"low"}],"fyi":[{"task":"short task description","block_ids":["uuid1","uuid2"],"priority":"high"|"medium"|"low"}]}

Bucket rules:
- ASAP: overdue tasks, tasks due today, and recurring tasks that apply today
- FYI: deadlines within the next 1-2 days

If a bucket is empty, return an empty array for it.

Order each list by priority (high first), then by time sensitivity.`

    const userMessage = trackerPages.map((page: any) =>
      `=== Page: ${page.title} (pageId: ${page.pageId}) ===\n${page.textContent}`
    ).join('\n\n')

    let fetchUrl = providerConfig.url
    if (provider === 'google') {
      fetchUrl = fetchUrl.replace('{model}', model) + `?key=${apiKey}`
    }

    const { headers, body } = providerConfig.buildRequest(model, systemPrompt, userMessage, apiKey)

    const response = await fetch(fetchUrl, { method: 'POST', headers, body })
    const data = await response.json()

    if (!response.ok) {
      return new Response(JSON.stringify({ error: 'LLM API error', details: data }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      })
    }

    const parseTasks = (text: string) => {
      let asap: any[] = []
      let fyi: any[] = []
      let format = 'empty'
      try {
        const trimmed = text.trim()
        let parsed: any = null
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
          parsed = JSON.parse(trimmed)
        } else {
          const objStart = trimmed.indexOf('{')
          const objEnd = trimmed.lastIndexOf('}')
          const arrStart = trimmed.indexOf('[')
          const arrEnd = trimmed.lastIndexOf(']')
          if (objStart !== -1 && objEnd !== -1 && objEnd > objStart) {
            parsed = JSON.parse(trimmed.slice(objStart, objEnd + 1))
          } else if (arrStart !== -1 && arrEnd !== -1 && arrEnd > arrStart) {
            parsed = JSON.parse(trimmed.slice(arrStart, arrEnd + 1))
          }
        }

        if (Array.isArray(parsed)) {
          asap = parsed
          format = 'legacy_array'
        } else if (parsed && typeof parsed === 'object') {
          if (Array.isArray(parsed.asap)) asap = parsed.asap
          if (Array.isArray(parsed.fyi)) fyi = parsed.fyi
          if (Array.isArray(parsed.asap) || Array.isArray(parsed.fyi)) {
            format = 'asap_fyi'
          } else if (Array.isArray(parsed.tasks)) {
            asap = parsed.tasks
            format = 'legacy_tasks'
          }
        }
      } catch {
        asap = []
        fyi = []
        format = 'empty'
      }
      return { asap, fyi, format }
    }

    const rawText = providerConfig.extractResponse(data)
    const parsed = parseTasks(rawText)
    const warning =
      parsed.format === 'asap_fyi'
        ? null
        : 'FYI: AI response did not follow the ASAP/FYI format. Results may be incomplete.'

    return new Response(JSON.stringify({
      asap: parsed.asap,
      fyi: parsed.fyi,
      rawText,
      warning,
    }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  }
})
