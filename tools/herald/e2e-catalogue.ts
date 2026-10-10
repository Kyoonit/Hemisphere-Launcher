// Herald catalogue (launcher 1.4, step 3b) end-to-end, against a LOCAL server whose profiles table is EMPTY:
//   npm run herald:server:reset-local && npm run herald:server:migrate && npm run herald:server:dev     then
//   node tools/herald/e2e-catalogue.ts
// Roles, files and versions (big files in parts), Patreon link before showing, original files (Owner; Admins only
// when the Owner or a Developer gives it), journal (Lodge keepers never see the catalogue).
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..', '..')
const BASE = (process.argv[2] ?? 'http://127.0.0.1:8787').replace(/\/$/, '')
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(BASE)) throw new Error('local server only')
const vars = Object.fromEntries(readFileSync(join(ROOT, 'herald', 'server', '.dev.vars'), 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
const fixture = (name: string) => readFileSync(join(ROOT, 'tests', 'fixtures', 'models', name))
const file = (name: string, bytes: Buffer = fixture(name)) => ({ name, data: bytes.toString('base64') })

let failures = 0
const check = (ok: boolean, label: string) => {
  console.log(`${ok ? '  ok ' : ' FAIL'}  ${label}`)
  if (!ok) failures++
}
const call = async (method: string, path: string, token?: string | null, body?: unknown) => {
  const res = await fetch(BASE + path, { method, signal: AbortSignal.timeout(30_000), headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  return { status: res.status, body: (await res.json()) as Record<string, any> }
}
const signIn = async (name: string, code: string) => (await call('POST', '/login', null, { name, code })).body.token as string

console.log(`Herald catalogue test → ${BASE}`)
const boot = await call('POST', '/bootstrap', null, { token: vars.BOOTSTRAP_TOKEN, name: 'Liable', role: 'owner' })
const devBoot = await call('POST', '/bootstrap', null, { token: vars.BOOTSTRAP_TOKEN, name: 'Kyonit', role: 'developer' })
if (boot.status !== 200 || devBoot.status !== 200) throw new Error('the local profiles table must be empty (npm run herald:server:reset-local)')
const OWNER = await signIn('Liable', boot.body.code)
const DEV = await signIn('Kyonit', devBoot.body.code)
const mk = async (name: string, role: string) => {
  const p = await call('POST', '/profiles', OWNER, { name, role })
  return { id: p.body.id as string, token: await signIn(name, p.body.code) }
}
const admin = await mk('Covee', 'admin')
const admin2 = await mk('Nova', 'admin')
const mod = await mk('Mira', 'moderator')
const lodge = await mk('Iceorbs', 'lodgeKeeper')

check((await call('GET', '/catalogue', lodge.token)).status === 403, 'a Lodge keeper cannot see the catalogue')
check((await call('POST', '/catalogue', mod.token, { sheet: { name: '' } })).status === 400, 'an item needs a name')
const hat = await call('POST', '/catalogue', mod.token, { sheet: { kind: 'model', name: 'Top hat', slot: 'head', tier: 'Tier 1' } })
check(hat.status === 200 && hat.body.status === 'draft' && hat.body.version === 0, 'a Moderator adds a model: on Herald only (draft), no files yet')
const id = hat.body.id as string

check((await call('POST', `/catalogue/${id}/files`, mod.token, { files: [file('crown.json')] })).status === 400, 'files that cannot be read are refused (texture missing)')
check((await call('POST', `/catalogue/${id}/files`, mod.token, { files: [file('evil.exe', Buffer.from('x'))] })).status === 400, 'only .bbmodel, .json and .png files')
const v1 = await call('POST', `/catalogue/${id}/files`, mod.token, { files: [file('top_hat.bbmodel')] })
check(v1.status === 200 && v1.body.version === 1 && v1.body.files[0].name === 'top_hat.bbmodel', 'the Blockbench project is kept (version 1)')

// a big project (3 MB: kept in parts) as version 2, read back identical
const bb = JSON.parse(fixture('top_hat.bbmodel').toString('utf8'))
bb.notes = 'x'.repeat(3 * 1024 * 1024)
const big = Buffer.from(JSON.stringify(bb))
const v2 = await call('POST', `/catalogue/${id}/files`, mod.token, { files: [file('top_hat.bbmodel', big)] })
check(v2.status === 200 && v2.body.version === 2 && v2.body.versions.length === 2, 'a new version of the files (the first one is kept)')
const back = await call('GET', `/catalogue/${id}/files`, mod.token)
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')
check(back.status === 200 && sha(Buffer.from(back.body.files[0].data, 'base64')) === sha(big), 'a 3 MB file comes back identical (kept in parts)')
check((await call('GET', `/catalogue/${id}/files?version=1`, mod.token)).body.version === 1, 'an earlier version can be previewed')
check((await call('POST', `/catalogue/${id}/version`, mod.token, { version: 1 })).body.version === 1, 'and used again')

check((await call('POST', `/catalogue/${id}/status`, mod.token, { status: 'published' })).status === 403, 'a Moderator cannot show it in the launchers')
const noLink = await call('POST', `/catalogue/${id}/status`, admin.token, { status: 'published' })
check(noLink.status === 400 && /Patreon/.test(noLink.body.error), 'not shown in the launchers without its Patreon link')
check((await call('PATCH', `/catalogue/${id}`, mod.token, { sheet: { patreonUrl: 'http://patreon.com/x' } })).status === 400, 'the link must be https')
await call('PATCH', `/catalogue/${id}`, mod.token, { sheet: { patreonUrl: 'https://www.patreon.com/posts/top-hat-1' } })
const shown = await call('POST', `/catalogue/${id}/status`, admin.token, { status: 'published' })
check(shown.status === 200 && shown.body.status === 'published' && shown.body.publishedAt > 0, 'an Admin shows it in the launchers')
check((await call('PATCH', `/catalogue/${id}`, mod.token, { sheet: { patreonUrl: '' } })).status === 400, 'while shown, its Patreon link cannot be removed')
check((await call('POST', `/catalogue/${id}/status`, admin.token, { status: 'draft' })).status === 409, 'once shown, it is hidden (not back to draft)')

check((await call('GET', `/catalogue/${id}/original`, admin.token)).status === 403, 'an Admin cannot download the original files')
check((await call('GET', `/catalogue/${id}/original`, DEV)).status === 403, 'nor the Developer')
const orig = await call('GET', `/catalogue/${id}/original`, OWNER)
check(orig.status === 200 && orig.body.files.length === 1, 'the Owner can')
check((await call('PATCH', `/profiles/${admin2.id}`, admin.token, { add: ['catalogue.export'] })).status === 403, 'an Admin cannot give it')
check((await call('PATCH', `/profiles/${mod.id}`, DEV, { add: ['catalogue.export'] })).status === 403, 'it can only be given to Admins')
check((await call('PATCH', `/profiles/${admin.id}`, DEV, { add: ['catalogue.export'] })).status === 200, 'the Developer gives it to an Admin')
check((await call('GET', `/catalogue/${id}/original`, admin.token)).status === 200, 'who can then download them')

const skin = await call('POST', '/catalogue', mod.token, { sheet: { kind: 'skin', name: 'Knight' } })
const pngBytes = fixture('crown.png') // 16×16: not a skin
check((await call('POST', `/catalogue/${skin.body.id}/files`, mod.token, { files: [file('knight.png', pngBytes)] })).status === 400, 'a skin must be a 64×64 PNG')

check((await call('POST', `/catalogue/${id}/delete`, mod.token)).status === 403, 'a Moderator cannot delete')
check((await call('POST', `/catalogue/${id}/delete`, admin.token)).status === 200, 'an Admin deletes it for good')
check((await call('GET', `/catalogue/${id}/files`, OWNER)).status === 404, 'its files are gone')

const journal = (await call('GET', '/activity?area=catalogue', OWNER)).body.entries as { action: string }[]
check(['catalogue.create', 'catalogue.files', 'catalogue.publish', 'catalogue.export', 'catalogue.delete'].every((a) => journal.some((e) => e.action === a)), 'the journal keeps every step (downloads of originals included)')
const lkJournal = (await call('GET', '/activity', lodge.token)).body.entries as { action: string }[]
check(!lkJournal.some((e) => e.action.startsWith('catalogue.')), 'Lodge keepers never see the catalogue in the journal')

console.log(failures ? `\n${failures} check(s) FAILED` : '\nall catalogue checks passed')
process.exit(failures ? 1 : 0)
