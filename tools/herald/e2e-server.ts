// Herald phase S6: the Server tab end-to-end, against the LOCAL server (the publisher runs here, nothing is pushed):
//   npm run herald:server:reset-local && npm run herald:server:dev     then     npm run herald:e2e-server
// Emergency maintenance (start now, back online), planned maintenance (announced, locked until announced), daily
// restart (dated change locked in a vault, day without restart), permissions, stale changes, history, journal.
import { execFileSync } from 'node:child_process'
import { createPrivateKey, createPublicKey, verify } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { FeedV2Schema, type FeedV2 } from '../../src/shared/feedV2.ts'
import { resolveFeed } from '../../src/shared/schedule.ts'
import { nextRestart } from '../../src/shared/restart.ts'

const ROOT = join(import.meta.dirname, '..', '..')
const BASE = (process.argv[2] ?? 'http://127.0.0.1:8787').replace(/\/$/, '')
const vars = Object.fromEntries(readFileSync(join(ROOT, 'herald', 'server', '.dev.vars'), 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
const testKey = createPublicKey({ key: Buffer.from(readFileSync(join(ROOT, 'herald', 'server', 'test-public-key.txt'), 'utf8').trim(), 'base64'), format: 'der', type: 'spki' })

let failures = 0
const check = (ok: boolean, label: string) => {
  console.log(`${ok ? '  ok ' : ' FAIL'}  ${label}`)
  if (!ok) failures++
}
const call = async (method: string, path: string, token?: string | null, body?: unknown) => {
  const res = await fetch(BASE + path, { method, signal: AbortSignal.timeout(20_000), headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, any> }
}
const out = mkdtempSync(join(tmpdir(), 'herald-e2e-server-'))
function publish(): FeedV2 {
  const signingKey = (createPrivateKey(readFileSync(join(homedir(), '.hemisphere', 'herald-test-key.pem'))).export({ type: 'pkcs8', format: 'der' }) as Buffer).toString('base64')
  execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', join(ROOT, 'tools', 'herald', 'publish-run.ts')], { env: { ...process.env, HERALD_URL: BASE, PUBLISHER_TOKEN: vars.PUBLISHER_TOKEN, SIGNING_KEY: signingKey, HERALD_REPO_DIR: out, HERALD_NO_GIT: '1' }, stdio: 'pipe' })
  const bytes = readFileSync(join(out, 'content', 'v2', 'feed.json'))
  if (!verify(null, bytes, testKey, Buffer.from(readFileSync(join(out, 'content', 'v2', 'feed.json.sig'), 'utf8').trim(), 'base64'))) throw new Error('bad signature')
  return FeedV2Schema.parse(JSON.parse(bytes.toString('utf8')))
}
const version = async (t: string) => (await call('GET', '/publications', t)).body.baseVersion as number
const iso = (t: number) => new Date(t).toISOString()

console.log(`Herald S6 server tab test → ${BASE}`)
const boot = await call('POST', '/bootstrap', null, { token: vars.BOOTSTRAP_TOKEN, name: 'Liable', role: 'owner' })
if (boot.status !== 200) throw new Error('run npm run herald:server:reset-local first (the Owner exists already)')
const owner = (await call('POST', '/login', null, { name: 'Liable', code: boot.body.code })).body.token as string
const login = async (name: string, role: string) => {
  const made = await call('POST', '/profiles', owner, { name, role })
  return (await call('POST', '/login', null, { name, code: made.body.code })).body.token as string
}
const mod = await login('FireLegendDad', 'moderator')
const admin = await login('Covee', 'admin')
const lk = await login('Kingly', 'lodgeKeeper')

// ---- emergency
check((await call('POST', '/server/maintenance-now', lk, { message: { en: 'x' } })).status === 403, 'a Lodge keeper cannot start a maintenance')
const now1 = await call('POST', '/server/maintenance-now', mod, { message: { en: 'Emergency fix', fr: 'Correction urgente' } })
check(now1.status === 200 && Boolean(now1.body.job), 'a Moderator starts a maintenance now (published at once)')
let feed = publish()
let view = resolveFeed(feed, {}, Date.now(), 'fr')
check(view.maintenance.active && view.maintenance.message.fr === 'Correction urgente', 'launchers see it running (French message)')
check((await call('POST', '/server/maintenance-now', mod, { message: { en: 'again' } })).status === 409, 'a second one cannot start while one runs')
check((await call('POST', '/server/back-online', mod)).status === 200, '“The server is back online”')
feed = publish()
check(!resolveFeed(feed, {}, Date.now(), 'en').maintenance.active, 'launchers see the server open again')

// ---- planned maintenance
const start = Date.now() + 2 * 86_400_000
check((await call('POST', '/server/maintenances', mod, { version: await version(mod), maintenance: { message: { en: 'x' }, start: iso(start) } })).status === 403, 'a Moderator cannot plan one (emergency only)')
const v0 = await version(admin)
const planned = await call('POST', '/server/maintenances', admin, { version: v0, maintenance: { message: { en: 'Big update' }, announceFrom: iso(Date.now() - 1000), start: iso(start), end: iso(start + 7_200_000) } })
check(planned.status === 200, 'an Admin plans one, announced from now')
check((await call('POST', '/server/maintenances', admin, { version: v0, maintenance: { message: { en: 'stale' }, start: iso(start) } })).status === 409, 'a change based on an older state is refused')
feed = publish()
view = resolveFeed(feed, {}, Date.now(), 'en')
check(view.maintenancePlanned?.message.en === 'Big update' && !view.maintenance.active, 'launchers announce it (not running yet)')
check(resolveFeed(feed, {}, start + 60_000, 'en').maintenance.active && !resolveFeed(feed, {}, start + 7_300_000, 'en').maintenance.active, 'it runs at its time and ends at its end')
const later = await call('POST', '/server/maintenances', admin, { version: await version(admin), maintenance: { message: { en: 'Secret one' }, announceFrom: iso(Date.now() + 86_400_000), start: iso(start + 86_400_000) } })
feed = publish()
check(later.status === 200 && feed.vaults.some((v) => v.kind === 'maintenance') && !feed.maintenances.some((m) => m.message.en === 'Secret one'), 'a maintenance announced later is locked in a vault until then')

// ---- daily restart
const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
const restart = {
  rules: [
    { from: '2026-01-01T00:00:00Z', time: '17:00', timeZone: 'Europe/Paris', durationMin: 5 },
    { from: iso(Date.now() + 3 * 86_400_000), time: '15:00', timeZone: 'UTC', durationMin: 5 },
  ],
  exceptions: [{ date: tomorrow, timeZone: 'Europe/Paris', skip: true }],
}
check((await call('POST', '/server/restart', mod, { version: await version(mod), restart })).status === 403, 'a Moderator cannot change the restart')
check((await call('POST', '/server/restart', admin, { version: await version(admin), restart: { rules: [restart.rules[1]], exceptions: [] } })).status === 400, 'refused without a rule already in force')
check((await call('POST', '/server/restart', admin, { version: await version(admin), restart })).status === 200, 'an Admin changes the time from a date and skips tomorrow')
feed = publish()
check(feed.restart?.rules.length === 1 && feed.vaults.some((v) => v.kind === 'restartRule') && feed.restart?.exceptions.length === 1, 'the coming change is locked in a vault, the skipped day is in the feed')
const r = resolveFeed(feed, {}, Date.now(), 'en').restart!
const tomorrowRestart = nextRestart(Date.parse(`${tomorrow}T00:30:00+01:00`), r)
check(new Date(tomorrowRestart.next).toISOString().slice(0, 10) !== tomorrow, 'no restart tomorrow: the next one is the day after')

// ---- history and journal
const history = (await call('GET', '/server/history', admin)).body as { action: string }[]
check(history.length === 5 && history.some((h) => h.action === 'maintenance.start') && history.some((h) => h.action === 'restart.update'), `every change kept (${history.length} versions)`)
const journal = (await call('GET', '/sync', admin)).body.activity.map((a: { action: string }) => a.action)
check(['maintenance.start', 'maintenance.end', 'maintenance.plan', 'restart.update'].every((x) => journal.includes(x)), 'everything is in the shared journal')

rmSync(out, { recursive: true, force: true })
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed.')
process.exitCode = failures ? 1 : 0
