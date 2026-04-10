import { test as setup } from '@playwright/test'
import { config } from 'dotenv'
import path from 'path'
import { createNotebook, createPage, createSection, getSupabase, purgeTestUserData, waitForApp } from './test-helpers'

// Load .env.local first (Supabase keys), then .env.test (test credentials) — later values win
config({ path: path.resolve(process.cwd(), '.env.local') })
config({ path: path.resolve(process.cwd(), '.env.test'), override: true })

const authFile = 'playwright/.auth/user.json'
const BASELINE_DOC = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'E2E baseline page' }],
    },
  ],
}
const buildBaselineHash = ({ notebookId, sectionId, pageId }) => `/#nb=${notebookId}&sec=${sectionId}&pg=${pageId}`

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
  await purgeTestUserData(client, userId)

  const notebook = await createNotebook(client, userId, 'E2E Baseline Notebook', -9999)
  const section = await createSection(client, userId, notebook.id, 'E2E Baseline Section', 0)
  const tracker = await createPage(client, userId, section.id, 'E2E Baseline Page', BASELINE_DOC, 0)
  const baselineSelection = {
    notebookId: notebook.id,
    sectionId: section.id,
    pageId: tracker.id,
  }

  await page.goto('/')

  // Some local runs can start with an already-authenticated shell, while others
  // need the login form to finish mounting before we can submit credentials.
  await page.waitForSelector('input[type="email"], .app:not(.app-auth)', { timeout: 15000 })

  const emailInput = page.locator('input[type="email"]')
  const appShell = page.locator('.app:not(.app-auth)')
  const hasAppShell = await appShell.isVisible().catch(() => false)
  if (!hasAppShell) {
    await emailInput.fill(email)
    await page.fill('input[type="password"]', password)
    await page.click('button[type="submit"]')
  }

  // Wait until the authenticated app shell is visible (not the login screen)
  await page.waitForSelector('.app:not(.app-auth)', { timeout: 15000 })

  // Build storage state from a fresh, deterministic baseline after janitor cleanup.
  await waitForApp(page, buildBaselineHash(baselineSelection))

  await page.context().storageState({ path: authFile })
})
