// Catalogue in the launcher (1.4, step 3c): the account's proof, items kept sealed per account, opened in memory, offline.
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { generateKeyPairSync, sign } from 'node:crypto'
import { seal } from '../src/shared/sealed'
import { certificatePayload, proofProblem } from '../src/shared/playerProof'
import type { ShopItem } from '../src/shared/catalogueShop'

let root = ''
// safeStorage stand-in: reversible, but never the clear text on disk
vi.mock('electron', () => ({
  app: { getPath: () => root, isPackaged: true },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s).map((b) => b ^ 0x5a),
    decryptString: (b: Buffer) => Buffer.from(b.map((x) => x ^ 0x5a)).toString(),
  },
}))
const MS = 'a'.repeat(32)
const accounts = { accounts: [{ id: MS, name: 'Kyo', kind: 'microsoft', status: 'ok' }, { id: 'b'.repeat(32), name: 'Test', kind: 'offline', status: 'ok' }], activeId: MS }
vi.mock('../src/main/core/auth/accounts', () => ({
  getAccountsState: () => accounts,
  getLaunchCredentials: async () => ({ name: 'Kyo', uuid: MS, accessToken: 'mc-token', userType: 'msa' }),
}))

const item = (id: string, version = 1): ShopItem => ({ id, kind: 'model', name: 'Crown', description: '', patreonUrl: 'https://patreon.com/x', tier: '', category: '', slot: 'head', slim: false, adjust: { x: 0, y: 0, z: 0, scale: 1 }, newUntil: null, version, thumbnail: null, publishedAt: 1 })
const CROWN = 'c-crown00001'
let items: ShopItem[] = []
let online = true
let blocked = false
let tokenDays = 30
const calls: { url: string; init?: RequestInit }[] = []

async function delivery(id: string, version: number) {
  const key = crypto.getRandomValues(new Uint8Array(32))
  const bundle = { format: 1, id, version, kind: 'model', slot: 'head', slim: false, adjust: { x: 0, y: 0, z: 0, scale: 1 }, model: { kind: 'java', textures: [], cubes: [{ secret: 'MODEL-DATA' }], display: {} } }
  return { version, sealed: Buffer.from(await seal(new TextEncoder().encode(JSON.stringify(bundle)), key, `${id}-v${version}`)).toString('base64'), key: Buffer.from(key).toString('base64') }
}

// Minecraft's services, as the launcher sees them: a player certificate signed by a stand-in for Mojang
const mojang = generateKeyPairSync('rsa', { modulusLength: 2048 })
const mojangKey = mojang.publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
function certificate() {
  const player = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const spki = player.publicKey.export({ type: 'spki', format: 'der' })
  // Mojang's own format: microseconds in the date (it signs the milliseconds), "RSA" in headers around PKCS#8 / X.509
  const at = new Date(Date.now() + 48 * 3_600_000)
  const expiresAt = `${at.toISOString().slice(0, 19)}.${String(at.getUTCMilliseconds()).padStart(3, '0')}417Z`
  const pem = (label: string, der: Buffer) => `-----BEGIN ${label}-----\n${der.toString('base64').replace(/.{64}/g, '$&\n')}\n-----END ${label}-----\n`
  return {
    keyPair: { privateKey: pem('RSA PRIVATE KEY', player.privateKey.export({ type: 'pkcs8', format: 'der' })), publicKey: pem('RSA PUBLIC KEY', spki) },
    publicKeySignatureV2: sign('sha1', certificatePayload(MS, at.getTime(), spki), mojang.privateKey).toString('base64'),
    expiresAt,
  }
}

const reply = (body: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(body), { status })
vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
  calls.push({ url, init })
  if (!online) throw new TypeError('fetch failed')
  const path = new URL(url).pathname
  if (path === '/shop') return reply({ items, ...(blocked && (init?.headers as Record<string, string>)?.authorization === 'Player player-token' ? { blocked: true } : {}) })
  if (path === '/player/challenge') return reply({ serverId: 'f'.repeat(40) })
  if (path === '/player/certificates') return (init?.headers as Record<string, string>)?.authorization === 'Bearer mc-token' ? reply(certificate()) : reply({}, 401)
  if (blocked && (path === '/player/verify' || path.startsWith('/shop/c-'))) return reply({ error: 'blocked', blocked: true }, 403)
  if (path === '/player/verify') {
    // the real check, as Herald does it
    const body = JSON.parse(String(init?.body)) as { serverId: string; proof: Parameters<typeof proofProblem>[0] }
    const problem = await proofProblem(body.proof, body.serverId, Date.now(), [mojangKey])
    return problem ? reply({ error: problem }, 403) : reply({ token: 'player-token', expiresAt: Date.now() + 86_400_000 * tokenDays, id: body.proof.id, name: body.proof.name })
  }
  const m = path.match(/^\/shop\/(c-[a-z0-9]{10})$/)
  if (m) {
    const it = items.find((i) => i.id === m[1])
    if (!it) return reply({ error: 'gone' }, 404)
    return (init?.headers as Record<string, string>)?.authorization === 'Player player-token' ? reply(await delivery(it.id, it.version)) : reply({ error: 'no' }, 401)
  }
  return reply({ error: 'not found' }, 404)
})

const load = async () => {
  vi.resetModules()
  return import('../src/main/core/catalogue/shop')
}

describe('catalogue in the launcher', () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'shop-'))
    items = [item(CROWN)]
    online = true
    blocked = false
    tokenDays = 30
    calls.length = 0
    accounts.activeId = MS
  })

  test('the account proves itself with its player certificate (its token goes to Minecraft’s services only), the item is kept sealed', async () => {
    const shop = await load()
    expect((await shop.listShop()).ok).toBe(true)
    const r = await shop.shopItem(CROWN)
    expect(r.ok && r.value.model?.cubes.length).toBe(1)
    const certs = calls.find((c) => c.url.endsWith('/player/certificates'))!
    expect(certs.url).toBe('https://api.minecraftservices.com/player/certificates')
    expect(calls.find((c) => c.url.endsWith('/player/verify'))).toBeTruthy()
    // the Minecraft token never reaches Herald
    expect(calls.filter((c) => !c.url.includes('minecraftservices.com')).some((c) => JSON.stringify(c.init ?? {}).includes('mc-token'))).toBe(false)
    // on disk: sealed item, protected keys and player token, nothing in clear
    const dir = join(root, 'catalogue')
    const sealed = readFileSync(join(dir, 'items', MS, `${CROWN}-v1.bin`))
    expect(sealed.subarray(0, 4).toString()).toBe('HMS1')
    for (const f of [sealed, readFileSync(join(dir, 'keys.bin')), readFileSync(join(dir, 'players.bin'))]) {
      expect(f.includes('MODEL-DATA')).toBe(false)
      expect(f.includes('player-token')).toBe(false)
    }
  })

  test('items already seen open offline; a new version replaces the kept one', async () => {
    let shop = await load()
    await shop.listShop()
    await shop.shopItem(CROWN)
    // next start, no internet: list and item from disk
    online = false
    shop = await load()
    const list = await shop.listShop()
    expect(list.ok && list.value.offline && list.value.items.length).toBe(1)
    const r = await shop.shopItem(CROWN)
    expect(r.ok && r.value.version).toBe(1)
    // a new version online: fetched (the player token is kept), the old copy goes
    online = true
    items = [item(CROWN, 2)]
    await shop.listShop()
    calls.length = 0
    const r2 = await shop.shopItem(CROWN)
    expect(r2.ok && r2.value.version).toBe(2)
    expect(calls.some((c) => c.url.includes('minecraftservices'))).toBe(false)
    expect(readdirSync(join(root, 'catalogue', 'items', MS))).toEqual([`${CROWN}-v2.bin`])
  })

  test('an item taken out of the launchers is removed from the PC', async () => {
    const shop = await load()
    await shop.listShop()
    await shop.shopItem(CROWN)
    items = []
    await shop.listShop()
    expect(existsSync(join(root, 'catalogue', 'items', MS, `${CROWN}-v1.bin`))).toBe(false)
    expect((await shop.shopItem(CROWN)).ok).toBe(false)
  })

  test('only Microsoft accounts get items; offline without a kept copy says so', async () => {
    const shop = await load()
    await shop.listShop()
    accounts.activeId = 'b'.repeat(32)
    expect(await shop.shopItem(CROWN)).toMatchObject({ ok: false, error: 'needs-microsoft' })
    accounts.activeId = MS
    online = false
    expect(await shop.shopItem(CROWN)).toMatchObject({ ok: false, error: 'offline' })
    expect(await shop.shopItem('../../x')).toMatchObject({ ok: false, error: 'unknown-item' })
  })

  test('a player blocked by staff: everything kept for the account goes', async () => {
    const shop = await load()
    await shop.listShop()
    await shop.shopItem(CROWN)
    items = [item(CROWN, 2)]
    await shop.listShop()
    blocked = true
    expect(await shop.shopItem(CROWN)).toMatchObject({ ok: false, error: 'blocked' })
    expect(existsSync(join(root, 'catalogue', 'items', MS))).toBe(false)
    expect(readFileSync(join(root, 'catalogue', 'players.bin')).map((b) => b ^ 0x5a).toString()).not.toContain(MS)
  })

  test('the list tells a blocked player at once: kept copies go even before an item is opened', async () => {
    const shop = await load()
    await shop.listShop()
    await shop.shopItem(CROWN)
    blocked = true
    const list = await shop.listShop()
    expect(list.ok && list.value.blocked).toBe(true)
    expect(existsSync(join(root, 'catalogue', 'items', MS))).toBe(false)
    expect(await shop.shopItem(CROWN)).toMatchObject({ ok: false, error: 'blocked' })
  })

  test('kept copies open offline only while the access lasts', async () => {
    tokenDays = -1 // an access that has ended
    let shop = await load()
    await shop.listShop()
    expect((await shop.shopItem(CROWN)).ok).toBe(true)
    online = false
    shop = await load()
    await shop.listShop()
    expect(await shop.shopItem(CROWN)).toMatchObject({ ok: false, error: 'offline' })
    online = true
    tokenDays = 30
    expect((await shop.shopItem(CROWN)).ok).toBe(true)
  })
})
