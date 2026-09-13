import { test, expect } from './fixtures'
import {
  getSupabase,
  createNotebook,
  createSection,
  createPage,
  deleteNotebookById,
  waitForApp,
  tallTableContent,
} from './test-helpers'

// Regression guard for the toolbar dock flicker.
//
// `.toolbar-dock` toggles `is-docked` from a scroll listener that reads the
// dock's own position. When that class also changed the toolbar's content
// width, the toolbar re-wrapped between one and two rows, the dock's height
// changed, scroll anchoring shifted the panel's scrollTop, and the listener
// re-fired — a closed loop that flipped the toolbar every animation frame.
//
// The invariant this spec protects: docking changes paint only, so the
// toolbar's height is identical either side of the dock threshold.
//
// A table seed is the worst case on purpose — the cell-shading control only
// renders while the caret is inside a table, and those two extra buttons are
// what pushed the toolbar over the wrap threshold in the original bug.

const SEED_CONTENT = tallTableContent()

test.describe('Toolbar dock stability', () => {
  let notebookId = null
  let testPage = null

  test.beforeAll(async () => {
    const { client, userId } = await getSupabase()
    const notebook = await createNotebook(client, userId, `Dock Notebook ${Date.now()}`)
    notebookId = notebook.id
    const section = await createSection(client, userId, notebook.id, 'Dock Section')
    testPage = await createPage(client, userId, section.id, 'Dock Page', SEED_CONTENT)
  })

  test.afterAll(async () => {
    const { client } = await getSupabase()
    await deleteNotebookById(client, notebookId)
  })

  test('toolbar keeps one row and a constant height across the dock threshold @desktop', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1700, height: 900 })
    await waitForApp(page, `/#pg=${testPage.id}`, { expectedText: 'Monthly tracker table' })

    // Put the caret in a table cell so the cell-shading pair renders — the
    // widest the toolbar ever gets.
    await page.locator('.ProseMirror td').first().click()
    await expect(page.getByRole('button', { name: 'Cell shading' })).toBeVisible()

    const readGeometry = () =>
      page.evaluate(() => {
        const round = (n) => Math.round(n * 100) / 100
        const rect = (sel) => document.querySelector(sel).getBoundingClientRect()
        return {
          toolbarHeight: round(rect('.toolbar').height),
          dockHeight: round(rect('.toolbar-dock').height),
          dockTop: round(rect('.toolbar-dock').top),
          panelTop: round(rect('.editor-panel').top),
          coreTop: round(rect('.toolbar-core').top),
          extraTop: round(rect('.toolbar-extra').top),
        }
      })

    // At rest: the full control set fits on a single row, so the two halves of
    // the toolbar share a baseline.
    const atRest = await readGeometry()
    expect(atRest.coreTop).toBe(atRest.extraTop)

    // Scroll well past the point where the sticky dock pins to the scrollport.
    await page.evaluate(() => {
      document.querySelector('.editor-panel').scrollTop = 600
    })
    await page.waitForTimeout(200)

    const docked = await readGeometry()

    // Prove the threshold was actually crossed, so the height check below
    // isn't vacuously true. Asserted on geometry rather than the class name.
    expect(docked.dockTop).toBeLessThanOrEqual(docked.panelTop + 1)

    // The invariant: docking is paint-only.
    expect(docked.toolbarHeight).toBe(atRest.toolbarHeight)
    expect(docked.dockHeight).toBe(atRest.dockHeight)
    expect(docked.coreTop).toBe(docked.extraTop)

    // And it must be stable frame to frame, not merely equal at two sampled
    // instants. Pre-fix this saw two alternating heights every frame.
    const observedHeights = await page.evaluate(async () => {
      const dock = document.querySelector('.toolbar-dock')
      const seen = new Set()
      for (let i = 0; i < 30; i += 1) {
        await new Promise((resolve) => requestAnimationFrame(resolve))
        seen.add(Math.round(dock.getBoundingClientRect().height))
      }
      return [...seen]
    })
    expect(observedHeights).toHaveLength(1)
  })
})
