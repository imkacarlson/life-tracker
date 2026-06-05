// Client for the Vercel screenshot render function (api/render-preview.js).
// The bot calls it server-to-server with a shared secret and gets back PNG bytes.
//
// Phase B sends a *proposed* doc (not yet saved to `pages`) plus the ids of the
// inserted blocks to highlight + crop around.

const RENDER_ENDPOINT_URL = Deno.env.get('RENDER_ENDPOINT_URL') ?? ''
const RENDER_SHARED_SECRET = Deno.env.get('RENDER_SHARED_SECRET') ?? ''

/**
 * Render a proposed tracker doc to a PNG, highlighting + cropping to blockIds.
 * @param content   The full proposed Tiptap doc JSON (with the insertion applied).
 * @param blockIds  Top-level block ids of the inserted content to highlight.
 */
export async function renderProposedPreview(
  content: unknown,
  blockIds: string[],
): Promise<Uint8Array> {
  if (!RENDER_ENDPOINT_URL) throw new Error('RENDER_ENDPOINT_URL not configured')
  const resp = await fetch(RENDER_ENDPOINT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-render-secret': RENDER_SHARED_SECRET,
    },
    // pageId is still required by the function as a presence check fallback; with
    // `content` present it is ignored for the actual render.
    body: JSON.stringify({ content, blockIds }),
  })
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '')
    throw new Error(`render failed (${resp.status}) ${detail}`.trim())
  }
  return new Uint8Array(await resp.arrayBuffer())
}
