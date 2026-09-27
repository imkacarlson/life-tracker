// Shared bits for the single-shot Anthropic calls (generate-daily,
// ai-paste-recipe). The model is chosen client-side, so both helpers have to
// cope with whatever model string arrives.

// Sonnet 5 thinks by default (4.6 didn't), and max_tokens caps thinking and
// the answer together. At 4096 a long think used the whole budget and cut the
// JSON off mid-answer, so leave plenty of room.
const MAX_TOKENS = 16000

// These calls ran with thinking off on Sonnet 4.6. Anthropic's migration guide
// says to keep adaptive thinking on and use `low` effort rather than disabling
// it. Only send effort to models that accept it — Haiku 4.5 and older models
// reject the field.
const EFFORT_MODELS = /^claude-(sonnet-(4-6|5)|opus-(4-[5-9]|5)|fable-|mythos-)/

export function anthropicOutputConfig(model: string): {
  max_tokens: number
  output_config?: { effort: 'low' }
} {
  return {
    max_tokens: MAX_TOKENS,
    ...(EFFORT_MODELS.test(model) ? { output_config: { effort: 'low' as const } } : {}),
  }
}

// Newer models run adaptive thinking by default, so content[0] can be a
// `thinking` block. Join the text blocks instead of trusting position.
export function extractAnthropicText(data: { content?: Array<{ type?: string; text?: string }> }): string {
  return (data.content ?? [])
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('')
}
