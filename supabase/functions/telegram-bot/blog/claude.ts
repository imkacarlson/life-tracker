// Single non-tool Claude text call with transient-error retry, plus the
// newline-safe tag extractor. Kept separate from the tracker's tool-using
// `callClaude` (anthropic.ts) so that flow stays untouched.
//
// Retry on 429/5xx/529 is the specific fix for the .flo's silent failure: an
// Anthropic capacity blip used to slip through and post a blank body. Here an
// exhausted retry throws with the status + body so it surfaces in Telegram.

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
const MODEL = 'claude-sonnet-4-6'
const MAX_TOKENS = 8000

// Rate limit + transient server/overload errors are worth retrying.
const RETRYABLE = new Set([429, 500, 502, 503, 529])
const MAX_RETRIES = 3

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Send the prompt to the Messages API and return the concatenated text body. */
export async function formatRecap(prompt: string): Promise<string> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')

  const body = JSON.stringify({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
  })

  let lastDetail = ''
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const resp = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body,
    })

    if (resp.ok) {
      const data = await resp.json()
      const blocks = Array.isArray(data.content) ? data.content : []
      const text = blocks
        .filter((b: { type?: string }) => b.type === 'text')
        .map((b: { text?: string }) => b.text ?? '')
        .join('')
      if (!text.trim()) {
        throw new Error('Anthropic returned an empty text body.')
      }
      return text
    }

    lastDetail = `${resp.status}: ${(await resp.text().catch(() => '')).slice(0, 500)}`
    if (RETRYABLE.has(resp.status) && attempt < MAX_RETRIES) {
      await sleep(Math.min(2 ** attempt, 8) * 1000)
      continue
    }
    throw new Error(`Anthropic API error ${lastDetail}`)
  }

  throw new Error(`Anthropic API error after ${MAX_RETRIES} attempts ${lastDetail}`)
}

/**
 * Return the inner content of <tag>...</tag>, or null if not present. Uses
 * [\s\S] (newline-safe) rather than the inline (?s) modifier that silently
 * failed in the original .flo regex.
 */
export function extractTag(tag: string, text: string): string | null {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(text)
  return match ? match[1].trim() : null
}
