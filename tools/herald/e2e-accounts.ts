// Herald phase S4: staff accounts end-to-end, against a server whose profiles table is EMPTY:
//   npm run herald:server:reset-local && npm run herald:server:dev     then     npm run herald:e2e-accounts
// One-time Owner creation, sign-in, lock after 5 wrong codes, role guards, Lodge keeper limits, revocation, new code.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..', '..')
const BASE = (process.argv[2] ?? 'http://127.0.0.1:8787').replace(/\/$/, '')
const vars = Object.fromEntries(readFileSync(join(ROOT, 'herald', 'server', '.dev.vars'), 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))

let failures = 0
const check = (ok: boolean, label: string) => {
  console.log(`${ok ? '  ok ' : ' FAIL'}  ${label}`)
  if (!ok) failures++
}
const call = async (method: string, path: string, token?: string | null, body?: unknown) => {
  const res = await fetch(BASE + path, { method, signal: AbortSignal.timeout(20_000), headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  return { status: res.status, body: (await res.json()) as Record<string, any> }
}

console.log(`Herald S4 accounts test → ${BASE}`)
check((await call('POST', '/bootstrap', null, { token: 'wrong', name: 'Liable', role: 'owner' })).status === 404, 'bootstrap refused without the one-time token')
const boot = await call('POST', '/bootstrap', null, { token: vars.BOOTSTRAP_TOKEN, name: 'Liable', role: 'owner' })
check(boot.status === 200 && /^[2-9A-Z]{5}(-[2-9A-Z]{5}){3}$/.test(boot.body.code), `Owner created, code shown once (${boot.body.code?.slice(0, 5)}-…)`)
check((await call('POST', '/bootstrap', null, { token: vars.BOOTSTRAP_TOKEN, name: 'Someone', role: 'owner' })).status === 409, 'a second Owner cannot be bootstrapped')
const devBoot = await call('POST', '/bootstrap', null, { token: vars.BOOTSTRAP_TOKEN, name: 'Kyonit', role: 'developer' })
check(devBoot.status === 200, 'Developer created')

check((await call('POST', '/login', null, { name: 'Liable', code: 'AAAAA-AAAAA-AAAAA-AAAAA' })).status === 401, 'wrong code refused')
const owner = await call('POST', '/login', null, { name: 'liable', code: boot.body.code.toLowerCase().replace(/-/g, ' ') })
check(owner.status === 200 && owner.body.me.role === 'owner', 'sign-in works (name and code: any case, dashes optional)')
const T = owner.body.token as string
check((await call('GET', '/me', T)).body.permissions?.includes('profiles.manage'), '/me gives the effective permissions')
check((await call('GET', '/sync', 'not-a-real-token-at-all-xxxxxxxx')).status === 401, 'a wrong session token is refused')

const admin = await call('POST', '/profiles', T, { name: 'Covee', role: 'admin' })
const lodge = await call('POST', '/profiles', T, { name: 'Iceorbs', role: 'lodgeKeeper', add: ['maintenance.emergency', 'publications.publish'] })
check(admin.status === 200 && lodge.status === 200, 'Owner creates an Admin and a Lodge keeper (codes shown once)')
check((await call('POST', '/profiles', T, { name: 'covee', role: 'moderator' })).status === 409, 'names are unique (any case)')
const lk = await call('POST', '/login', null, { name: 'Iceorbs', code: lodge.body.code })
check(!lk.body.me.permissions.includes('maintenance.emergency') && lk.body.me.permissions.includes('publications.publish'), 'a Lodge keeper never gets staff powers, even when added')
const ad = await call('POST', '/login', null, { name: 'Covee', code: admin.body.code })
check((await call('POST', '/profiles', ad.body.token, { name: 'Nova', role: 'moderator' })).status === 403, 'an Admin cannot create profiles (no profiles.manage)')
check((await call('PATCH', `/profiles/${owner.body.me.id}`, T, { revoked: true })).status === 403, 'nobody revokes themselves')

const sync = await call('GET', '/sync', T)
check(sync.body.people?.filter((p: any) => p.online).length === 3, `presence: ${sync.body.people?.filter((p: any) => p.online).map((p: any) => p.name).join(', ')} online`)
check(sync.body.activity?.some((a: any) => a.action === 'profile.create' && a.who === 'Liable'), 'the shared journal records who created what')

const revoked = await call('PATCH', `/profiles/${lodge.body.id}`, T, { revoked: true })
check(revoked.status === 200 && revoked.body.revoked === true, 'Owner revokes the Lodge keeper')
check((await call('GET', '/sync', lk.body.token)).status === 401, 'the revoked profile is signed out at once')
check((await call('POST', '/login', null, { name: 'Iceorbs', code: lodge.body.code })).status === 401, 'and cannot sign in again')

const fresh = await call('POST', `/profiles/${admin.body.id}/code`, T)
check((await call('GET', '/sync', ad.body.token)).status === 401, 'a new code signs the old sessions out')
check((await call('POST', '/login', null, { name: 'Covee', code: admin.body.code })).status === 401 && (await call('POST', '/login', null, { name: 'Covee', code: fresh.body.code })).status === 200, 'old code refused, new code works')

for (let i = 0; i < 4; i++) await call('POST', '/login', null, { name: 'Kyonit', code: 'WRONG-WRONG-WRONG-WRONG' })
const fifth = await call('POST', '/login', null, { name: 'Kyonit', code: 'WRONG-WRONG-WRONG-WRONG' })
const locked = await call('POST', '/login', null, { name: 'Kyonit', code: devBoot.body.code })
check(fifth.status === 401 && /locked/.test(fifth.body.error) && locked.status === 429, `5 wrong codes lock the profile, even the right code waits (“${locked.body.error}”)`)

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed')
process.exitCode = failures ? 1 : 0
