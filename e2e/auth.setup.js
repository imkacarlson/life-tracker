import { test as setup } from '@playwright/test'
import { config } from 'dotenv'
import path from 'path'

// Load .env.local first (Supabase keys), then .env.test (test credentials) — later values win
config({ path: path.resolve(process.cwd(), '.env.local') })
config({ path: path.resolve(process.cwd(), '.env.test'), override: true })

const authFile = 'playwright/.auth/user.json'

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

  // Fill in the login form
  await page.fill('input[type="email"]', email)
  await page.fill('input[type="password"]', password)
  await page.click('button[type="submit"]')

  // Wait until the authenticated app shell is visible (not the login screen)
  await page.waitForSelector('.app:not(.app-auth)', { timeout: 15000 })

  // Normalize E2E baseline context so all tests start in the same notebook/section.
  const notebookSelect = page.locator('.notebook-switcher select')
  if ((await notebookSelect.count()) > 0) {
    try {
      await notebookSelect.selectOption({ label: 'Test Notebook' })
    } catch {
      // Keep setup resilient when seed notebook is absent.
    }
  }

  const sectionTab = page.locator('.section-tab', { hasText: 'Test Section' }).first()
  try {
    await sectionTab.waitFor({ state: 'visible', timeout: 8000 })
    await sectionTab.click()
  } catch {
    // Keep setup resilient when seed section is absent.
  }

  await page.context().storageState({ path: authFile })
})
