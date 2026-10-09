// Herald phase S5: publications end-to-end, against the LOCAL server (the publisher runs here, nothing is pushed):
//   npm run herald:server:reset-local && npm run herald:server:dev     then     npm run herald:e2e-publications
// Statuses and permissions, stale saves, pictures, publish now, schedule (vault + its picture, opened at its time),
// vault reuse, take down, trash, comments, history, restricted drafts. Test key and test content only.
import { execFileSync } from 'node:child_process'
import { createDecipheriv, createHash, createPrivateKey, createPublicKey, verify } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { FeedV2Schema, VaultItemSchemas, type FeedV2 } from '../../src/shared/feedV2.ts'

const ROOT = join(import.meta.dirname, '..', '..')
const BASE = (process.argv[2] ?? 'http://127.0.0.1:8787').replace(/\/$/, '')
const vars = Object.fromEntries(readFileSync(join(ROOT, 'herald', 'server', '.dev.vars'), 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
const testKey = createPublicKey({ key: Buffer.from(readFileSync(join(ROOT, 'herald', 'server', 'test-public-key.txt'), 'utf8').trim(), 'base64'), format: 'der', type: 'spki' })

let failures = 0
const check = (ok: boolean, label: string) => {
  console.log(`${ok ? '  ok ' : ' FAIL'}  ${label}`)
  if (!ok) failures++
}
const call = async (method: string, path: string, token?: string | null, body?: unknown, raw?: { bytes: Uint8Array; headers: Record<string, string> }) => {
  const res = await fetch(BASE + path, {
    method,
    signal: AbortSignal.timeout(20_000),
    headers: { ...(raw ? raw.headers : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(raw ? { body: raw.bytes } : body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, any> }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const sha512 = (b: Buffer) => createHash('sha512').update(b).digest('hex')

const out = mkdtempSync(join(tmpdir(), 'herald-e2e-pubs-'))
function runPublisher() {
  const signingKey = (createPrivateKey(readFileSync(join(homedir(), '.hemisphere', 'herald-test-key.pem'))).export({ type: 'pkcs8', format: 'der' }) as Buffer).toString('base64')
  try {
    execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', join(ROOT, 'tools', 'herald', 'publish-run.ts')], {
      env: { ...process.env, HERALD_URL: BASE, PUBLISHER_TOKEN: vars.PUBLISHER_TOKEN, SIGNING_KEY: signingKey, HERALD_REPO_DIR: out, HERALD_NO_GIT: '1' },
      stdio: 'pipe',
    })
  } catch (err) {
    console.log(String((err as { stderr?: Buffer }).stderr ?? err))
  }
}
function readFeed(): FeedV2 {
  const bytes = readFileSync(join(out, 'content', 'v2', 'feed.json'))
  const sig = readFileSync(join(out, 'content', 'v2', 'feed.json.sig'), 'utf8')
  if (!verify(null, bytes, testKey, Buffer.from(sig.trim(), 'base64'))) throw new Error('bad signature')
  return FeedV2Schema.parse(JSON.parse(bytes.toString('utf8')))
}
const file = (path: string) => readFileSync(join(out, 'content', path))
function open(bytes: Buffer, keyB64: string): Buffer {
  const d = createDecipheriv('aes-256-gcm', Buffer.from(keyB64, 'base64'), bytes.subarray(0, 12))
  d.setAuthTag(bytes.subarray(bytes.length - 16))
  return Buffer.concat([d.update(bytes.subarray(12, bytes.length - 16)), d.final()])
}

/** A 1×1 WebP (valid file): the server checks the RIFF/WEBP header */
const WEBP = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64')

console.log(`Herald S5 publications test → ${BASE}`)
const boot = await call('POST', '/bootstrap', null, { token: vars.BOOTSTRAP_TOKEN, name: 'Liable', role: 'owner' })
if (boot.status !== 200) throw new Error('run npm run herald:server:reset-local first (the Owner exists already)')
const owner = (await call('POST', '/login', null, { name: 'Liable', code: boot.body.code })).body.token as string
const lkMade = await call('POST', '/profiles', owner, { name: 'Iceorbs', role: 'lodgeKeeper' })
const lk = (await call('POST', '/login', null, { name: 'Iceorbs', code: lkMade.body.code })).body.token as string
const stamp0 = (await call('GET', '/sync', owner)).body.contentStamp

// ---- a Lodge keeper writes, the staff reviews
const created = await call('POST', '/publications', lk, { kind: 'news', zone: 'Europe/Paris' })
check(created.status === 200 && /^n-[a-z0-9]{12}$/.test(created.body.id) && created.body.status === 'draft', `a Lodge keeper creates a news (${created.body.id})`)
const id = created.body.id as string
check((await call('POST', '/publications', lk, { kind: 'banner' })).status === 403, 'a Lodge keeper cannot write a banner')
let v = created.body.version
const data = { ...created.body.data, texts: { en: { title: 'Herald S5: hello', body: 'First paragraph.\n\nSecond one.' }, fr: { title: 'Herald S5 : bonjour', body: 'Premier paragraphe.' } }, done: { fr: true }, category: 'event', featuredDays: 2 }
const saved = await call('PATCH', `/publications/${id}`, lk, { version: v, data })
check(saved.status === 200 && saved.body.version === v + 1, 'saved (version +1)')
check((await call('PATCH', `/publications/${id}`, owner, { version: v, data })).status === 409, 'a save based on an older version is refused (409)')
v = saved.body.version
check((await call('POST', `/publications/${id}/status`, lk, { version: v, status: 'ready' })).status === 403, 'a Lodge keeper cannot mark it Ready')
const review = await call('POST', `/publications/${id}/status`, lk, { version: v, status: 'review' })
check(review.status === 200 && review.body.status === 'review', 'sent to review')
v = review.body.version
check((await call('POST', `/publications/${id}/publish`, owner, { version: v })).status === 409, 'publishing needs Ready first')

// ---- picture
const pic = await call('POST', '/images', owner, undefined, { bytes: WEBP, headers: { 'content-type': 'image/webp', 'x-width': '1', 'x-height': '1' } })
check(pic.status === 200 && pic.body.sha512 === sha512(WEBP), 'picture uploaded (WebP, id = SHA-256)')
check((await call('POST', '/images', owner, undefined, { bytes: Buffer.from('not a picture'), headers: { 'content-type': 'image/webp', 'x-width': '1', 'x-height': '1' } })).status === 400, 'anything but a WebP is refused')
const withPic = await call('PATCH', `/publications/${id}`, owner, { version: v, data: { ...data, image: pic.body } })
v = withPic.body.version
const ready = await call('POST', `/publications/${id}/status`, owner, { version: v, status: 'ready' })
check(ready.status === 200 && ready.body.status === 'ready', 'the Owner marks it Ready')
v = ready.body.version
check((await call('PATCH', `/publications/${id}`, owner, { version: v, data })).status === 423, 'a Ready publication is locked')

// ---- publish now
const pub1 = await call('POST', `/publications/${id}/publish`, owner, { version: v })
check(pub1.status === 200 && Boolean(pub1.body.job), 'published: a job is queued')
v = pub1.body.publication.version
runPublisher()
let feed = readFeed()
const n = feed.news.find((x) => x.id === id)
check(Boolean(n) && n!.title.fr === 'Herald S5 : bonjour' && n!.date.length === 10 && Boolean(n!.featuredUntil), 'the signed feed (test key, launcher schema) has the news, its French text, its big-card time')
check(Boolean(n?.imageFile) && existsSync(join(out, 'content', n!.imageFile!.path)) && sha512(file(n!.imageFile!.path)) === n!.imageFile!.sha512, 'its picture is next to the feed, SHA-512 as signed')
const jobs = (await call('GET', '/publications', owner)).body.jobs
check(jobs[0]?.status === 'done' && jobs[0]?.who === 'Liable', 'the job is done, by Liable')
check((await call('GET', '/sync', owner)).body.contentStamp !== stamp0, 'sync says the publications changed')

// ---- scheduled (locked in a vault with its picture)
const opensIn = 20_000
const from = new Date(Math.ceil((Date.now() + opensIn) / 1000) * 1000).toISOString()
const s = await call('POST', '/publications', owner, { kind: 'news', zone: 'UTC' })
const sid = s.body.id as string
let sv = s.body.version
const sdata = { ...s.body.data, texts: { en: { title: 'Herald S5: the secret one', body: 'Locked until its time.' } }, image: pic.body, schedule: { from, until: null, zone: 'UTC' } }
sv = (await call('PATCH', `/publications/${sid}`, owner, { version: sv, data: sdata })).body.version
sv = (await call('POST', `/publications/${sid}/status`, owner, { version: sv, status: 'ready' })).body.version
const pub2 = await call('POST', `/publications/${sid}/publish`, owner, { version: sv })
sv = pub2.body.publication.version
runPublisher()
feed = readFeed()
const vault = feed.vaults.find((x) => x.kind === 'news' && x.opensAt === from)
check(!feed.news.some((x) => x.id === sid) && Boolean(vault?.image), 'scheduled: not in the feed, a vault with its locked picture instead')
check(Boolean(vault) && sha512(file(vault!.file.path)) === vault!.file.sha512 && sha512(file(vault!.image!.path)) === vault!.image!.sha512, 'vault file and vault picture next to the feed, as signed')
check(!file(vault!.image!.path).equals(WEBP) && !file(vault!.file.path).toString().includes('secret'), 'nothing readable before the time (text and picture encrypted)')
check((await call('GET', `/vault-key/${vault!.id}`)).status === 425, 'key refused before the time')

// ---- another publish: the vault is reused (no new file)
const b = await call('POST', '/publications', owner, { kind: 'banner', zone: 'UTC' })
let bv = b.body.version
bv = (await call('PATCH', `/publications/${b.body.id}`, owner, { version: bv, data: { ...b.body.data, texts: { en: { text: 'Herald S5 test banner' } }, level: 'important' } })).body.version
bv = (await call('POST', `/publications/${b.body.id}/status`, owner, { version: bv, status: 'ready' })).body.version
await call('POST', `/publications/${b.body.id}/publish`, owner, { version: bv })
runPublisher()
feed = readFeed()
check(feed.banners.some((x) => x.id === b.body.id && x.level === 'important') && feed.vaults.some((x) => x.id === vault!.id), 'banner published; the unchanged scheduled news keeps its vault')

// ---- opening time
await sleep(Math.max(0, Date.parse(from) - Date.now()) + 300)
const key = await call('GET', `/vault-key/${vault!.id}`)
check(key.status === 200, 'key given at the time')
const item = VaultItemSchemas.news.parse(JSON.parse(open(file(vault!.file.path), key.body.key).toString('utf8')))
const picture = open(file(vault!.image!.path), key.body.key)
check(item.title.en === 'Herald S5: the secret one' && item.imageFile?.path === vault!.image!.path && sha512(picture) === item.imageFile.sha512 && picture.equals(WEBP), 'the vault opens: the news and its picture, intact')

// ---- take down, trash, restore
const down = await call('POST', `/publications/${id}/unpublish`, owner, { version: v })
check(down.status === 200, 'taken down')
v = down.body.publication.version
runPublisher()
check(!readFeed().news.some((x) => x.id === id), 'the feed no longer has it')
const del = await call('POST', `/publications/${id}/delete`, owner, { version: v })
check(del.status === 200 && Boolean(del.body.publication.deletedAt), 'moved to the trash')
v = del.body.publication.version
check((await call('POST', `/publications/${id}/delete`, lk, { version: v })).status === 403, 'a Lodge keeper cannot delete')
const back = await call('POST', `/publications/${id}/restore`, owner, { version: v })
check(back.status === 200 && back.body.status === 'draft' && !back.body.deletedAt, 'restored as a draft')

// ---- comments, history, restricted drafts
const c = await call('POST', `/publications/${id}/comments`, lk, { text: 'Can someone check the French?' })
check(c.status === 200 && c.body.comments.at(-1)?.who === 'Iceorbs', 'comment added')
const detail = (await call('GET', `/publications/${id}`, owner)).body
check(detail.versions.length >= 9 && detail.versions.some((x: { action: string }) => x.action === 'delete'), `history kept (${detail.versions.length} versions, the trash included)`)
const r = await call('POST', '/publications', owner, { kind: 'welcome', zone: 'UTC' })
await call('PATCH', `/publications/${r.body.id}`, owner, { version: r.body.version, data: { ...r.body.data, texts: { en: { text: 'Staff only draft' } }, visibleTo: ['owner', 'developer', 'admin', 'moderator'] } })
check(!(await call('GET', '/publications', lk)).body.publications.some((x: { id: string }) => x.id === r.body.id), 'a draft hidden from Lodge keepers is not listed for them')
check((await call('GET', `/publications/${r.body.id}`, lk)).status === 404, '… nor readable')
const activity = (await call('GET', '/sync', owner)).body.activity.map((a: { action: string }) => a.action)
check(['publication.create', 'publication.review', 'publication.ready', 'publication.publish', 'publication.schedule', 'publication.unpublish', 'publication.delete', 'publication.restore', 'publication.comment'].every((x) => activity.includes(x)), 'everything is in the shared journal')

rmSync(out, { recursive: true, force: true })
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed.')
process.exitCode = failures ? 1 : 0
