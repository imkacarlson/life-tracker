// Client for the Vercel screenshot render function (api/render-preview.js).
// The bot calls it server-to-server with a shared secret and gets back PNG bytes.

const RENDER_ENDPOINT_URL = Deno.env.get('RENDER_ENDPOINT_URL') ?? ''
const RENDER_SHARED_SECRET = Deno.env.get('RENDER_SHARED_SECRET') ?? ''

/** Render a tracker page to a PNG, optionally cropped to a highlighted block. */
export async function renderTrackerPreview(pageId: string, blockId?: string): Promise<Uint8Array> {
  if (!RENDER_ENDPOINT_URL) throw new Error('RENDER_ENDPOINT_URL not configured')
  const resp = await fetch(RENDER_ENDPOINT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-render-secret': RENDER_SHARED_SECRET,
    },
    body: JSON.stringify({ pageId, blockId }),
  })
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '')
    throw new Error(`render failed (${resp.status}) ${detail}`.trim())
  }
  return new Uint8Array(await resp.arrayBuffer())
}

const BLOCK_TYPES = ['paragraph', 'heading', 'bulletList', 'orderedList', 'taskList', 'table']

/**
 * Pick a block id ~40% down the document so a crop has context above and below.
 * Used by the temporary /preview command to exercise the crop+highlight path
 * without a real proposed edit (Phase B supplies the actual inserted block).
 */
export function pickContextBlockId(content: unknown): string | undefined {
  const ids: string[] = []
  const walk = (n: any) => {
    if (!n || typeof n !== 'object') return
    if (n.attrs?.id && BLOCK_TYPES.includes(n.type)) ids.push(n.attrs.id)
    if (Array.isArray(n.content)) n.content.forEach(walk)
  }
  walk(content)
  if (!ids.length) return undefined
  return ids[Math.floor(ids.length * 0.4)]
}
