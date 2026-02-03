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

TODAY: ${today}

Rules:
- ONLY create tasks from items listed under NEXT_STEPS for each page
- DO NOT create tasks from Background or Recurring sections; those are context only
- SKIP anything with strikethrough (marked with ~~text~~) - those are completed
- Dates may be embedded in text (examples: "by 3/7", "by end of day 3/7", "EOD 3/7", "on 3/7", "due 3/7") and may be wrapped in brackets
- Assume numeric dates are MM/DD in the current year when no year is provided
- Tomorrow is TODAY + 1 day. The day after tomorrow is TODAY + 2 days.
- If a task has an explicit due date:
  - If the due date is BEFORE today, include it and append " (overdue)" to the task text
  - If the due date is TODAY, include it in ASAP
  - If the due date is TOMORROW or the day after tomorrow, include it in FYI
  - If the due date is MORE THAN 2 days away, OMIT it entirely (do not include in ASAP or FYI)
- NEVER place any task with a future due date in ASAP (even if it seems important)
- If a task has NO explicit date, include it in ASAP only if it is explicitly urgent in the text
- It is OK for ASAP or FYI to be short or empty. Do NOT invent tasks or add filler
- For each task, include the block_id of the source paragraph so we can link back to it
- If a task relates to multiple source paragraphs, include all relevant block_ids

Respond with ONLY a JSON object, no other text. Do NOT return a JSON array or wrap in code fences. Use this shape:
{"asap":[{"task":"short task description","block_ids":["uuid1","uuid2"],"priority":"high"|"medium"|"low"}],"fyi":[{"task":"short task description","block_ids":["uuid1","uuid2"],"priority":"high"|"medium"|"low"}]}

Bucket rules:
- ASAP: overdue tasks, tasks due today, and undated urgent tasks
- FYI: tasks due in 1-2 days (tomorrow or day after tomorrow)
- Omit anything due more than 2 days out

If a bucket is empty, return an empty array for it.

Ordering:
- ASAP: overdue first (most recently overdue at top), then due today, then undated urgent
- FYI: soonest due date first
- Within the same due date, high priority first.`

    const extractNextStepsFromText = (text: string) => {
      const lines = String(text || '').split('\n')
      const nextSteps: { text: string, blockId: string }[] = []
      const contextLines: string[] = []
      let inNextSteps = false

      const isNextStepsHeader = (value: string) => /^next steps:?\s*/i.test(value)
      const isListLine = (value: string) =>
        value.startsWith('- ') ||
        /^\d+\.\s+/.test(value) ||
        /^\[(?: |x|X)\]\s+/.test(value)

      const cleanListText = (value: string) =>
        value
          .replace(/^\-\s+/, '')
          .replace(/^\d+\.\s+/, '')
          .replace(/^\[(?: |x|X)\]\s+/, '')
          .trim()

      for (const line of lines) {
        const trimmed = line.trim()
        if (isNextStepsHeader(trimmed)) {
          inNextSteps = true
          continue
        }
        if (inNextSteps) {
          if (!trimmed) continue
          if (isListLine(trimmed)) {
            const idMatch = line.match(/{{id:([^}]+)}}/)
            const blockId = idMatch?.[1]
            const cleaned = cleanListText(trimmed).replace(/\s*{{id:[^}]+}}/g, '').trim()
            if (blockId && cleaned) {
              nextSteps.push({ text: cleaned, blockId })
            }
            continue
          }
          inNextSteps = false
        }
        contextLines.push(line)
      }

      return {
        nextSteps,
        context: contextLines.join('\n').trim(),
      }
    }

    const preparedPages = (trackerPages || []).map((page: any) => {
      const { nextSteps, context } = extractNextStepsFromText(page.textContent || '')
      return {
        ...page,
        nextSteps,
        context,
      }
    })

    const allowedBlockIds = new Set<string>()
    preparedPages.forEach((page: any) => {
      page.nextSteps?.forEach((item: { blockId: string }) => allowedBlockIds.add(item.blockId))
    })

    const userMessage = preparedPages.map((page: any) => {
      const nextStepsText = page.nextSteps?.length
        ? page.nextSteps.map((item: any) => `- ${item.text} (block_id: ${item.blockId})`).join('\n')
        : '(none)'
      const contextText = page.context?.trim() ? page.context : '(none)'
      return [
        `=== Page: ${page.title} (pageId: ${page.pageId}) ===`,
        'NEXT_STEPS (only these can become tasks):',
        nextStepsText,
        '',
        'CONTEXT (background/recurring/notes; do not create tasks from this):',
        contextText,
      ].join('\n')
    }).join('\n\n')

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

    const filterToNextSteps = (tasks: any[]) =>
      (tasks || [])
        .map((task) => {
          const blockIds = Array.isArray(task.block_ids)
            ? task.block_ids.filter((id: string) => allowedBlockIds.has(id))
            : []
          if (!blockIds.length) return null
          return { ...task, block_ids: blockIds }
        })
        .filter(Boolean)

    const asap = filterToNextSteps(parsed.asap)
    const fyi = filterToNextSteps(parsed.fyi)
    const removedCount = (parsed.asap?.length || 0) + (parsed.fyi?.length || 0) - (asap.length + fyi.length)

    let warning =
      parsed.format === 'asap_fyi'
        ? null
        : 'FYI: AI response did not follow the ASAP/FYI format. Results may be incomplete.'
    if (removedCount > 0) {
      const note = 'FYI: Some tasks were removed because they were not under Next steps.'
      warning = warning ? `${warning} ${note}` : note
    }

    return new Response(JSON.stringify({
      asap,
      fyi,
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
