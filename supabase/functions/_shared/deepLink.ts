// The one implementation of an app deep link. Lifted out of telegram-bot/
// capture.ts so the bot and the reminder sweep can't drift apart.
//
// HOUSE RULE: zero jsr:/npm:/https:// imports, zero top-level `Deno.*` — `appUrl`
// is a parameter, not a module-scope env read.

export type DeepLinkParts = {
  notebookId?: string | null
  sectionId?: string | null
  pageId?: string | null
  blockId?: string | null
}

/**
 * Build an app URL whose hash the front end can route on.
 *
 * ⚠️ KEY ORDER IS LOAD-BEARING. src/utils/navigationHelpers.js `parseDeepLink`
 * rejects any hash that doesn't START with `#pg=`, `#sec=`, or `#nb=`. Keep the
 * nb -> sec -> pg -> block order below: reordering silently produces links that
 * navigate nowhere, with no error anywhere.
 */
export function buildDeepLink(parts: DeepLinkParts, appUrl?: string | null): string {
  const params = new URLSearchParams()
  if (parts.notebookId) params.set('nb', parts.notebookId)
  if (parts.sectionId) params.set('sec', parts.sectionId)
  if (parts.pageId) params.set('pg', parts.pageId)
  if (parts.blockId) params.set('block', parts.blockId)

  const hash = params.size ? `#${params.toString()}` : ''
  if (!hash) return ''

  const base = String(appUrl ?? '').replace(/\/$/, '')
  return base ? `${base}/${hash}` : hash
}
