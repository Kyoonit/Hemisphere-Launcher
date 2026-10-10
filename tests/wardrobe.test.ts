// Wardrobe (1.4): library of skins on this PC, history of worn skins, wearing skins and capes through Minecraft's services.
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, test, vi } from 'vitest'

let root = ''
let slimBitmap = false
vi.mock('electron', () => ({
  app: { getPath: () => root },
  nativeImage: {
    createFromBuffer: () => ({
      getSize: () => ({ width: 64, height: 64 }),
      // opaque everywhere, or the 4th column of the right arm empty (slim)
      toBitmap: () => {
        const b = Buffer.alloc(64 * 64 * 4, 255)
        if (slimBitmap) for (let y = 20; y < 32; y++) for (let x = 54; x < 56; x++) b[(y * 64 + x) * 4 + 3] = 0
        return b
      },
    }),
  },
}))
const MS = 'a'.repeat(32)
const accounts = { accounts: [{ id: MS, name: 'Kyo', kind: 'microsoft', status: 'ok' }, { id: 'b'.repeat(32), name: 'Test', kind: 'offline', status: 'ok' }], activeId: MS }
vi.mock('../src/main/core/auth/accounts', () => ({
  getAccountsState: () => accounts,
  getLaunchCredentials: async () => ({ name: 'Kyo', uuid: MS, accessToken: 'test-token', userType: 'msa' }),
}))

const png = (tag: number, w = 64, h = 64) => {
  const b = Buffer.alloc(40)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b)
  b.write('IHDR', 12, 'ascii')
  b.writeUInt32BE(w, 16)
  b.writeUInt32BE(h, 20)
  b[39] = tag // a different picture
  return b
}
const profile = (skin: string, slim: boolean) => ({
  properties: [{ name: 'textures', value: Buffer.from(JSON.stringify({ textures: { SKIN: { url: `http://textures.minecraft.net/texture/${skin}`, metadata: slim ? { model: 'slim' } : {} } } })).toString('base64') }],
})
const H1 = '1'.repeat(64)
const H2 = '2'.repeat(64)
const CAPE = '3'.repeat(64)

let wearing = H1
let wearingSlim = false
let status = 200
const calls: { url: string; method: string; auth?: string; body?: unknown }[] = []
vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
  calls.push({ url, method: init.method ?? 'GET', auth: (init.headers as Record<string, string> | undefined)?.Authorization, body: init.body })
  if (url.startsWith('https://sessionserver.mojang.com/session/minecraft/profile/')) return new Response(JSON.stringify(profile(wearing, wearingSlim)))
  if (url === 'https://api.mojang.com/users/profiles/minecraft/Notch') return new Response(JSON.stringify({ id: 'c'.repeat(32), name: 'Notch' }))
  if (url.startsWith('https://api.mojang.com/users/profiles/minecraft/')) return new Response('', { status: 404 })
  if (url === `https://textures.minecraft.net/texture/${H1}`) return new Response(png(1))
  if (url === `https://textures.minecraft.net/texture/${H2}`) return new Response(png(2))
  if (url === `https://textures.minecraft.net/texture/${CAPE}`) return new Response(png(3, 64, 32))
  if (url.startsWith('https://api.minecraftservices.com/minecraft/profile')) {
    if (status !== 200) return new Response('', { status })
    if (url.endsWith('/skins')) {
      wearing = H2 // the uploaded skin, as Mojang would serve it
      wearingSlim = (init.body as FormData).get('variant') === 'slim'
    }
    const capeActive = url.endsWith('/capes/active') && init.method === 'PUT'
    return new Response(JSON.stringify({ id: MS, name: 'Kyo', capes: [{ id: 'cafe-0001', state: capeActive ? 'ACTIVE' : 'INACTIVE', url: `http://textures.minecraft.net/texture/${CAPE}`, alias: 'Migrator' }] }))
  }
  return new Response('', { status: 404 })
})

const w = await import('../src/main/core/skins/wardrobe')
const skins = await import('../src/main/core/skins/skins')

const file = (name: string, b: Buffer) => {
  const p = join(root, name)
  writeFileSync(p, b)
  return p
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hemi-wardrobe-'))
  accounts.activeId = MS
  slimBitmap = false
  wearing = H1
  wearingSlim = false
  status = 200
  calls.length = 0
})

describe('wardrobe', () => {
  test('a PNG file: kept once, slim arms recognised, anything else refused', async () => {
    slimBitmap = true
    const r = await w.importFile(file('My Skin.png', png(7)))
    expect(r.ok && r.wardrobe.library).toMatchObject([{ name: 'My Skin', slim: true, source: 'file' }])
    const again = await w.importFile(file('copy.png', png(7)))
    expect(again.ok && again.wardrobe.library.length).toBe(1)
    expect(await w.importFile(file('big.png', png(8, 128, 128)))).toEqual({ ok: false, error: 'notSkin' })
    expect(await w.importFile(file('text.png', Buffer.from('hello')))).toEqual({ ok: false, error: 'notSkin' })
  })

  test('a player by name: their skin (from Mojang) in the library; unknown or invalid names', async () => {
    const r = await w.importPlayer('Notch')
    expect(r.ok && r.wardrobe.library).toMatchObject([{ name: 'Notch', source: 'player' }])
    expect(await w.importPlayer('Nobody_Here')).toEqual({ ok: false, error: 'noPlayer' })
    const before = calls.length
    expect(await w.importPlayer('../etc')).toEqual({ ok: false, error: 'noPlayer' })
    expect(calls.length).toBe(before) // nothing asked
  })

  test('rename, arms, delete (the picture goes when no history uses it)', async () => {
    const r = await w.importFile(file('a.png', png(9)))
    const hash = r.ok ? r.added! : ''
    const e = await w.editSkin(hash, { name: '  Knight  ', slim: true })
    expect(e.ok && e.wardrobe.library[0]).toMatchObject({ name: 'Knight', slim: true })
    const pic = join(root, 'skins', 'wardrobe', `${hash}.png`)
    expect(existsSync(pic)).toBe(true)
    const d = await w.removeSkin(hash)
    expect(d.ok && d.wardrobe.library.length).toBe(0)
    expect(existsSync(pic)).toBe(false)
    expect(await w.removeSkin('../../x')).toEqual({ ok: false, error: 'refused' })
  })

  test('history: each skin the account is seen wearing, newest first, no repeats', async () => {
    await skins.getSkin(MS, true)
    await skins.getSkin(MS, true)
    let ward = await w.getWardrobe(false)
    expect(ward.history.length).toBe(1)
    wearing = H2
    await skins.getSkin(MS, true)
    ward = await w.getWardrobe(false)
    expect(ward.history.length).toBe(2)
    expect(ward.history[0].skin).not.toBe(ward.history[1].skin)
  })

  test('wear: uploaded with the account session and the arms chosen; the new skin is shown and in the history', async () => {
    const r = await w.importFile(file('b.png', png(2)))
    const hash = r.ok ? r.added! : ''
    const worn = await w.wearSkin(hash, true)
    expect(worn.ok).toBe(true)
    const upload = calls.find((c) => c.url.endsWith('/minecraft/profile/skins'))!
    expect(upload).toMatchObject({ method: 'POST', auth: 'Bearer test-token' })
    expect((upload.body as FormData).get('variant')).toBe('slim')
    expect(await skins.getSkin(MS)).toMatchObject({ slim: true, fallback: false })
    expect(worn.ok && worn.wardrobe.history[0].hash).toBe(hash) // same picture: png(2) is what Mojang serves for H2
  })

  test('wear: refused cleanly (too many changes, expired session, offline account, unknown skin)', async () => {
    const r = await w.importFile(file('c.png', png(4)))
    const hash = r.ok ? r.added! : ''
    status = 429
    expect(await w.wearSkin(hash, false)).toEqual({ ok: false, error: 'tooMany' })
    status = 401
    expect(await w.wearSkin(hash, false)).toEqual({ ok: false, error: 'signedOut' })
    status = 200
    expect(await w.wearSkin('f'.repeat(64), false)).toEqual({ ok: false, error: 'refused' })
    accounts.activeId = 'b'.repeat(32)
    expect(await w.wearSkin(hash, false)).toEqual({ ok: false, error: 'signedOut' })
    expect((await w.getWardrobe()).canChange).toBe(false)
  })

  test('capes: the ones owned, shown or hidden', async () => {
    const ward = await w.getWardrobe()
    expect(ward.capes).toMatchObject([{ id: 'cafe-0001', name: 'Migrator', active: false }])
    const on = await w.wearCape('cafe-0001')
    expect(on.ok && on.wardrobe.capes).toMatchObject([{ active: true }])
    expect(calls.some((c) => c.url.endsWith('/capes/active') && c.method === 'PUT')).toBe(true)
    await w.wearCape(null)
    expect(calls.some((c) => c.url.endsWith('/capes/active') && c.method === 'DELETE')).toBe(true)
    expect(await w.wearCape('../x')).toEqual({ ok: false, error: 'refused' })
  })

  test('slim detection on a decoded picture', () => {
    const opaque = Buffer.alloc(64 * 64 * 4, 255)
    expect(w.looksSlim(opaque, 64, 64)).toBe(false)
    expect(w.looksSlim(opaque, 64, 32)).toBe(false)
  })
})
