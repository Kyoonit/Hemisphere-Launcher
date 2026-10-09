/**
 * The server never writes content to GitHub (plan A, S2): it only starts the "Herald publish" workflow of the content
 * repository, which validates, signs and commits. Auth: the "Herald Publisher" GitHub App, installed on the content
 * repository only, with Actions: read and write (Contents: read). Staff never get GitHub access.
 */
import { fromB64, toB64 } from './crypto'

export interface GithubEnv {
  GITHUB_REPO: string
  GITHUB_BRANCH: string
  GITHUB_WORKFLOW: string
  GITHUB_APP_ID?: string
  /** App private key converted to PKCS#8 DER, base64 (npm run herald:github-app) */
  GITHUB_APP_KEY?: string
  GITHUB_INSTALLATION_ID?: string
}

const API = 'https://api.github.com'

export const githubConfigured = (env: GithubEnv) => Boolean(env.GITHUB_APP_ID && env.GITHUB_APP_KEY && env.GITHUB_INSTALLATION_ID)

const b64url = (bytes: Uint8Array) => toB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const utf8 = (s: string) => new TextEncoder().encode(s)

/** GitHub sometimes closes idle connections or answers 5xx: retried, like tools/release.mjs. */
async function gh(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${API}${path}`, {
        ...init,
        headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'herald-server', 'x-github-api-version': '2022-11-28', ...(init.headers ?? {}) },
      })
      if (res.status >= 500 && attempt < 3) continue
      if (!res.ok) throw new Error(`GitHub ${init.method ?? 'GET'} ${path}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`)
      return res
    } catch (err) {
      if (attempt >= 3 || (err instanceof Error && err.message.startsWith('GitHub '))) throw err
    }
  }
}

/** Installation tokens last 1 hour: kept in memory while the isolate lives (RSA signing costs CPU). */
let cached: { token: string; until: number } | null = null

async function accessToken(env: GithubEnv): Promise<string> {
  if (cached && cached.until > Date.now()) return cached.token
  const now = Math.floor(Date.now() / 1000)
  const part = (o: object) => b64url(utf8(JSON.stringify(o)))
  const unsigned = `${part({ alg: 'RS256', typ: 'JWT' })}.${part({ iat: now - 60, exp: now + 540, iss: env.GITHUB_APP_ID })}`
  const key = await crypto.subtle.importKey('pkcs8', fromB64(env.GITHUB_APP_KEY!), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const jwt = `${unsigned}.${b64url(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, utf8(unsigned))))}`
  const res = await gh(`/app/installations/${env.GITHUB_INSTALLATION_ID}/access_tokens`, jwt, { method: 'POST' })
  const { token, expires_at } = (await res.json()) as { token: string; expires_at: string }
  cached = { token, until: Date.parse(expires_at) - 10 * 60_000 }
  return token
}

/** Starts the publish workflow. GitHub queues at most one run behind the running one: the publisher always takes the
 *  newest queued job, so nothing is lost when runs are merged. */
export async function startPublishWorkflow(env: GithubEnv, reason: string): Promise<void> {
  const token = await accessToken(env)
  await gh(`/repos/${env.GITHUB_REPO}/actions/workflows/${env.GITHUB_WORKFLOW}/dispatches`, token, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ref: env.GITHUB_BRANCH, inputs: { reason: reason.slice(0, 100) } }),
  })
}

/**
 * A file of the latest release of the PRIVATE Herald releases repository, streamed to a signed-in Herald app (its
 * updates). The App needs Contents: read on that repository; nothing is public, nothing is stored here.
 */
export async function latestReleaseFile(env: GithubEnv, repo: string, name: string): Promise<Response> {
  const token = await accessToken(env)
  const release = (await (await gh(`/repos/${repo}/releases/latest`, token)).json()) as { assets: { name: string; url: string; size: number }[] }
  const asset = release.assets.find((a) => a.name === name)
  if (!asset) return new Response('not found', { status: 404 })
  // GitHub answers with a redirect to a short-lived storage link, fetched WITHOUT the token; the body is streamed through
  const pointer = await fetch(asset.url, { redirect: 'manual', headers: { authorization: `Bearer ${token}`, accept: 'application/octet-stream', 'user-agent': 'herald-server' } })
  const location = pointer.headers.get('location')
  const file = location ? await fetch(location, { headers: { 'user-agent': 'herald-server' } }) : pointer
  if (!file.ok || !file.body) return new Response('not available', { status: 502 })
  return new Response(file.body, { headers: { 'content-type': name.endsWith('.yml') ? 'text/yaml' : 'application/octet-stream', 'content-length': String(asset.size), 'cache-control': 'no-store' } })
}
