import { describe, expect, it } from 'vitest'
import {
  type AuthEvent,
  buildAlertEmail,
  decideAlert,
  describeDevice,
  isAutomatedClient,
} from './authAlert.ts'

// Typical browser user agents, plus Playwright's.
const UA = {
  claudeApp:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Claude/2.7032.0 Chrome/152.0.7977.130 Safari/537.36 MSIX',
  chromeWin:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
  chromeWinOld:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36',
  linuxChrome:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
  headless:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/140.0.0.0 Safari/537.36',
  pixel7:
    'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  edge:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36 Edg/153.0.0.0',
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
}

const session = (over: Partial<Extract<AuthEvent, { type: 'session_created' }>> = {}): AuthEvent => ({
  type: 'session_created',
  user_id: 'owner',
  email: 'owner@example.com',
  session_id: 's1',
  ip: '203.0.113.5',
  network: '203.0.0.0/16',
  user_agent: UA.chromeWin,
  at: '2026-09-24T20:00:00Z',
  ...over,
})

describe('describeDevice', () => {
  it('labels real clients without versions', () => {
    expect(describeDevice(UA.claudeApp)).toBe('Claude app on Windows')
    expect(describeDevice(UA.chromeWin)).toBe('Chrome on Windows')
    expect(describeDevice(UA.androidChrome)).toBe('Chrome on Android')
    expect(describeDevice(UA.linuxChrome)).toBe('Chrome on Linux')
    expect(describeDevice(UA.edge)).toBe('Edge on Windows')
    expect(describeDevice(UA.iphoneSafari)).toBe('Safari on iOS')
    expect(describeDevice(UA.headless)).toBe('Headless Chrome on Linux')
  })

  it('treats a browser update as the same device', () => {
    expect(describeDevice(UA.chromeWinOld)).toBe(describeDevice(UA.chromeWin))
  })

  it('handles missing and scripted clients', () => {
    expect(describeDevice(null)).toBe('Unknown client')
    expect(describeDevice('node')).toBe('Script (no browser)')
  })
})

describe('isAutomatedClient', () => {
  it('matches Playwright and Node clients only', () => {
    expect(isAutomatedClient(UA.headless)).toBe(true)
    expect(isAutomatedClient(UA.pixel7)).toBe(true)
    expect(isAutomatedClient('node')).toBe(true)
    expect(isAutomatedClient(UA.androidChrome)).toBe(false)
    expect(isAutomatedClient(UA.chromeWin)).toBe(false)
  })
})

describe('decideAlert', () => {
  const base = { device: 'Chrome on Windows', isTestAccount: false, ipInfo: null }

  it('stays quiet for a known device on a known network', () => {
    const d = decideAlert({ ...base, event: session(), deviceKnown: true, networkKnown: true })
    expect(d.action).toBe('quiet')
  })

  it('alerts on a new device', () => {
    const d = decideAlert({ ...base, event: session(), deviceKnown: false, networkKnown: true })
    expect(d).toEqual({ action: 'alert', reasons: ['New device: Chrome on Windows'] })
  })

  it('alerts on a new network', () => {
    const d = decideAlert({ ...base, event: session(), deviceKnown: true, networkKnown: false })
    expect(d).toEqual({ action: 'alert', reasons: ['New network'] })
  })

  it('ignores the device for an IP change but alerts on an unknown network', () => {
    const event = session({ type: 'session_ip_changed' } as never)
    expect(decideAlert({ ...base, event, deviceKnown: false, networkKnown: true }).action).toBe('quiet')
    const d = decideAlert({ ...base, event, deviceKnown: true, networkKnown: false })
    expect(d.action).toBe('alert')
  })

  it('always alerts on a new account', () => {
    const event: AuthEvent = { type: 'user_created', user_id: 'x', email: 'x@example.com', at: '2026-09-24T20:00:00Z' }
    expect(decideAlert({ ...base, event, deviceKnown: true, networkKnown: true }).action).toBe('alert')
  })

  describe('E2E test account', () => {
    const test = { ...base, isTestAccount: true, deviceKnown: false }
    const azure = { org: 'AS8075 Microsoft Corporation' }

    it('is muted for the runner on GitHub (Azure) networks', () => {
      for (const ua of [UA.headless, UA.pixel7, 'node']) {
        const d = decideAlert({ ...test, event: session({ user_agent: ua }), networkKnown: false, ipInfo: azure })
        expect(d).toEqual({ action: 'quiet', reason: 'E2E test runner' })
      }
    })

    it('is muted for local test runs from a known network', () => {
      const d = decideAlert({ ...test, event: session({ user_agent: UA.headless }), networkKnown: true })
      expect(d.action).toBe('quiet')
    })

    it('still alerts for a real browser on that account', () => {
      const d = decideAlert({ ...test, event: session({ user_agent: UA.androidChrome }), networkKnown: false, ipInfo: azure })
      expect(d.action).toBe('alert')
    })

    it('still alerts for an automated client on an unknown non-GitHub network', () => {
      const d = decideAlert({
        ...test,
        event: session({ user_agent: UA.headless }),
        networkKnown: false,
        ipInfo: { org: 'AS9009 M247 Europe SRL' },
      })
      expect(d.action).toBe('alert')
    })

    it('does not mute the owner even with an automated UA', () => {
      const d = decideAlert({
        ...base,
        event: session({ user_agent: UA.headless }),
        deviceKnown: false,
        networkKnown: false,
        ipInfo: azure,
      })
      expect(d.action).toBe('alert')
    })
  })
})

describe('buildAlertEmail', () => {
  it('includes the key details and escapes HTML', () => {
    const { subject, html } = buildAlertEmail({
      event: session({ user_agent: '<script>x</script>' }),
      reasons: ['New network'],
      device: 'Unknown browser on unknown OS',
      ipInfo: { city: 'Springfield', region: 'Example State', country: 'US', org: 'AS64500 Example ISP' },
      timeZone: 'America/New_York',
      dashboardUrl: 'https://example.com',
    })
    expect(subject).toBe('Life Tracker: new sign-in (owner@example.com)')
    expect(html).toContain('203.0.113.5')
    expect(html).toContain('Springfield, Example State, US')
    expect(html).toContain('AS64500 Example ISP')
    expect(html).toContain('Sep 24, 2026')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
  })
})
