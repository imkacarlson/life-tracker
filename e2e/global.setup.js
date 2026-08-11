import fs from 'fs/promises'
import path from 'path'
import { getSupabase, purgeTestUserData } from './test-helpers'

const authFile = path.resolve(process.cwd(), 'playwright/.auth/user.json')

export default async function globalSetup() {
  if (!process.env.TEST_USER_EMAIL || !process.env.TEST_USER_PASSWORD) {
    console.warn('[setup] TEST_USER_EMAIL / TEST_USER_PASSWORD not set — skipping purge')
    return
  }

  try {
    await fs.rm(authFile, { force: true })
  } catch (err) {
    console.warn('[setup] failed to remove stale auth file (non-fatal):', err?.message ?? err)
  }

  try {
    const { client, userId } = await getSupabase()
    await purgeTestUserData(client, userId)
  } catch (err) {
    console.warn('[setup] purgeTestUserData failed:', err?.message ?? err)
    throw err
  }
}
