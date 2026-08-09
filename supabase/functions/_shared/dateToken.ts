// The {{date:…}} sentinel the model wraps a key date phrase in, and the one
// splitter that reads it. Shared so the preview, the stored doc, and the bot's
// "I'll text you…" confirmation agree by construction.
//
// HOUSE RULE: zero jsr:/npm:/https:// imports, zero top-level `Deno.*`.

/** The user highlights key dates in this cyan; the app treats it as a due date. */
export const DATE_HIGHLIGHT_COLOR = '#67e8f9'

const DATE_TOKEN_RE = /\{\{date:([^}]*)\}\}/g

export type DateTokenRun = { text: string; isDate: boolean }

/**
 * Split an item string into runs, marking each {{date:…}} token's inner phrase.
 * Empty runs are dropped — ProseMirror rejects a text node with text:''.
 */
export function splitDateTokens(text: string): DateTokenRun[] {
  const runs: DateTokenRun[] = []
  const source = String(text ?? '')
  let lastIndex = 0

  const pushPlain = (segment: string) => {
    if (segment) runs.push({ text: segment, isDate: false })
  }

  for (const match of source.matchAll(DATE_TOKEN_RE)) {
    const start = match.index ?? 0
    pushPlain(source.slice(lastIndex, start))
    const phrase = (match[1] ?? '').trim()
    if (phrase) runs.push({ text: phrase, isDate: true })
    lastIndex = start + match[0].length
  }
  pushPlain(source.slice(lastIndex))

  return runs
}
