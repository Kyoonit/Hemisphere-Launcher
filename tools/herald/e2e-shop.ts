// Catalogue in the launchers (launcher 1.4, step 3c) end-to-end, against a LOCAL server whose profiles table is EMPTY.
// Player certificates are signed here by a stand-in for Mojang (MOJANG_TEST_KEY / MOJANG_TEST_PRIVATE in .dev.vars; the
// local server trusts that key only when HERALD_ENV is local):
//   npm run herald:server:reset-local && npm run herald:server:migrate && npm run herald:server:dev     then
//   node tools/herald/e2e-shop.ts
// Players prove their account offline (src/shared/playerProof.ts), sealed items, a mark per player, tracing a leak.
import { createPrivateKey, generateKeyPairSync, sign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { decodePng, encodePng } from '../../src/shared/png.ts'
import { unseal } from '../../src/shared/sealed.ts'

const ROOT = join(import.meta.dirname, '..', '..')
const BASE = (process.argv[2] ?? 'http://127.0.0.1:8787').replace(/\/$/, '')
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(BASE)) throw new Error('local server only')
const vars = Object.fromEntries(readFileSync(join(ROOT, 'herald', 'server', '.dev.vars'), 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
const fixture = (name: string) => readFileSync(join(ROOT, 'tests', 'fixtures', 'models', name))
const file = (name: string, bytes: Uint8Array = fixture(name)) => ({ name, data: Buffer.from(bytes).toString('base64') })

let failures = 0
const check = (ok: boolean, label: string) => {
  console.log(`${ok ? '  ok ' : ' FAIL'}  ${label}`)
  if (!ok) failures++
}
const call = async (method: string, path: string, auth?: string | null, body?: unknown) => {
  const res = await fetch(BASE + path, { method, signal: AbortSignal.timeout(30_000), headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth.includes(' ') ? auth : `Bearer ${auth}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, any> }
}

// ------------------------------------------------------------------ the launcher's proof, with a stand-in for Mojang
if (!vars.MOJANG_TEST_PRIVATE) throw new Error('MOJANG_TEST_KEY / MOJANG_TEST_PRIVATE are missing from herald/server/.dev.vars')
const MOJANG = createPrivateKey({ key: Buffer.from(vars.MOJANG_TEST_PRIVATE, 'base64'), format: 'der', type: 'pkcs8' })
const ACCOUNTS: Record<string, { id: string; name: string }> = { 'token-kyo': { id: 'a'.repeat(32), name: 'Kyo' }, 'token-alex': { id: 'b'.repeat(32), name: 'Alex' } }

// written out again here (not imported): the server must check exactly these bytes (src/shared/playerProof.ts)
const certificatePayload = (id: string, expiresAt: number, key: Buffer) => {
  const head = Buffer.alloc(24)
  Buffer.from(id, 'hex').copy(head)
  head.writeBigUInt64BE(BigInt(expiresAt), 16)
  return Buffer.concat([head, key])
}
const proofMessage = (challenge: string, id: string) => Buffer.from(`hemisphere-herald:${challenge}:${id}`)

/** What the launcher does: a challenge, the account's certificate ("signed by Mojang"), the challenge signed with it */
async function verify(accessToken: string, { claim, signer = MOJANG, tamper = false }: { claim?: string; signer?: ReturnType<typeof createPrivateKey>; tamper?: boolean } = {}) {
  const given = (await call('GET', '/player/challenge')).body.serverId as string
  // tamper: a challenge Herald never gave (its last digit changed)
  const serverId = tamper ? given.slice(0, 39) + (given.endsWith('0') ? '1' : '0') : given
  const who = ACCOUNTS[accessToken]
  const player = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const spki = player.publicKey.export({ type: 'spki', format: 'der' })
  const expiresAt = Date.now() + 48 * 3_600_000
  const id = claim ?? who.id
  const proof = {
    id,
    name: who.name,
    publicKey: spki.toString('base64'),
    expiresAt,
    keySignature: sign('sha1', certificatePayload(who.id, expiresAt, spki), signer).toString('base64'),
    signature: sign('sha256', proofMessage(serverId, id), player.privateKey).toString('base64'),
  }
  return call('POST', '/player/verify', null, { serverId, proof })
}

console.log(`Herald shop test → ${BASE}`)
const boot = await call('POST', '/bootstrap', null, { token: vars.BOOTSTRAP_TOKEN, name: 'Liable', role: 'owner' })
if (boot.status !== 200) throw new Error('the local profiles table must be empty (npm run herald:server:reset-local)')
const OWNER = (await call('POST', '/login', null, { name: 'Liable', code: boot.body.code })).body.token as string
const mk = async (name: string, role: string) => {
  const p = await call('POST', '/profiles', OWNER, { name, role })
  return (await call('POST', '/login', null, { name, code: p.body.code })).body.token as string
}
const ADMIN = await mk('Covee', 'admin')
const MOD = await mk('Mira', 'moderator')

// a model (Minecraft JSON + texture) and a skin, shown in the launchers; a third item stays on Herald only
const crown = (await call('POST', '/catalogue', ADMIN, { sheet: { kind: 'model', name: 'Crown', slot: 'head', patreonUrl: 'https://www.patreon.com/posts/crown-1' } })).body
await call('POST', `/catalogue/${crown.id}/files`, ADMIN, { files: [file('crown.json'), file('crown.png')] })
const skinPx = { width: 64, height: 64, rgba: new Uint8Array(64 * 64 * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 7) & 0xff)) }
const knight = (await call('POST', '/catalogue', ADMIN, { sheet: { kind: 'skin', name: 'Knight', patreonUrl: 'https://www.patreon.com/posts/knight-2' } })).body
await call('POST', `/catalogue/${knight.id}/files`, ADMIN, { files: [file('knight.png', encodePng(skinPx))] })
const draft = (await call('POST', '/catalogue', ADMIN, { sheet: { kind: 'model', name: 'Secret hat' } })).body
await call('POST', `/catalogue/${draft.id}/files`, ADMIN, { files: [file('top_hat.bbmodel')] })
for (const id of [crown.id, knight.id]) await call('POST', `/catalogue/${id}/status`, ADMIN, { status: 'published' })

const list = await call('GET', '/shop')
const listed = (id: string) => list.body.items.some((i: { id: string }) => i.id === id)
check(list.status === 200 && listed(crown.id) && listed(knight.id) && !listed(draft.id), 'the launchers see what is shown, not what stays on Herald')
check(list.body.items.every((i: Record<string, unknown>) => !('files' in i) && !('versions' in i) && !('createdBy' in i)), 'the list says nothing about files or staff')

// players
check((await verify('token-kyo', { claim: 'b'.repeat(32) })).status === 403, 'a player cannot verify as another one')
check((await verify('token-kyo', { signer: generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey })).status === 403, 'a certificate not signed by Mojang is refused')
check((await verify('token-kyo', { tamper: true })).status === 403, 'a made-up challenge is refused')
const kyo = await verify('token-kyo')
check(kyo.status === 200 && kyo.body.id === 'a'.repeat(32) && typeof kyo.body.token === 'string', 'Kyo proves the account offline (Herald calls no Mojang API, gets no Minecraft token)')
const alex = await verify('token-alex')

check((await call('GET', `/shop/${crown.id}`)).status === 401, 'items need a verified player')
check((await call('GET', `/shop/${crown.id}`, `Player ${kyo.body.token.slice(0, -2)}xx`)).status === 401, 'a changed player token is refused')
check((await call('GET', `/shop/${draft.id}`, `Player ${kyo.body.token}`)).status === 404, 'an item on Herald only is never given')

const get = async (id: string, token: string) => {
  const r = await call('GET', `/shop/${id}`, `Player ${token}`)
  const plain = await unseal(Buffer.from(r.body.sealed, 'base64'), Buffer.from(r.body.key, 'base64'))
  return { sealed: Buffer.from(r.body.sealed, 'base64'), bundle: JSON.parse(new TextDecoder().decode(plain)) }
}
const kyoCrown = await get(crown.id, kyo.body.token)
check(kyoCrown.bundle.id === crown.id && kyoCrown.bundle.model.cubes.length > 0 && kyoCrown.bundle.model.textures.length === 1, 'Kyo gets the crown, sealed: the model already read (no project file)')
check(!kyoCrown.sealed.includes(Buffer.from('crown')) && !kyoCrown.sealed.includes(Buffer.from('cubes')), 'nothing readable in the sealed bytes')
const png = (src: string) => Buffer.from(src.slice(src.indexOf(',') + 1), 'base64')
const original = await decodePng(fixture('crown.png'))
const marked = await decodePng(png(kyoCrown.bundle.model.textures[0].src))
check(marked.rgba.every((v, i) => Math.abs(v - original.rgba[i]) <= 1) && !Buffer.from(marked.rgba).equals(Buffer.from(original.rgba)), 'its texture is marked, and looks the same (values moved by 1 at most)')
const alexCrown = await get(crown.id, alex.body.token)
check(!png(alexCrown.bundle.model.textures[0].src).equals(png(kyoCrown.bundle.model.textures[0].src)), 'Alex gets another mark')
const kyoKnight = await get(knight.id, kyo.body.token)
check(kyoKnight.bundle.kind === 'skin' && kyoKnight.bundle.skin.startsWith('data:image/png;base64,'), 'skins are marked too')

// tracing
const trace = (token: string, bytes: Uint8Array) => call('POST', '/catalogue/trace', token, { data: Buffer.from(bytes).toString('base64') })
check((await trace(MOD, png(kyoCrown.bundle.model.textures[0].src))).status === 403, 'a Moderator cannot trace')
const t1 = await trace(ADMIN, png(alexCrown.bundle.model.textures[0].src))
check(t1.status === 200 && t1.body.found && t1.body.player.name === 'Alex' && t1.body.received.some((r: { name: string }) => r.name === 'Crown'), 'a leaked crown texture says it was Alex’s')
const t2 = await trace(OWNER, png(kyoKnight.bundle.skin))
check(t2.body.found && t2.body.player.name === 'Kyo' && ['Crown', 'Knight'].every((n) => t2.body.received.some((r: { name: string }) => r.name === n)), 'a leaked skin says Kyo, and what Kyo received')
check((await trace(OWNER, fixture('crown.png'))).body.found === false, 'the original texture has no mark')

// blocking the player who leaked
check((await call('POST', `/catalogue/players/${'b'.repeat(32)}/block`, MOD, { blocked: true })).status === 403, 'a Moderator cannot block a player')
const blockedList = await call('POST', `/catalogue/players/${'b'.repeat(32)}/block`, ADMIN, { blocked: true })
check(blockedList.status === 200 && blockedList.body.players.some((p: { name: string }) => p.name === 'Alex'), 'an Admin blocks Alex from the catalogue')
const refused = await call('GET', `/shop/${knight.id}`, `Player ${alex.body.token}`)
check(refused.status === 403 && refused.body.blocked === true, 'Alex gets nothing more, even with a token still valid (the launcher is told to forget)')
check((await verify('token-alex')).body.blocked === true, 'and cannot get a new access')
check((await call('GET', '/shop', `Player ${alex.body.token}`)).body.blocked === true && !(await call('GET', '/shop', `Player ${kyo.body.token}`)).body.blocked, 'the list tells Alex’s launcher (and only Alex’s) to forget what it kept')
check((await call('GET', `/shop/${knight.id}`, `Player ${kyo.body.token}`)).status === 200, 'other players are not affected')
check((await trace(ADMIN, png(alexCrown.bundle.model.textures[0].src))).body.player.blockedAt > 0, 'tracing shows Alex is blocked')
await call('POST', `/catalogue/players/${'b'.repeat(32)}/block`, ADMIN, { blocked: false })
check((await call('GET', `/shop/${knight.id}`, `Player ${alex.body.token}`)).status === 200, 'unblocked, Alex can try things on again')

// taken out of the launchers
await call('POST', `/catalogue/${crown.id}/status`, ADMIN, { status: 'hidden' })
check(!(await call('GET', '/shop')).body.items.some((i: { id: string }) => i.id === crown.id), 'a hidden item leaves the list')
check((await call('GET', `/shop/${crown.id}`, `Player ${kyo.body.token}`)).status === 404, 'and is not given any more')
check((await call('GET', `/shop/thumb/${knight.id}`)).status === 404, 'no picture yet: none given')

// the original files downloaded from Herald carry the downloader's mark
check((await call('GET', `/catalogue/${crown.id}/original`, ADMIN)).status === 403, 'an Admin without the permission cannot download the originals')
const originals = (await call('GET', `/catalogue/${crown.id}/original`, OWNER)).body as { files: { name: string; data: string }[] }
const ownerPng = Buffer.from(originals.files.find((f) => f.name === 'crown.png')!.data, 'base64')
const ownerPx = await decodePng(ownerPng)
check(ownerPx.rgba.every((v, i) => Math.abs(v - original.rgba[i]) <= 1) && !Buffer.from(ownerPx.rgba).equals(Buffer.from(original.rgba)), 'a downloaded original is marked, and looks the same')
const t3 = await trace(ADMIN, ownerPng)
check(t3.body.found === true && t3.body.staff?.name === 'Liable' && !t3.body.player && t3.body.downloads.some((d: { name: string }) => d.name === 'Crown'), 'tracing it names the staff member who downloaded it, and what they downloaded')
const project = (await call('GET', `/catalogue/${draft.id}/original`, OWNER)).body.files[0] as { name: string; data: string }
const inside = JSON.parse(Buffer.from(project.data, 'base64').toString('utf8')).textures[0].source as string
check((await trace(ADMIN, Buffer.from(inside.slice(inside.indexOf(',') + 1), 'base64'))).body.staff?.name === 'Liable', 'the pictures inside a Blockbench project are marked too')

const journal = (await call('GET', '/activity?area=catalogue', OWNER)).body.entries as { action: string }[]
check(['catalogue.trace', 'catalogue.block', 'catalogue.unblock'].every((a) => journal.some((e) => e.action === a)), 'tracing and blocking are in the journal')

console.log(failures ? `\n${failures} check(s) FAILED` : '\nall shop checks passed')
process.exit(failures ? 1 : 0)
