import { test as setup } from '@playwright/test'
import { config } from 'dotenv'
import path from 'path'
import {
  createNotebook,
  createPage,
  createSection,
  getSupabase,
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

const waitForSectionVisibility = async (client, sectionId, timeoutMs = 5000) => {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const { data, error } = await client
      .from('sections')
      .select('id')
      .eq('id', sectionId)
      .maybeSingle()

    if (error) throw error
    if (data?.id === sectionId) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  throw new Error(`Timed out waiting for section ${sectionId} to become readable`)
}

setup('authenticate test user', async ({ page }) => {
  setup.setTimeout(90000)

  const email = process.env.TEST_USER_EMAIL
  const password = process.env.TEST_USER_PASSWORD

  if (!email || !password) {
    throw new Error(
      'TEST_USER_EMAIL and TEST_USER_PASSWORD must be set in .env.test\n' +
        'Create a test user in the Supabase dashboard and add credentials to .env.test',
    )
  }

  const { client, userId } = await getSupabase()

  const notebook = await createNotebook(client, userId, 'E2E Baseline Notebook', -9999)
  const section = await createSection(client, userId, notebook.id, 'E2E Baseline Section', 0)
  await waitForSectionVisibility(client, section.id)
  const tracker = await createPage(client, userId, section.id, 'E2E Baseline Page', BASELINE_DOC, 0)
  const baselineSelection = {
    notebookId: notebook.id,
    sectionId: section.id,
    pageId: tracker.id,
  }
  const baselineHash = `#nb=${notebook.id}&sec=${section.id}&pg=${tracker.id}`

  await page.goto('/')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()

  const logoutButton = page.getByRole('button', { name: 'Log out' })
  const accountMenuButton = page.getByRole('button', { name: 'Open account and settings menu' })
  const signInTimeout = 15000

  await Promise.any([
    logoutButton.waitFor({ state: 'visible', timeout: signInTimeout }),
    accountMenuButton.waitFor({ state: 'visible', timeout: signInTimeout }),
  ])

  await page.evaluate(({ selectionKey, selectionValue }) => {
    window.localStorage.setItem(selectionKey, JSON.stringify(selectionValue))
  }, {
    selectionKey: STORAGE_KEY,
    selectionValue: baselineSelection,
  })

  await waitForApp(page, baselineHash, { expectedText: 'E2E baseline page' })
  await page.locator('.title-input').waitFor({ state: 'visible', timeout: 15000 })

  await page.context().storageState({ path: authFile })
})
