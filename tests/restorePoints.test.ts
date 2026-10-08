// Phase 20: restore points (take, preview, restore, keep 10) and the setup file (export, check, import).
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import { beforeEach, describe, expect, test, vi } from 'vitest'

let root = ''
vi.mock('electron', () => ({ app: { getPath: () => root, getVersion: () => '1.0.0' }, shell: { trashItem: async () => {} } }))
vi.mock('../src/main/core/game/target', () => ({ gamePaths: () => ({ root, instance: join(root, 'instance') }) }))
vi.mock('../src/main/core/settings/settings', () => ({ getSettings: () => ({ memoryMb: 4096, language: 'fr' }), updateSettings: vi.fn(async () => ({})) }))

const rp = await import('../src/main/core/backup/restorePoints')
const setup = await import('../src/main/core/backup/setup')

const inst = (...p: string[]) => join(root, 'instance', ...p)
const put = (rel: string, data: string) => {
  mkdirSync(join(inst(rel), '..'), { recursive: true })
  writeFileSync(inst(rel), data)
}
const read = (rel: string) => readFileSync(inst(rel), 'utf8')
const state = (choices: Record<string, boolean>) =>
  put('.hemisphere/state.json', JSON.stringify({ version: 1, clientVersion: '1.0.2', minecraft: '26.3', choices, owned: {}, seeded: {}, detached: [] }))
const manifest = { clientVersion: '1.0.2', minecraft: '26.3', mods: [{ id: 'sodium', file: { path: 'mods/sodium.jar' } }] } as never

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hemi-rp-'))
  state({ sodium: true })
  put('options.txt', 'key_jump=space')
  put('servers.dat', 'S1')
  put('config/sodium.json', '{"a":1}')
  put('mods/a-1.0.jar', 'A1')
  put('mods-disabled/b-1.0.jar', 'B1')
})

describe('restore points', () => {
  test('take, preview, restore, and undo the restore', async () => {
    const id = (await rp.createRestorePoint({ kind: 'manual' }))!
    expect(rp.isRestorePointId(id)).toBe(true)

    // the player changes things
    put('options.txt', 'key_jump=w')
    put('config/sodium.json', '{"a":2}')
    rmSync(inst('mods/a-1.0.jar'))
    put('mods/a-2.0.jar', 'A2')
    rmSync(inst('mods-disabled/b-1.0.jar'))
    put('mods/c-1.0.jar', 'C1')
    state({ sodium: false })

    const preview = (await rp.previewRestore(id))!
    expect(preview.changed).toEqual([{ name: 'a-1.0', from: 'a-2.0.jar', to: 'a-1.0.jar' }])
    expect(preview.back).toEqual(['b-1.0'])
    expect(preview.away).toEqual(['c-1.0'])
    expect(preview).toMatchObject({ options: true, servers: false, configs: 1, switched: 1 })

    const r = await rp.restorePoint(id, null)
    expect(r).toMatchObject({ ok: true, missing: [] })
    expect(read('options.txt')).toBe('key_jump=space')
    expect(read('config/sodium.json')).toBe('{"a":1}')
    expect(readdirSync(inst('mods')).sort()).toEqual(['a-1.0.jar'])
    expect(readdirSync(inst('mods-disabled'))).toEqual(['b-1.0.jar'])
    expect(JSON.parse(read('.hemisphere/state.json')).choices).toEqual({ sodium: true })

    // "Before restoring" keeps what was replaced
    const points = await rp.listRestorePoints()
    expect(points.map((p) => p.reason.kind)).toEqual(['restore', 'manual'])
    if (!r.ok) throw new Error()
    await rp.restorePoint(r.safetyPoint!, null)
    expect(read('options.txt')).toBe('key_jump=w')
    expect(readdirSync(inst('mods')).sort()).toEqual(['a-2.0.jar', 'c-1.0.jar'])
  })

  test('the newest 10 are kept, with only the jars they need', async () => {
    for (let i = 0; i < 12; i++) {
      put('mods/a-1.0.jar', `A${i}`)
      await rp.createRestorePoint({ kind: 'manual' })
    }
    const points = await rp.listRestorePoints()
    expect(points).toHaveLength(10)
    // b + one "a" per point
    expect(readdirSync(inst('.hemisphere/restore-points/jars'))).toHaveLength(11)
  })

  test('version changes in a row share the point taken before the first one', async () => {
    expect(await rp.createRestorePoint({ kind: 'version', mod: 'Sodium' })).not.toBeNull()
    expect(await rp.createRestorePoint({ kind: 'version', mod: 'Iris' })).toBeNull()
    expect(await rp.createRestorePoint({ kind: 'updateAll' })).not.toBeNull()
  })

  test('nothing to keep on a fresh install', async () => {
    rmSync(inst(), { recursive: true })
    expect(await rp.createRestorePoint({ kind: 'clientUpdate', from: '1.0.1', to: '1.0.2' })).toBeNull()
  })
})

describe('setup file', () => {
  test('export, check and import on another PC', async () => {
    const file = join(root, 'my.hemisphere')
    const out = await setup.exportSetup(file, '1.0.0', null)
    expect(out).toMatchObject({ ok: true, mods: 2, embedded: 2 })

    const parsed = (await setup.readSetup(file))!
    expect(setup.summarize(file, parsed, '26.3')).toMatchObject({ mods: 2, embedded: 2, configFiles: 1, options: true, servers: true, launcherSettings: true })

    // "another PC": empty instance
    rmSync(inst(), { recursive: true })
    const r = await setup.importSetup(parsed, manifest, null)
    expect(r).toMatchObject({ ok: true, installed: 2, skipped: [] })
    expect(read('options.txt')).toBe('key_jump=space')
    expect(read('mods/a-1.0.jar')).toBe('A1')
    expect(read('mods-disabled/b-1.0.jar')).toBe('B1')
    expect(JSON.parse(read('.hemisphere/state.json')).choices).toEqual({ sodium: true })
    expect(existsSync(inst('.hemisphere/incoming'))).toBe(false)
  })

  test('refuses files that are not setups or try to write elsewhere', async () => {
    const file = join(root, 'bad.hemisphere')
    writeFileSync(file, 'hello')
    expect(await setup.readSetup(file)).toBeNull()

    await setup.exportSetup(file, '1.0.0', null)
    const raw = gunzipSync(readFileSync(file))
    const len = raw.readUInt32LE(11)
    const header = JSON.parse(raw.subarray(15, 15 + len).toString())
    header.files[0].path = '../../evil.txt'
    const json = Buffer.from(JSON.stringify(header))
    const l = Buffer.alloc(4)
    l.writeUInt32LE(json.length)
    writeFileSync(file, gzipSync(Buffer.concat([raw.subarray(0, 11), l, json, raw.subarray(15 + len)])))
    expect(await setup.readSetup(file)).toBeNull()
  })
})

describe('mod differences', () => {
  const m = (file: string, sha: string, enabled = true, title: string | null = null) => ({ file, enabled, sha512: sha, size: 1, title, version: title ? sha : null })
  test('same mod in another version is a change, not a removal plus an addition', () => {
    const d = rp.diffMods([m('sodium-0.7.jar', 'x', true, 'Sodium'), m('iris.jar', 'i', false)], [m('sodium-0.6.jar', 'y', true, 'Sodium'), m('iris.jar', 'i', true)])
    expect(d).toEqual({ back: [], away: [], changed: [{ name: 'Sodium', from: 'x', to: 'y' }], switched: 1 })
  })
})
