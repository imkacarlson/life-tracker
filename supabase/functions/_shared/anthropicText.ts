// Shared bits for the single-shot Anthropic calls (ai-insert, generate-daily,
// ai-paste-recipe). The model is chosen client-side, so both helpers have to
// cope with whatever model string arrives.

// Sonnet 5 defaults to `high` effort (slower, pricier). Pin medium, which
// Anthropic rates as comparable to Sonnet 4.6 @ high. Only send it to models
// that accept `effort` — Haiku 4.5 and older models reject the field.
const EFFORT_MODELS = /^claude-(sonnet-(4-6|5)|opus-(4-[5-9]|5)|fable-|mythos-)/

export function anthropicEffortConfig(model: string): { output_config?: { effort: 'medium' } } {
  return EFFORT_MODELS.test(model) ? { output_config: { effort: 'medium' } } : {}
}

// Newer models run adaptive thinking by default, so content[0] can be a
// `thinking` block. Join the text blocks instead of trusting position.
export function extractAnthropicText(data: { content?: Array<{ type?: string; text?: string }> }): string {
  return (data.content ?? [])
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('')
}
