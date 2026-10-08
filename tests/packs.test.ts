// Phase 22: resource packs and shaders (game settings written in place, packs read from .zip files).
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { beforeEach, describe, expect, test, vi } from 'vitest'

let root = ''
vi.mock('electron', () => ({ app: { getPath: () => root, getVersion: () => '1.0.0' }, shell: { trashItem: async () => {} }, nativeImage: {} }))
vi.mock('../src/main/core/game/target', () => ({ gamePaths: () => ({ root, instance: join(root, 'instance') }) }))

const gs = await import('../src/main/core/packs/gameSettings')
const { readZipEntry } = await import('../src/main/core/packs/zip')
const { plainText, packEntries } = await import('../src/main/core/packs/packs')

const inst = (...p: string[]) => join(root, 'instance', ...p)
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hemi-packs-'))
  mkdirSync(inst('config'), { recursive: true })
})

describe('resource packs in options.txt', () => {
  test('built-in packs keep their place; the player’s packs are replaced in order (last = top)', () => {
    const raw = ['vanilla', 'file/A.zip', 'file/B.zip', 'flat_shulker_icons']
    expect(gs.withResourcePacks(raw, ['C.zip', 'A.zip'])).toEqual(['vanilla', 'file/A.zip', 'file/C.zip', 'flat_shulker_icons'])
    expect(gs.withResourcePacks(['vanilla', 'fabric'], ['X.zip'])).toEqual(['vanilla', 'fabric', 'file/X.zip'])
    expect(gs.withResourcePacks([], ['X.zip'])).toEqual(['vanilla', 'file/X.zip'])
  })

  test('reads and writes options.txt in place (other settings untouched)', async () => {
    writeFileSync(
      inst('options.txt'),
      'version:4671\nfov:0.5\nresourcePacks:["vanilla","file/A.zip","file/Kyo\\u0027s.zip","fabric"]\nincompatibleResourcePacks:["file/A.zip","file/Old.zip"]\nlang:fr_fr\n',
    )
    expect(await gs.readResourcePacks()).toMatchObject({ active: ["Kyo's.zip", 'A.zip'], incompatible: ['A.zip', 'Old.zip'] })
    await gs.writeResourcePacks(['A.zip', 'New.zip'])
    const text = readFileSync(inst('options.txt'), 'utf8')
    expect(text).toContain('fov:0.5\n')
    expect(text).toContain('lang:fr_fr\n')
    expect(text).toContain('resourcePacks:["vanilla","file/New.zip","file/A.zip","fabric"]')
    expect(text).toContain('incompatibleResourcePacks:["file/A.zip"]')
  })

  test('no options.txt yet (fresh install): only the packs are written', async () => {
    await gs.writeResourcePacks(['A.zip'])
    expect(readFileSync(inst('options.txt'), 'utf8')).toBe('resourcePacks:["vanilla","file/A.zip"]\nincompatibleResourcePacks:[]\n')
  })
})

describe('shaders in Iris settings', () => {
  test('reads and writes iris.properties in place, with Java escapes', async () => {
    writeFileSync(inst('config/iris.properties'), '#Iris\nallowUnknownShaders=false\nenableShaders=true\nshaderPack=\n')
    expect(await gs.readShaders()).toEqual({ pack: '', on: false })
    await gs.writeShaders({ pack: 'Complementary Reimagined: r5.zip', on: true })
    const text = readFileSync(inst('config/iris.properties'), 'utf8')
    expect(text).toContain('allowUnknownShaders=false')
    expect(text).toContain('shaderPack=Complementary Reimagined\\: r5.zip')
    expect(await gs.readShaders()).toEqual({ pack: 'Complementary Reimagined: r5.zip', on: true })
    await gs.writeShaders({ pack: 'Complementary Reimagined: r5.zip', on: false })
    expect(await gs.readShaders()).toEqual({ pack: 'Complementary Reimagined: r5.zip', on: false })
  })
})

describe('reading a pack', () => {
  /** a minimal .zip with deflated entries */
  function zip(files: Record<string, string>): Buffer {
    const locals: Buffer[] = []
    const central: Buffer[] = []
    let offset = 0
    for (const [name, text] of Object.entries(files)) {
      const raw = Buffer.from(text)
      const data = deflateRawSync(raw)
      const n = Buffer.from(name)
      const lh = Buffer.alloc(30)
      lh.writeUInt32LE(0x04034b50, 0)
      lh.writeUInt16LE(8, 8)
      lh.writeUInt32LE(data.length, 18)
      lh.writeUInt32LE(raw.length, 22)
      lh.writeUInt16LE(n.length, 26)
      locals.push(lh, n, data)
      const ch = Buffer.alloc(46)
      ch.writeUInt32LE(0x02014b50, 0)
      ch.writeUInt16LE(8, 10)
      ch.writeUInt32LE(data.length, 20)
      ch.writeUInt32LE(raw.length, 24)
      ch.writeUInt16LE(n.length, 28)
      ch.writeUInt32LE(offset, 42)
      central.push(ch, n)
      offset += 30 + n.length + data.length
    }
    const cd = Buffer.concat(central)
    const end = Buffer.alloc(22)
    end.writeUInt32LE(0x06054b50, 0)
    end.writeUInt32LE(cd.length, 12)
    end.writeUInt32LE(offset, 16)
    return Buffer.concat([...locals, cd, end])
  }

  test('pack.mcmeta out of a .zip, and its description as plain text', async () => {
    mkdirSync(inst('resourcepacks'), { recursive: true })
    writeFileSync(inst('resourcepacks/Nice.zip'), zip({ 'assets/x.txt': 'x', 'pack.mcmeta': '{"pack":{"pack_format":70,"description":{"text":"§6Nice ","extra":[{"text":"pack"}]}}}' }))
    const meta = await readZipEntry(inst('resourcepacks/Nice.zip'), 'pack.mcmeta')
    expect(plainText(JSON.parse(meta!.toString()).pack.description)).toBe('Nice pack')
    expect(await readZipEntry(inst('resourcepacks/Nice.zip'), 'pack.png')).toBeNull()
    writeFileSync(inst('resourcepacks/broken.zip'), 'not a zip')
    expect(await readZipEntry(inst('resourcepacks/broken.zip'), 'pack.mcmeta')).toBeNull()
  })

  test('only packs are listed: .zip files and pack folders', () => {
    mkdirSync(inst('resourcepacks/Folder pack'), { recursive: true })
    writeFileSync(inst('resourcepacks/Folder pack/pack.mcmeta'), '{}')
    mkdirSync(inst('resourcepacks/not a pack'), { recursive: true })
    writeFileSync(inst('resourcepacks/A.zip'), 'x')
    writeFileSync(inst('resourcepacks/readme.txt'), 'x')
    mkdirSync(inst('shaderpacks/BSL/shaders'), { recursive: true })
    writeFileSync(inst('shaderpacks/BSL.zip.txt'), 'settings')
    expect(packEntries('resourcepack').map((e) => e.file).sort()).toEqual(['A.zip', 'Folder pack'])
    expect(packEntries('shader').map((e) => e.file)).toEqual(['BSL'])
  })
})
