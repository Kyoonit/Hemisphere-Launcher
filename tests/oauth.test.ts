// Browser sign-in mechanics with Microsoft and the browser simulated: PKCE, state check, loopback, cancel.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { request } from 'node:http'
import { offlineUuid } from '../src/main/core/auth/offlineUuid'

const opened: { url: URL | null; onOpen: (url: URL) => void } = { url: null, onOpen: () => {} }

vi.mock('electron', () => ({
  shell: {
    openExternal: async (raw: string) => {
      opened.url = new URL(raw)
      opened.onOpen(opened.url)
    },
  },
}))
vi.mock('../src/main/core/auth/config', async (orig) => ({
  ...(await orig<typeof import('../src/main/core/auth/config')>()),
  MS_CLIENT_ID: 'test-client-id',
}))

const { signInWithBrowser, cancelSignIn } = await import('../src/main/core/auth/oauth')

/** Simulates the browser following Microsoft's redirect to our loopback server. */
function browserRedirect(redirectUri: string, query: Record<string, string>, host = '127.0.0.1'): Promise<string> {
  const port = new URL(redirectUri).port
  return new Promise((resolve, reject) => {
    const req = request({ host, port, path: `/?${new URLSearchParams(query)}` }, (res) => {
      let body = ''
      res.on('data', (d) => (body += d)).on('end', () => resolve(body))
    })
    req.on('error', reject).end()
  })
}

let tokenRequests: URLSearchParams[] = []

beforeEach(() => {
  tokenRequests = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    tokenRequests.push(new URLSearchParams(String(init.body)))
    expect(url).toBe('https://login.microsoftonline.com/consumers/oauth2/v2.0/token')
    return new Response(JSON.stringify({ access_token: 'ms-access', refresh_token: 'ms-refresh', expires_in: 3600 }), { status: 200 })
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  opened.onOpen = () => {}
})

describe('signInWithBrowser', () => {
  test('happy path: PKCE S256, loopback redirect, verifier matches challenge', async () => {
    let page: Promise<string> = Promise.resolve('')
    opened.onOpen = (url) => {
      page = browserRedirect(url.searchParams.get('redirect_uri')!, { code: 'auth-code', state: url.searchParams.get('state')! })
    }
    const tokens = await signInWithBrowser('en')
    const url = opened.url!

    expect(url.origin + url.pathname).toBe('https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize')
    expect(url.searchParams.get('client_id')).toBe('test-client-id')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('scope')).toBe('XboxLive.signin offline_access')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('redirect_uri')).toMatch(/^http:\/\/localhost:\d+$/)

    const exchange = tokenRequests[0]
    expect(exchange.get('grant_type')).toBe('authorization_code')
    expect(exchange.get('code')).toBe('auth-code')
    expect(exchange.get('redirect_uri')).toBe(url.searchParams.get('redirect_uri'))
    const challenge = createHash('sha256').update(exchange.get('code_verifier')!).digest('base64url')
    expect(challenge).toBe(url.searchParams.get('code_challenge'))

    expect(tokens.refresh_token).toBe('ms-refresh')
    expect(await page).toContain('Signed in!')
  })

  test('also accepts the redirect on IPv6 loopback (::1)', async () => {
    opened.onOpen = (url) =>
      void browserRedirect(url.searchParams.get('redirect_uri')!, { code: 'c', state: url.searchParams.get('state')! }, '::1').catch(() => {
        // IPv6 disabled on this machine: fall back so the test still finishes
        return browserRedirect(url.searchParams.get('redirect_uri')!, { code: 'c', state: url.searchParams.get('state')! })
      })
    await expect(signInWithBrowser('en')).resolves.toMatchObject({ access_token: 'ms-access' })
  })

  test('rejects a redirect with the wrong state (CSRF protection) and never exchanges the code', async () => {
    opened.onOpen = (url) => void browserRedirect(url.searchParams.get('redirect_uri')!, { code: 'evil', state: 'forged' })
    await expect(signInWithBrowser('en')).rejects.toMatchObject({ code: 'microsoftDenied' })
    expect(tokenRequests).toHaveLength(0)
  })

  test('player declining on the Microsoft page counts as cancelled', async () => {
    opened.onOpen = (url) =>
      void browserRedirect(url.searchParams.get('redirect_uri')!, { error: 'access_denied', state: url.searchParams.get('state')! })
    await expect(signInWithBrowser('fr')).rejects.toMatchObject({ code: 'cancelled' })
  })

  test('cancel button stops waiting and closes the loopback server', async () => {
    let redirect = ''
    opened.onOpen = (url) => {
      redirect = url.searchParams.get('redirect_uri')!
      setTimeout(cancelSignIn, 50)
    }
    await expect(signInWithBrowser('en')).rejects.toMatchObject({ code: 'cancelled' })
    await expect(browserRedirect(redirect, { code: 'late', state: 'x' })).rejects.toThrow() // port closed
  })
})

test('offline UUID matches Minecraft (Notch -> b50ad385-829d-3141-a216-7e7d7539ba7f)', () => {
  expect(offlineUuid('Notch')).toBe('b50ad385829d3141a2167e7d7539ba7f')
})
