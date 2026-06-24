// Create a WordPress draft via the REST API, using Basic auth with a WordPress
// Application Password. Draft-only by design (no publish).

const DEFAULT_ENDPOINT = 'https://www.grcrunning.com/wp-json/wp/v2/posts'

export type DraftResult = { id: number; editLink: string }

/** Create a draft post. Throws on non-2xx with the response body. */
export async function createDraft(contentHtml: string, title: string): Promise<DraftResult> {
  const user = Deno.env.get('WP_USER')
  const appPassword = Deno.env.get('WP_APP_PASSWORD')
  const endpoint = Deno.env.get('WP_POSTS_ENDPOINT') ?? DEFAULT_ENDPOINT
  if (!user || !appPassword) {
    throw new Error('WP_USER and WP_APP_PASSWORD must be configured')
  }

  const auth = btoa(`${user}:${appPassword}`)
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify({ title, content: contentHtml, status: 'draft' }),
  })

  if (resp.status !== 200 && resp.status !== 201) {
    const detail = (await resp.text().catch(() => '')).slice(0, 500)
    throw new Error(`WordPress API error ${resp.status}: ${detail}`)
  }

  const data = await resp.json()
  const id = data?.id
  if (typeof id !== 'number') {
    throw new Error('WordPress response missing post id')
  }
  // Derive the wp-admin edit link from the post id (host taken from the endpoint).
  const origin = new URL(endpoint).origin
  return { id, editLink: `${origin}/wp-admin/post.php?post=${id}&action=edit` }
}
