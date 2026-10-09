// Herald phase S3 end-to-end test, schema 2, against the STAGING server (needs the real chain: GitHub Actions + raw):
//   npm run herald:e2e-v2 -- https://herald-staging.<account>.workers.dev [minutes before the secret news opens, default 4]
// Publishes a test feed with a news locked in a vault, then checks what a launcher would see: the signed v2 feed at
// the pulse's commit, the vault listed but unreadable, its key refused before the time and given at the time, and
// the key published in a newer feed afterwards (fallback). Prints the opening time so a dev launcher can be watched.
import { createDecipheriv, createHash, createPublicKey, verify } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FeedV2Schema, type FeedV2 } from '../../src/shared/feedV2.ts'
import { contentAtCommit } from '../../src/shared/herald.ts'

const ROOT = join(import.meta.dirname, '..', '..')
const BASE = (process.argv[2] ?? '').replace(/\/$/, '')
const MINUTES = Number(process.argv[3] ?? 4)
const CONTENT = 'https://raw.githubusercontent.com/Kyoonit/herald-test-content/main/content/'
if (!BASE.startsWith('https://')) throw new Error('usage: npm run herald:e2e-v2 -- https://herald-staging.<account>.workers.dev [minutes]')
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
const iso = (t: number) => new Date(t).toISOString()
const hhmm = (t: number) => new Intl.DateTimeFormat('fr-FR', { timeStyle: 'medium' }).format(t)

async function readAt(commit: string) {
  const at = contentAtCommit(CONTENT, commit)!
  const bytes = Buffer.from(await (await fetch(at + 'v2/feed.json')).arrayBuffer())
  const sig = await (await fetch(at + 'v2/feed.json.sig')).text()
  return { at, bytes, sig, feed: FeedV2Schema.parse(JSON.parse(bytes.toString('utf8'))) as FeedV2 }
}
async function waitJob(id: string) {
  const started = Date.now()
  let job = (await call(`/dev/job/${id}`)).body
  while (['queued', 'publishing'].includes(job.status) && Date.now() - started < 5 * 60_000) {
    await sleep(3000)
    job = (await call(`/dev/job/${id}`)).body
  }
  return { job, seconds: Math.round((Date.now() - started) / 1000) }
}

const now = Date.now()
const opens = Math.ceil((now + MINUTES * 60_000) / 60_000) * 60_000 // on a round minute: easy to watch
const draft = {
  news: [
    { id: 'herald-s3-visible', date: iso(now).slice(0, 10), category: 'server', title: { en: 'Herald S3: visible now', fr: 'Herald S3 : visible tout de suite' }, body: { en: 'Test content (Herald phase S3).' } },
    { id: 'herald-s3-secret', date: iso(opens).slice(0, 10), category: 'event', title: { en: 'Herald S3: the secret news', fr: 'Herald S3 : la news secrète' }, body: { en: 'Locked in a vault until its time.' }, showFrom: iso(opens), featuredUntil: iso(opens + 30 * 60_000) },
  ],
  maintenances: [{ id: 'herald-s3-maintenance', message: { en: 'Test maintenance' }, announceFrom: iso(now - 60_000), start: iso(now + 2 * 86_400_000), end: iso(now + 2 * 86_400_000 + 2 * 3_600_000) }],
  restart: { rules: [{ from: '2026-01-01T00:00:00Z', time: '17:00', timeZone: 'Europe/Paris', durationMin: 5 }], exceptions: [] },
  events: [],
  banners: [{ id: 'herald-s3-banner', text: { en: 'Herald S3 test banner' }, level: 'info' }],
  welcome: [],
  backgrounds: [],
}

console.log(`Herald S3 (schema 2) end-to-end test → ${BASE}`)
const queued = await call('/dev/publish-v2', { feed: draft })
check(queued.status === 200 && queued.body.vaults?.length === 1, `feed queued, 1 item locked in a vault (opens ${hhmm(opens)})`)
const vaultId: string = queued.body.vaults?.[0]?.id
const done = await waitJob(queued.body.job)
check(done.job.status === 'done', `published by GitHub Actions in ${done.seconds} s (sequence ${done.job.sequence})${done.job.error ? ` — ${done.job.error}` : ''}`)

const pulse = (await call('/pulse')).body
const first = await readAt(pulse.commit)
check(verify(null, first.bytes, testKey, Buffer.from(first.sig.trim(), 'base64')), 'v2 feed signed with the test key, read at the pulse commit')
check(first.feed.news.map((n) => n.id).join() === 'herald-s3-visible', 'only the due news is readable; the secret one is not in the feed')
const vault = first.feed.vaults.find((v) => v.id === vaultId)!
check(Boolean(vault) && vault.opensAt === iso(opens) && !first.feed.vaultKeys[vaultId], 'the vault is listed with its opening time, without its key')
const file = Buffer.from(await (await fetch(first.at + vault.file.path)).arrayBuffer())
check(createHash('sha512').update(file).digest('hex') === vault.file.sha512, `vault file published next to the feed (${file.length} bytes, SHA-512 matches)`)
check(!file.toString('utf8').includes('secret news'), 'the vault file does not contain the text in clear')
const early = await call(`/vault-key/${vaultId}`)
check(early.status === 425, `key refused before the time (${Math.round(early.body.retryInMs / 1000)} s to go)`)

console.log(`       … waiting for ${hhmm(opens)} (a dev launcher pointed at the test content should show the news then)`)
await sleep(Math.max(0, opens - Date.now() - 400))
let got = await call(`/vault-key/${vaultId}`)
while (got.status === 425) {
  await sleep(got.body.retryInMs + 20)
  got = await call(`/vault-key/${vaultId}`)
}
check(got.status === 200, `key given at ${hhmm(got.body.now)} (${got.body.now - opens} ms after the opening, server clock)`)
const decipher = createDecipheriv('aes-256-gcm', Buffer.from(got.body.key, 'base64'), file.subarray(0, 12))
decipher.setAuthTag(file.subarray(file.length - 16))
const plain = Buffer.concat([decipher.update(file.subarray(12, file.length - 16)), decipher.final()])
check(createHash('sha256').update(plain).digest('hex') === vault.plainSha256 && JSON.parse(plain.toString()).id === 'herald-s3-secret', 'the vault opens: it is the secret news, intact')

// Fallback: the minute task republishes the feed with the key (for launchers that were offline at the opening)
const fallbackStart = Date.now()
let republished: FeedV2 | null = null
while (!republished && Date.now() - fallbackStart < 6 * 60_000) {
  await sleep(10_000)
  const p = (await call('/pulse')).body
  if (p.sequence > pulse.sequence) {
    const next = await readAt(p.commit)
    if (next.feed.vaultKeys[vaultId]) republished = next.feed
  }
}
check(Boolean(republished), `key republished in the feed (fallback) ${Math.round((Date.now() - opens) / 1000)} s after the opening`)
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed')
process.exitCode = failures ? 1 : 0
