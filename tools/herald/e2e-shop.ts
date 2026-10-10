// Catalogue in the launchers (launcher 1.4, step 3c) end-to-end, against a LOCAL server whose profiles table is EMPTY.
// A stand-in for Mojang's session server runs here (port 8799; the dev server is told about it, local only):
//   npm run herald:server:reset-local && npm run herald:server:migrate && npm run herald:server:dev     then
//   node tools/herald/e2e-shop.ts
// Players checked like Minecraft servers do (join / hasJoined), sealed items, a mark per player, tracing a leak.
import { createServer } from 'node:http'
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

// ------------------------------------------------------------------ Mojang's session server, as the launcher sees it
const ACCOUNTS: Record<string, { id: string; name: string }> = { 'token-kyo': { id: 'a'.repeat(32), name: 'Kyo' }, 'token-alex': { id: 'b'.repeat(32), name: 'Alex' } }
const joined = new Map<string, { id: string; name: string }>() // serverId|name → profile
const mojang = createServer((req, res) => {
  const url = new URL(req.url!, 'http://x')
  if (req.method === 'POST' && url.pathname === '/session/minecraft/join') {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => {
      const b = JSON.parse(data) as { accessToken: string; selectedProfile: string; serverId: string }
      const who = ACCOUNTS[b.accessToken]
      if (!who || who.id !== b.selectedProfile) return res.writeHead(403).end('{"error":"ForbiddenOperationException"}')
      joined.set(`${b.serverId}|${who.name}`, who)
      res.writeHead(204).end()
    })
    return
  }
  if (req.method === 'GET' && url.pathname === '/session/minecraft/hasJoined') {
    const who = joined.get(`${url.searchParams.get('serverId')}|${url.searchParams.get('username')}`)
    return who ? res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id: who.id, name: who.name, properties: [] })) : res.writeHead(204).end()
  }
  res.writeHead(404).end()
})
await new Promise<void>((r) => mojang.listen(8799, '127.0.0.1', r))

/** What the launcher does: challenge, join at "Mojang" with the player's own token, verify */
async function verify(accessToken: string, name: string) {
  const { serverId } = (await call('GET', '/player/challenge')).body
  const who = ACCOUNTS[accessToken]
  await fetch('http://127.0.0.1:8799/session/minecraft/join', { method: 'POST', body: JSON.stringify({ accessToken, selectedProfile: who?.id ?? 'x', serverId }) })
  return call('POST', '/player/verify', null, { name, serverId })
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
check((await verify('token-kyo', 'Alex')).status === 403, 'a player cannot verify as another one')
const { serverId: old } = (await call('GET', '/player/challenge')).body
check((await call('POST', '/player/verify', null, { name: 'Kyo', serverId: old.slice(0, 39) + (old.endsWith('0') ? '1' : '0') })).status === 403, 'a made-up server id is refused')
const kyo = await verify('token-kyo', 'Kyo')
check(kyo.status === 200 && kyo.body.id === 'a'.repeat(32) && typeof kyo.body.token === 'string', 'Kyo is verified through Mojang (the launcher never gave Herald a Minecraft token)')
const alex = await verify('token-alex', 'Alex')

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
check((await verify('token-alex', 'Alex')).body.blocked === true, 'and cannot get a new access')
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

const journal = (await call('GET', '/activity?area=catalogue', OWNER)).body.entries as { action: string }[]
check(['catalogue.trace', 'catalogue.block', 'catalogue.unblock'].every((a) => journal.some((e) => e.action === a)), 'tracing and blocking are in the journal')

mojang.close()
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall shop checks passed')
process.exit(failures ? 1 : 0)
