// Herald phase S2 end-to-end test (plan A: GitHub Actions signs and commits).
//   local:    npm run herald:server:dev   then   npm run herald:e2e
//             (no GitHub: the publisher runs here, writes to a temp folder, nothing is pushed)
//   staging:  npm run herald:e2e -- https://herald-staging.<account>.workers.dev
//             (the real chain: server → workflow of the TEST content repository → commit → pulse → launcher read)
// Checks what a launcher would check: the TEST signature, the shared schema, the sequence, and a vault that only
// opens at its time. Test keys and test content only (never the real feed).
import { execFileSync } from 'node:child_process'
import { createDecipheriv, createHash, createPrivateKey, createPublicKey, verify } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { FeedSchema } from '../../src/shared/feed.ts'

const ROOT = join(import.meta.dirname, '..', '..')
const BASE = (process.argv[2] ?? 'http://127.0.0.1:8787').replace(/\/$/, '')
const vars = Object.fromEntries(readFileSync(join(ROOT, 'herald', 'server', '.dev.vars'), 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
const testKey = createPublicKey({ key: Buffer.from(readFileSync(join(ROOT, 'herald', 'server', 'test-public-key.txt'), 'utf8').trim(), 'base64'), format: 'der', type: 'spki' })

let failures = 0
const check = (ok: boolean, label: string) => {
  console.log(`${ok ? '  ok ' : ' FAIL'}  ${label}`)
  if (!ok) failures++
}
const call = async (path: string, body?: unknown) => {
  const init: RequestInit = { signal: AbortSignal.timeout(20_000), headers: { authorization: `Bearer ${vars.DEV_TOKEN}`, 'content-type': 'application/json' } }
  const res = await fetch(BASE + path, body === undefined ? init : { ...init, method: 'POST', body: JSON.stringify(body) })
  return { status: res.status, body: (await res.json()) as Record<string, any> }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const TEST_FEED = {
  maintenance: { active: false, message: { en: 'Herald S2 test' } },
  restart: { time: '17:00', timeZone: 'Europe/Paris', durationMin: 5 },
  news: [{ id: 'herald-s2-test', date: '2026-10-09', category: 'server', title: { en: 'Herald test', fr: 'Test Herald' }, body: { en: 'Test content, never published to players.' } }],
}

/** Local mode: run the real publisher program here instead of GitHub Actions (no git, temp folder). */
const localOut = mkdtempSync(join(tmpdir(), 'herald-e2e-'))
function runLocalPublisher() {
  const signingKey = (createPrivateKey(readFileSync(join(homedir(), '.hemisphere', 'herald-test-key.pem'))).export({ type: 'pkcs8', format: 'der' }) as Buffer).toString('base64')
  try {
    execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', join(ROOT, 'tools', 'herald', 'publish-run.ts')], {
      env: { ...process.env, HERALD_URL: BASE, PUBLISHER_TOKEN: vars.PUBLISHER_TOKEN, SIGNING_KEY: signingKey, HERALD_REPO_DIR: localOut, HERALD_NO_GIT: '1' },
      stdio: 'pipe',
    })
  } catch {
    // a refused job exits with code 1: its status is checked below
  }
}

/** Publishes a feed and waits for the job to finish; returns the job and how long it took. */
async function publish(feed: unknown) {
  const started = Date.now()
  const queued = await call('/dev/publish', { feed })
  if (!queued.body.workflow) runLocalPublisher()
  let job = (await call(`/dev/job/${queued.body.job}`)).body
  while (['queued', 'publishing'].includes(job.status) && Date.now() - started < 5 * 60_000) {
    await sleep(3000)
    job = (await call(`/dev/job/${queued.body.job}`)).body
  }
  return { job, seconds: Math.round((Date.now() - started) / 1000), viaWorkflow: Boolean(queued.body.workflow) }
}

/** Reads the published feed like a launcher: at the pulse's commit (GitHub) or from the local output. */
async function readPublished(pulse: Record<string, any>): Promise<{ feed: Buffer; sig: string }> {
  if (pulse.commit === 'local') return { feed: readFileSync(join(localOut, pulse.dir, 'feed.json')), sig: readFileSync(join(localOut, pulse.dir, 'feed.json.sig'), 'utf8') }
  const base = `https://raw.githubusercontent.com/${pulse.repo}/${pulse.commit}/${pulse.dir}/`
  return { feed: Buffer.from(await (await fetch(base + 'feed.json')).arrayBuffer()), sig: await (await fetch(base + 'feed.json.sig')).text() }
}

console.log(`Herald S2 end-to-end test → ${BASE}`)
const health = await call('/health')
check(health.status === 200 && health.body.ok === true, `server answers (${health.body.env})`)

// 1. Publish: queued, validated + signed + committed by the publisher, pulse points at it, a launcher can read it
const first = await publish(TEST_FEED)
check(first.job.status === 'done', `publish done ${first.viaWorkflow ? 'by GitHub Actions' : 'by the local publisher'} in ${first.seconds} s (sequence ${first.job.sequence}, commit ${String(first.job.commit_sha).slice(0, 7)})${first.job.error ? ` — ${first.job.error}` : ''}`)
const pulse = (await call('/pulse')).body
check(pulse.sequence === first.job.sequence && pulse.commit === first.job.commit_sha, `pulse points at it (sequence ${pulse.sequence})`)
const published = await readPublished(pulse)
check(verify(null, published.feed, testKey, Buffer.from(published.sig.trim(), 'base64')), 'signature valid with the test public key (same check as the launcher)')
check(FeedSchema.safeParse(JSON.parse(published.feed.toString('utf8'))).success, 'feed valid with the shared launcher schema')

const second = await publish(TEST_FEED)
check(second.job.status === 'done' && second.job.sequence === first.job.sequence + 1, `sequence increases (${first.job.sequence} → ${second.job.sequence}, ${second.seconds} s)`)
const bad = await publish({ ...TEST_FEED, news: [{ ...TEST_FEED.news[0], image: 'https://evil.example/x.png' }] })
check(bad.job.status === 'failed' && /image/.test(bad.job.error ?? ''), `invalid content refused before signing (“${bad.job.error}”)`)
check((await call('/pulse')).body.sequence === second.job.sequence, 'a refused job publishes nothing (pulse unchanged)')

// 2. A vault opening in 4 s: locked before, opens to the second after, content intact
const vault = await call('/dev/vault', { payload: { title: 'Secret news' }, opensInSec: 4 })
check(vault.status === 200, `vault created (${vault.body.id})`)
const file = Buffer.from(vault.body.file, 'base64')
check(createHash('sha512').update(file).digest('hex') === vault.body.sha512, 'vault file matches its SHA-512 (what the signed feed will carry)')
const early = await call(`/vault-key/${vault.body.id}`)
check(early.status === 425 && early.body.retryInMs > 0, `key refused before the time (asks again in ${early.body.retryInMs} ms)`)
await sleep(Math.max(0, vault.body.opensAt - Date.now()) + 50)
// Like the launcher: if this PC's clock is ahead of the server's, the server says how long to wait (never trust the PC)
let opened = await call(`/vault-key/${vault.body.id}`)
for (let retry = 0; opened.status === 425 && retry < 3; retry++) {
  console.log(`       (this PC is ${opened.body.retryInMs} ms ahead of the server clock: waiting as told)`)
  await sleep(opened.body.retryInMs + 20)
  opened = await call(`/vault-key/${vault.body.id}`)
}
check(opened.status === 200, `key given at the time (${opened.body.now - vault.body.opensAt} ms after opening, by the server clock)`)
const key = Buffer.from(opened.body.key ?? '', 'base64')
const decipher = createDecipheriv('aes-256-gcm', key, file.subarray(0, 12))
decipher.setAuthTag(file.subarray(file.length - 16))
const plain = Buffer.concat([decipher.update(file.subarray(12, file.length - 16)), decipher.final()])
check(createHash('sha256').update(plain).digest('hex') === vault.body.plainSha256 && JSON.parse(plain.toString()).title === 'Secret news', 'vault opens with that key, content intact')
check((await call('/vault-key/test-unknown')).status === 404, 'unknown vault → 404')

// 3. Doors that must stay closed
check((await fetch(BASE + '/dev/publish', { method: 'POST', body: '{}' })).status === 404, '/dev routes hidden without the dev token')
check((await fetch(BASE + '/internal/next', { method: 'POST', headers: { authorization: `Bearer ${vars.DEV_TOKEN}` } })).status === 404, '/internal routes refuse anything but the publisher token')

rmSync(localOut, { recursive: true, force: true })
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed')
process.exitCode = failures ? 1 : 0
