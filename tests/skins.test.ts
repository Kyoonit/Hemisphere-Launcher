// Skins (1.4): asked to Mojang by UUID, textures from Mojang's texture server only, checked, kept for offline.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, test, vi } from 'vitest'

let root = ''
vi.mock('electron', () => ({ app: { getPath: () => root } }))
const accounts = { accounts: [{ id: 'a'.repeat(32), name: 'Kyo', kind: 'microsoft' }, { id: 'b'.repeat(32), name: 'Test', kind: 'offline' }], activeId: 'a'.repeat(32) }
vi.mock('../src/main/core/auth/accounts', () => ({ getAccountsState: () => accounts }))

const png = (w: number, h: number) => {
  const b = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b)
  b.write('IHDR', 12, 'ascii')
  b.writeUInt32BE(w, 16)
  b.writeUInt32BE(h, 20)
  return b
}
const SKIN = 'c'.repeat(64)
const CAPE = 'd'.repeat(64)
const STEVE = '31f477eb1a7beee631c2ca64d06f8f68fa93a3386d04452ab27f43acdf1b60cb'
const profile = (textures: object) => ({ properties: [{ name: 'textures', value: Buffer.from(JSON.stringify({ textures })).toString('base64') }] })

let online = true
let skinSize = [64, 64]
const asked: string[] = []
vi.stubGlobal('fetch', async (url: string) => {
  asked.push(url)
  if (!online) throw new Error('offline')
  if (url.startsWith('https://sessionserver.mojang.com/')) return new Response(JSON.stringify(profile({ SKIN: { url: `http://textures.minecraft.net/texture/${SKIN}`, metadata: { model: 'slim' } }, CAPE: { url: `http://textures.minecraft.net/texture/${CAPE}` } })))
  if (url === `https://textures.minecraft.net/texture/${SKIN}`) return new Response(png(skinSize[0], skinSize[1]))
  if (url === `https://textures.minecraft.net/texture/${CAPE}` || url === `https://textures.minecraft.net/texture/${STEVE}`) return new Response(png(64, url.endsWith(STEVE) ? 64 : 32))
  return new Response('', { status: 404 })
})

const skins = await import('../src/main/core/skins/skins')

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hemi-skins-'))
  online = true
  skinSize = [64, 64]
  asked.length = 0
})

describe('skins', () => {
  test('the active account: skin (slim) and cape from Mojang, over https, as checked PNGs', async () => {
    const s = (await skins.getSkin(undefined, true))!
    expect(s).toMatchObject({ id: 'a'.repeat(32), slim: true, fallback: false })
    expect(s.skin.startsWith('data:image/png;base64,')).toBe(true)
    expect(s.cape).not.toBeNull()
    expect(asked.every((u) => u.startsWith('https://'))).toBe(true)
  })

  test('kept: offline, the last known skin is shown (not Steve)', async () => {
    await skins.getSkin(undefined, true)
    online = false
    const s = (await skins.getSkin(undefined, true))!
    expect(s).toMatchObject({ slim: true, fallback: false })
  })

  test('an offline test account shows Steve; a texture that is not a skin is refused', async () => {
    expect(await skins.getSkin('b'.repeat(32))).toMatchObject({ fallback: true, slim: false, cape: null })
    skinSize = [128, 128]
    expect(await skins.getSkin(undefined, true)).toMatchObject({ fallback: true }) // Steve, not the bad texture
  })

  test('PNG checks', () => {
    expect(skins.isSkinPng(png(64, 64))).toBe(true)
    expect(skins.isSkinPng(png(64, 32))).toBe(true)
    expect(skins.isSkinPng(png(32, 32))).toBe(false)
    expect(skins.isSkinPng(Buffer.from('not a png'))).toBe(false)
    expect(skins.isCapePng(png(64, 32))).toBe(true)
    expect(skins.isCapePng(png(4096, 2048))).toBe(false)
  })
})
