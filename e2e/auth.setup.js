import { test as setup } from '@playwright/test'
import { config } from 'dotenv'
import path from 'path'
import {
  createNotebook,
  createPage,
  createSection,
  getSupabase,
  purgeTestUserData,
  waitForApp,
} from './test-helpers'

// Load .env.local first (Supabase keys), then .env.test (test credentials) — later values win
config({ path: path.resolve(process.cwd(), '.env.local') })
config({ path: path.resolve(process.cwd(), '.env.test'), override: true })

const authFile = 'playwright/.auth/user.json'
const STORAGE_KEY = 'life-tracker:lastSelection'
const BASELINE_DOC = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'E2E baseline page' }],
    },
  ],
}
setup('authenticate test user', async ({ page }) => {
  const email = process.env.TEST_USER_EMAIL
  const password = process.env.TEST_USER_PASSWORD

  if (!email || !password) {
    throw new Error(
      'TEST_USER_EMAIL and TEST_USER_PASSWORD must be set in .env.test\n' +
        'Create a test user in the Supabase dashboard and add credentials to .env.test',
    )
  }

  const { client, userId } = await getSupabase()
  const { data: sessionData, error: sessionError } = await client.auth.getSession()
  if (sessionError) throw sessionError
  const session = sessionData?.session
  if (!session) {
    throw new Error('Unable to resolve Supabase auth session for Playwright setup')
  }

  await purgeTestUserData(client, userId)

  const notebook = await createNotebook(client, userId, 'E2E Baseline Notebook', -9999)
  const section = await createSection(client, userId, notebook.id, 'E2E Baseline Section', 0)
  const tracker = await createPage(client, userId, section.id, 'E2E Baseline Page', BASELINE_DOC, 0)
  const baselineSelection = {
    notebookId: notebook.id,
    sectionId: section.id,
    pageId: tracker.id,
  }
  const baselineHash = `#nb=${notebook.id}&sec=${section.id}&pg=${tracker.id}`
  const authStorageKey = client.auth.storageKey

  // Avoid the browser login form entirely. Seed the same localStorage keys the
  // Supabase browser client reads on startup, then boot the app directly into a
  // deterministic baseline workspace/page.
  await page.addInitScript(({ authKey, sessionValue, selectionKey, selectionValue }) => {
    window.localStorage.clear()
    window.localStorage.setItem(authKey, JSON.stringify(sessionValue))
    window.localStorage.setItem(selectionKey, JSON.stringify(selectionValue))
  }, {
    authKey: authStorageKey,
    sessionValue: session,
    selectionKey: STORAGE_KEY,
    selectionValue: baselineSelection,
  })

  await waitForApp(page, baselineHash, { expectedText: 'E2E baseline page' })
  await page.locator('.title-input').waitFor({ state: 'visible', timeout: 15000 })

  await page.context().storageState({ path: authFile })
})
