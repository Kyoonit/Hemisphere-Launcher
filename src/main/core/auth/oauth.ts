import { createServer, type Server } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { shell } from 'electron'
import { z } from 'zod'
import { AuthError, requestJson } from './errors'
import { HTTP_TIMEOUT_MS, MS_AUTHORIZE_URL, MS_CLIENT_ID, MS_SCOPE, MS_TOKEN_URL, SIGN_IN_TIMEOUT_MS } from './config'
import { callbackPage } from './callbackPage'

/**
 * Microsoft sign-in: OAuth 2.0 authorization code + PKCE in the player's own browser (RFC 8252),
 * redirected to a one-shot server on the loopback interface. No password ever touches the launcher.
 */

const TokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number(),
})
export type MsTokens = z.infer<typeof TokenSchema>

const b64url = (buf: Buffer) => buf.toString('base64url')

/** Active sign-in, so the UI can cancel it. */
let cancelActive: (() => void) | null = null

export function cancelSignIn(): void {
  cancelActive?.()
}

export async function signInWithBrowser(language: string): Promise<MsTokens> {
  if (!MS_CLIENT_ID) throw new AuthError('notConfigured')
  cancelSignIn()

  const verifier = b64url(randomBytes(32))
  const challenge = b64url(createHash('sha256').update(verifier).digest())
  const state = b64url(randomBytes(16))

  const { code, redirectUri } = await new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
    // Listen on both loopback addresses (browsers may resolve "localhost" to either), same port.
    const servers: Server[] = []
    let redirectUri = ''
    let settled = false

    const finish = (err: AuthError | null, code?: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      cancelActive = null
      servers.forEach((s) => s.close())
      if (err) reject(err)
      else resolve({ code: code!, redirectUri })
    }

    const handler: Parameters<typeof createServer>[1] = (req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (url.pathname !== '/') {
        res.writeHead(404).end()
        return
      }
      const params = url.searchParams
      const ok = params.get('state') === state && !!params.get('code')
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(callbackPage(ok, language))
      if (params.get('state') !== state) return finish(new AuthError('microsoftDenied', 'state mismatch'))
      if (params.get('error')) return finish(new AuthError(params.get('error') === 'access_denied' ? 'cancelled' : 'microsoftDenied', params.get('error')!))
      finish(null, params.get('code')!)
    }

    const timer = setTimeout(() => finish(new AuthError('timeout')), SIGN_IN_TIMEOUT_MS)
    cancelActive = () => finish(new AuthError('cancelled'))

    const first = createServer(handler)
    servers.push(first)
    first.once('error', (e) => finish(new AuthError('unknown', e.message)))
    first.listen(0, '127.0.0.1', () => {
      const port = (first.address() as { port: number }).port
      redirectUri = `http://localhost:${port}`
      const second = createServer(handler)
      servers.push(second)
      second.once('error', () => {}) // IPv6 may be disabled; IPv4 is enough then
      second.listen(port, '::1')

      const url = new URL(MS_AUTHORIZE_URL)
      url.search = new URLSearchParams({
        client_id: MS_CLIENT_ID,
        response_type: 'code',
        redirect_uri: redirectUri,
        scope: MS_SCOPE,
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        prompt: 'select_account',
      }).toString()
      shell.openExternal(url.toString()).catch((e) => finish(new AuthError('unknown', String(e))))
    })
  })

  return exchange({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier })
}

export function refreshMsTokens(refreshToken: string): Promise<MsTokens> {
  if (!MS_CLIENT_ID) throw new AuthError('notConfigured')
  return exchange({ grant_type: 'refresh_token', refresh_token: refreshToken })
}

async function exchange(params: Record<string, string>): Promise<MsTokens> {
  const { status, body } = await requestJson(MS_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: MS_CLIENT_ID, scope: MS_SCOPE, ...params }).toString(),
    timeoutMs: HTTP_TIMEOUT_MS,
  })
  const parsed = TokenSchema.safeParse(body)
  if (status !== 200 || !parsed.success) {
    const error = (body as { error?: string } | null)?.error
    // invalid_grant on refresh = session revoked or expired -> player must sign in again
    throw new AuthError(error === 'invalid_grant' ? 'microsoftDenied' : 'unknown', `token ${status} ${error ?? ''}`)
  }
  return parsed.data
}
