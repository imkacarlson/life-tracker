/**
 * Regression test for the "Create your first notebook" flash on launch.
 *
 * Root cause: the boot splash (and the null render gate) were torn down as soon
 * as auth resolved, but notebooks had not been fetched yet. For a returning user
 * that left a brief window — auth done, session present, notebooks still [] —
 * where the render gate hit `notebooks.length === 0` and rendered WelcomeScreen
 * before the real editor shell. Fixed by gating boot on a notebooks first-load
 * flag (`notebooksLoading`) so launch goes splash -> editor with no flash.
 *
 * The flash is sub-second, so a retrying assertion can miss it. Instead we
 * install a MutationObserver before the app boots and record whether the
 * WelcomeScreen heading ever entered the DOM at all.
 */
import { test, expect } from './fixtures'
import { createNotebook, createPage, createSection, getSupabase } from './test-helpers'

const WELCOME_HEADING = /Create your first notebook/i

test.describe('launch never flashes the welcome screen for a user with notebooks', () => {
  let notebook, section

  test.beforeAll(async () => {
    const { client, userId } = await getSupabase()
    notebook = await createNotebook(client, userId, `Welcome Flash Notebook ${Date.now()}`, -99999)
    section = await createSection(client, userId, notebook.id, 'Welcome Flash Section', 0)
    await createPage(
      client,
      userId,
      section.id,
      'Welcome Flash Page',
      {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'WelcomeFlashMarker' }] }],
      },
      0,
    )
  })

  test('WelcomeScreen heading never appears during a cold launch', async ({ page }) => {
    // Install the observer before any app code runs so we catch even a 1-frame
    // render of the empty-account WelcomeScreen.
    await page.addInitScript(() => {
      window.__welcomeFlashSeen = false
      const scan = () => {
        const headings = document.querySelectorAll('h2')
        for (const heading of headings) {
          if (/Create your first notebook/i.test(heading.textContent || '')) {
            window.__welcomeFlashSeen = true
            return
          }
        }
      }
      const startObserving = () => {
        scan()
        new MutationObserver(scan).observe(document.documentElement, {
          childList: true,
          subtree: true,
        })
      }
      if (document.documentElement) {
        startObserving()
      } else {
        document.addEventListener('DOMContentLoaded', startObserving)
      }
    })

    await page.goto('/')

    // The real editor shell renders `.workspace`; WelcomeScreen renders `.welcome`
    // instead. Waiting on `.workspace` confirms we reached the logged-in shell.
    await expect(page.locator('.workspace')).toBeVisible({ timeout: 15000 })

    const flashSeen = await page.evaluate(() => window.__welcomeFlashSeen)
    expect(flashSeen).toBe(false)

    // And the welcome heading is not present now either.
    await expect(page.getByText(WELCOME_HEADING)).toHaveCount(0)
  })
})
