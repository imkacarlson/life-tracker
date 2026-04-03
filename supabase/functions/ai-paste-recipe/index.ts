import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'jsr:@supabase/supabase-js@2'

const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') || '*'
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type ImageInput = { base64: string; mediaType: string }

type ProviderConfig = {
  url: string
  buildRequest: (
    model: string,
    systemPrompt: string,
    userMessage: string,
    apiKey: string,
    images: ImageInput[],
  ) => { headers: Record<string, string>; body: string }
  extractResponse: (data: any) => string
}

const PROVIDERS: Record<string, ProviderConfig> = {
  anthropic: {
    url: 'https://api.anthropic.com/v1/messages',
    buildRequest: (model, systemPrompt, userMessage, apiKey, images) => {
      const content: any[] = [
        ...images.map((img) => ({
          type: 'image',
          source: { type: 'base64', media_type: img.mediaType, data: img.base64 },
        })),
        { type: 'text', text: userMessage },
      ]
      return {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 4096,
          system: systemPrompt,
          messages: [{ role: 'user', content: images.length > 0 ? content : userMessage }],
        }),
      }
    },
    extractResponse: (data) => data.content?.[0]?.text ?? '',
  },
  openai: {
    url: 'https://api.openai.com/v1/chat/completions',
    buildRequest: (model, systemPrompt, userMessage, apiKey, images) => {
      const userContent: any[] | string = images.length > 0
        ? [
            ...images.map((img) => ({
              type: 'image_url',
              image_url: { url: `data:${img.mediaType};base64,${img.base64}` },
            })),
            { type: 'text', text: userMessage },
          ]
        : userMessage
      return {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
          ],
        }),
      }
    },
    extractResponse: (data) => data.choices?.[0]?.message?.content ?? '',
  },
  google: {
    url: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
    buildRequest: (model, systemPrompt, userMessage, _apiKey, images) => {
      const parts: any[] = [
        ...images.map((img) => ({
          inline_data: { mime_type: img.mediaType, data: img.base64 },
        })),
        { text: userMessage },
      ]
      return {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [{ parts }],
        }),
      }
    },
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
    const { provider, model, text, images: rawImages } = await req.json()

    if (!provider || !model) {
      return jsonResponse({ error: 'Missing required fields (provider, model).' }, 400)
    }

    if (typeof provider !== 'string' || typeof model !== 'string') {
      return jsonResponse({ error: 'Provider and model must be strings.' }, 400)
    }

    const textStr = typeof text === 'string' ? text : ''
    const images: ImageInput[] = Array.isArray(rawImages) ? rawImages : []

    if (!textStr.trim() && images.length === 0) {
      return jsonResponse({ error: 'Provide text, images, or both.' }, 400)
    }

    const MAX_TEXT_LENGTH = 50_000
    if (textStr.length > MAX_TEXT_LENGTH) {
      return jsonResponse({ error: `Text too long (max ${MAX_TEXT_LENGTH} characters).` }, 400)
    }

    // Validate images
    const ALLOWED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp']
    const MAX_IMAGES = 5
    const MAX_IMAGE_BASE64_SIZE = 500_000

    if (images.length > MAX_IMAGES) {
      return jsonResponse({ error: `Too many images (max ${MAX_IMAGES}).` }, 400)
    }

    const base64Regex = /^[A-Za-z0-9+/=]+$/
    for (const img of images) {
      if (!img.base64 || !img.mediaType) {
        return jsonResponse({ error: 'Each image must have base64 and mediaType.' }, 400)
      }
      if (!ALLOWED_MEDIA_TYPES.includes(img.mediaType)) {
        return jsonResponse({ error: `Unsupported media type: ${img.mediaType}` }, 400)
      }
      if (img.base64.length > MAX_IMAGE_BASE64_SIZE) {
        return jsonResponse({ error: 'Image too large (max 500KB base64).' }, 413)
      }
      if (!base64Regex.test(img.base64)) {
        return jsonResponse({ error: 'Invalid base64 data.' }, 400)
      }
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

    const systemPrompt = `You are a recipe formatter. The user will provide raw recipe text (from a website, message, or handwritten notes) and/or photos of recipes (handwritten, screenshots, photos of cookbooks). Your job is to extract the recipe and return clean, consistently formatted markdown.

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

    let userMessage: string
    if (textStr.trim() && images.length > 0) {
      userMessage = `Format this recipe from the text and images:\n\n${textStr}`
    } else if (images.length > 0) {
      userMessage = 'Format the recipe from these images.'
    } else {
      userMessage = `Format this recipe:\n\n${textStr}`
    }

    let fetchUrl = providerConfig.url
    if (provider === 'google') {
      fetchUrl = fetchUrl.replace('{model}', String(model)) + `?key=${apiKey}`
    }

    const { headers, body } = providerConfig.buildRequest(
      String(model),
      systemPrompt,
      userMessage,
      apiKey,
      images,
    )
    const response = await fetch(fetchUrl, { method: 'POST', headers, body })
    const responseData = await response.json()

    if (!response.ok) {
      console.error('LLM API error:', JSON.stringify(responseData))
      return jsonResponse({ error: 'LLM API error. Check edge function logs for details.' }, 502)
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
    console.error('ai-paste-recipe error:', err)
    return jsonResponse({ error: 'Internal error processing recipe request.' }, 500)
  }
})
