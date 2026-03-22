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
  ) => { headers: Record<string, string>; body: string }
  extractResponse: (data: any) => string
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
    extractResponse: (data) =>
      data.candidates?.[0]?.content?.parts?.[0]?.text ?? '',
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

  const {
    data: { user },
    error: authError,
  } = await supabaseClient.auth.getUser()

  if (authError || !user) {
    return jsonResponse({ error: 'Invalid token' }, 401)
  }

  try {
    const { provider, model, text } = await req.json()

    if (!provider || !model || !text) {
      return jsonResponse({ error: 'Missing required fields (provider, model, text).' }, 400)
    }

    const MAX_TEXT_LENGTH = 50_000
    if (String(text).length > MAX_TEXT_LENGTH) {
      return jsonResponse({ error: `Text too long (max ${MAX_TEXT_LENGTH} characters).` }, 400)
    }

    const providerConfig = PROVIDERS[provider]
    if (!providerConfig) {
      return jsonResponse({ error: `Unknown provider: ${provider}` }, 400)
    }

    if (!/^[a-zA-Z0-9._-]+$/.test(String(model))) {
      return jsonResponse({ error: 'Invalid model name.' }, 400)
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

    const systemPrompt = `You are a recipe formatter. The user will paste raw recipe text (from a website, message, or handwritten notes). Your job is to extract the recipe and return clean, consistently formatted markdown.

Return ONLY the markdown, no extra commentary or wrapping.

Use this exact structure:

# Recipe Title

## Ingredients

- quantity ingredient
- quantity ingredient
...

## Instructions

1. First step
2. Second step
...

## Notes

- Prep time: X min
- Cook time: X min
- Servings: X
- Source: URL or description (if available)
- Any other relevant notes from the original text

Rules:
- Extract the recipe title from the text. If no clear title, infer one from the ingredients/method.
- List all ingredients as a bullet list with quantities. Normalize units where sensible (e.g., "1 lb" not "1lb").
- Number all instruction steps. Keep steps concise but complete.
- If the input is clearly NOT a recipe (random text, code, etc.), still format it as a page: use the first line or a summary as the title, put the content in paragraphs under the title. Do NOT return an error.
- Preserve important details: temperatures, times, special techniques.
- If the text includes multiple recipes, format only the first one.`

    const userMessage = `Format this recipe:\n\n${String(text)}`

    let fetchUrl = providerConfig.url
    if (provider === 'google') {
      fetchUrl = fetchUrl.replace('{model}', String(model)) + `?key=${apiKey}`
    }

    const { headers, body } = providerConfig.buildRequest(
      String(model),
      systemPrompt,
      userMessage,
      apiKey,
    )
    const response = await fetch(fetchUrl, { method: 'POST', headers, body })
    const responseData = await response.json()

    if (!response.ok) {
      return jsonResponse({ error: 'LLM API error', details: responseData }, 502)
    }

    const markdown = providerConfig.extractResponse(responseData)

    if (!markdown.trim()) {
      return jsonResponse({ error: 'LLM returned empty response' }, 502)
    }

    // Extract title from the first markdown heading
    const titleMatch = markdown.match(/^#\s+(.+)$/m)
    const title = titleMatch ? titleMatch[1].trim() : 'Untitled Recipe'

    return jsonResponse({ markdown, title })
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500)
  }
})
