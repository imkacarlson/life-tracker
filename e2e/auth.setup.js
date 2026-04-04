import { test as setup } from '@playwright/test'
import { config } from 'dotenv'
import path from 'path'
import { createNotebook, createPage, createSection, getSupabase, waitForApp } from './test-helpers'

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

const sortNullsFirstAsc = (left, right) => {
  if (left == null && right == null) return 0
  if (left == null) return -1
  if (right == null) return 1
  return left - right
}

const sortIsoAsc = (left, right) => {
  const leftTime = left ? Date.parse(left) : 0
  const rightTime = right ? Date.parse(right) : 0
  return leftTime - rightTime
}

const sortIsoDesc = (left, right) => {
  const leftTime = left ? Date.parse(left) : 0
  const rightTime = right ? Date.parse(right) : 0
  return rightTime - leftTime
}

const buildBaselineHash = ({ notebookId, sectionId, pageId }) => `/#nb=${notebookId}&sec=${sectionId}&pg=${pageId}`

const findPageBackedSelection = async () => {
  const { client, userId } = await getSupabase()
  const [notebooksResult, sectionsResult, pagesResult] = await Promise.all([
    client
      .from('notebooks')
      .select('id,title,sort_order,created_at')
      .eq('user_id', userId),
    client
      .from('sections')
      .select('id,notebook_id,title,sort_order,created_at')
      .eq('user_id', userId),
    client
      .from('pages')
      .select('id,section_id,sort_order,updated_at,created_at')
      .eq('user_id', userId),
  ])

  if (notebooksResult.error) throw notebooksResult.error
  if (sectionsResult.error) throw sectionsResult.error
  if (pagesResult.error) throw pagesResult.error

  const notebooks = [...(notebooksResult.data ?? [])].sort(
    (left, right) =>
      sortNullsFirstAsc(left.sort_order, right.sort_order) || sortIsoAsc(left.created_at, right.created_at),
  )
  const sections = [...(sectionsResult.data ?? [])].sort(
    (left, right) =>
      sortNullsFirstAsc(left.sort_order, right.sort_order) || sortIsoAsc(left.created_at, right.created_at),
  )
  const pages = [...(pagesResult.data ?? [])].sort(
    (left, right) =>
      sortNullsFirstAsc(left.sort_order, right.sort_order) ||
      sortIsoDesc(left.updated_at, right.updated_at) ||
      sortIsoAsc(left.created_at, right.created_at),
  )

  const sectionsByNotebookId = new Map()
  for (const section of sections) {
    const bucket = sectionsByNotebookId.get(section.notebook_id) ?? []
    bucket.push(section)
    sectionsByNotebookId.set(section.notebook_id, bucket)
  }

  const pagesBySectionId = new Map()
  for (const page of pages) {
    const bucket = pagesBySectionId.get(page.section_id) ?? []
    bucket.push(page)
    pagesBySectionId.set(page.section_id, bucket)
  }

  const pickSelection = (candidateNotebooks) => {
    for (const notebook of candidateNotebooks) {
      for (const section of sectionsByNotebookId.get(notebook.id) ?? []) {
        const page = pagesBySectionId.get(section.id)?.[0]
        if (page) {
          return {
            notebookId: notebook.id,
            sectionId: section.id,
            pageId: page.id,
          }
        }
      }
    }
    return null
  }

  const preferredNotebooks = notebooks.filter((notebook) => notebook.title === 'Test Notebook')
  const fallbackNotebooks = notebooks.filter((notebook) => notebook.title !== 'Test Notebook')
  const existingSelection = pickSelection([...preferredNotebooks, ...fallbackNotebooks])
  if (existingSelection) return existingSelection

  const notebook = await createNotebook(client, userId, 'E2E Baseline Notebook', -9999)
  const section = await createSection(client, userId, notebook.id, 'E2E Baseline Section', 0)
  const page = await createPage(client, userId, section.id, 'E2E Baseline Page', BASELINE_DOC, 0)

  return {
    notebookId: notebook.id,
    sectionId: section.id,
    pageId: page.id,
  }
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

  // Drive setup from a real page-backed selection so storageState never snapshots
  // a notebook/section pair with pageId=null when the sidebar is still settling.
  const baselineSelection = await findPageBackedSelection()
  await waitForApp(page, buildBaselineHash(baselineSelection))

  await page.context().storageState({ path: authFile })
})
