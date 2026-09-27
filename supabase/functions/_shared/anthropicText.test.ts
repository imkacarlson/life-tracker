import { describe, expect, it } from 'vitest'
import { anthropicOutputConfig, extractAnthropicText } from './anthropicText.ts'

describe('anthropicOutputConfig', () => {
  it('sets max_tokens and low effort on Sonnet 5 and other effort-capable models', () => {
    for (const model of ['claude-sonnet-5', 'claude-sonnet-4-6', 'claude-opus-5', 'claude-opus-5-5']) {
      expect(anthropicOutputConfig(model)).toEqual({ max_tokens: 16000, output_config: { effort: 'low' } })
    }
  })

  it('sets max_tokens but omits effort for models that reject it', () => {
    for (const model of ['claude-haiku-4-5', 'claude-haiku-4-5-20251001', 'claude-sonnet-4-5']) {
      expect(anthropicOutputConfig(model)).toEqual({ max_tokens: 16000 })
    }
  })
})

describe('extractAnthropicText', () => {
  it('skips a leading thinking block', () => {
    const data = {
      content: [
        { type: 'thinking', thinking: '' },
        { type: 'text', text: '{"items":[]}' },
      ],
    }
    expect(extractAnthropicText(data)).toBe('{"items":[]}')
  })

  it('joins multiple text blocks and tolerates missing content', () => {
    expect(extractAnthropicText({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] })).toBe('ab')
    expect(extractAnthropicText({})).toBe('')
  })
})
