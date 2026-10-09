// Import from another launcher: mods and packs go into a new preset or replace the active one, packs one copy each.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ImportSource } from '../src/shared/importer'

let root = ''
vi.mock('electron', () => ({ app: { getPath: () => root, getVersion: () => '1.0.0' }, shell: { trashItem: async () => {} }, nativeImage: {} }))
vi.mock('../src/main/core/game/target', () => ({ gamePaths: () => ({ root, instance: join(root, 'instance') }) }))
// Modrinth knows two versions of Faithful (by file hash), nothing else
const sha = (s: string) => createHash('sha512').update(s).digest('hex')
const faithful: Record<string, string> = { [sha('faithful 26.3')]: 'v-263', [sha('faithful 1.21')]: 'v-121' }
vi.mock('../src/main/core/modrinth/api', async (original) => ({
  ...(await original<object>()),
  versionsByHash: async (hashes: string[]) => Object.fromEntries(hashes.filter((h) => faithful[h]).map((h) => [h, { id: faithful[h], project_id: 'faithful', version_number: faithful[h], name: 'Faithful' }])),
  getProjects: async () => new Map(),
}))

const sets = await import('../src/main/core/backup/modSets')
const { importFrom } = await import('../src/main/core/importer/importer')

const inst = (...p: string[]) => join(root, 'instance', ...p)
const put = (path: string, data: string) => {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, data)
}
const on = () => (existsSync(inst('mods')) ? readdirSync(inst('mods')).sort() : [])
const manifest = { clientVersion: '1.0.2', minecraft: '26.3', mods: [] } as never

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hemi-import-'))
  put(inst('.hemisphere/state.json'), JSON.stringify({ version: 1, clientVersion: '1.0.2', minecraft: '26.3', choices: { iris: false }, owned: {}, seeded: {}, detached: [] }))
  put(inst('mods/sodium-1.0.jar'), 'S1')
  put(inst('mods/jade-2.0.jar'), 'J2')
  put(inst('resourcepacks/Faithful-26.3.zip'), 'faithful 26.3')
  put(inst('options.txt'), 'fov:0.5\nresourcePacks:["vanilla","file/Faithful-26.3.zip"]\n')
})

describe('the preset an import goes into', () => {
  test('a new preset, named after the setup: the current one keeps its mods and packs', async () => {
    const survival = (await sets.saveSet('Survival'))!
    expect(await sets.presetForImport('new', 'Fabulously Optimized', 'My mods', manifest)).toEqual({ ok: true, name: 'Fabulously Optimized', created: true })
    expect(on()).toEqual([]) // the import starts from nothing: no duplicates of the mods already here
    expect(readFileSync(inst('options.txt'), 'utf8')).toContain('resourcePacks:["vanilla"]')
    put(inst('mods/lithium-1.0.jar'), 'L1') // what the import brings
    await sets.keepImportInPreset()
    const state = await sets.listSets()
    expect(state.sets.map((s) => s.name)).toEqual(['Survival', 'Fabulously Optimized'])
    expect(state.sets.find((s) => s.id === state.active)).toMatchObject({ name: 'Fabulously Optimized', mods: 1 })

    await sets.switchSet(survival.id, manifest, 'My mods')
    expect(on()).toEqual(['jade-2.0.jar', 'sodium-1.0.jar'])
    expect(readFileSync(inst('options.txt'), 'utf8')).toContain('resourcePacks:["vanilla","file/Faithful-26.3.zip"]')
  })

  test('the name is made unique; without an active preset the mods as they are become "My mods"', async () => {
    await sets.saveSet('Pack')
    writeFileSync(inst('.hemisphere/mod-sets/active.json'), JSON.stringify({ id: null }))
    expect(await sets.presetForImport('new', 'Pack', 'My mods', manifest)).toMatchObject({ ok: true, name: 'Pack (2)' })
    expect((await sets.listSets()).sets.map((s) => s.name)).toEqual(['Pack', 'My mods', 'Pack (2)'])
  })

  test('replacing the active preset: same preset, emptied, nothing added to the list', async () => {
    const survival = (await sets.saveSet('Survival'))!
    expect(await sets.presetForImport('replace', 'ignored', 'My mods', manifest)).toEqual({ ok: true, name: 'Survival', created: false })
    expect(on()).toEqual([])
    put(inst('mods/lithium-1.0.jar'), 'L1')
    await sets.keepImportInPreset()
    const state = await sets.listSets()
    expect(state.sets).toHaveLength(1)
    expect(state.active).toBe(survival.id)
    expect(state.sets[0]).toMatchObject({ name: 'Survival', mods: 1 })
  })

  test('no room for a new preset: refused, replacing still works', async () => {
    for (let i = 0; i < 20; i++) await sets.saveSet(`P${i}`)
    expect(await sets.presetForImport('new', 'One more', 'My mods', manifest)).toEqual({ ok: false, reason: 'tooManyPresets' })
    expect(on()).toEqual(['jade-2.0.jar', 'sodium-1.0.jar']) // untouched
    expect(await sets.presetForImport('replace', '', 'My mods', manifest)).toMatchObject({ ok: true, created: false })
  })
})

describe('packs from another launcher', () => {
  const src = (...p: string[]) => join(root, 'other', ...p)
  const source = (): ImportSource => ({ id: src(), launcher: 'folder', name: 'other', path: src(), minecraft: null, has: { settings: true, servers: false, resourcepacks: 2, shaderpacks: 1, config: true, mods: 0 } })
  const none = { settings: false, servers: false, resourcepacks: false, shaderpacks: false, config: false, mods: false }

  beforeEach(() => {
    put(src('resourcepacks/Faithful-1.21.zip'), 'faithful 1.21') // another version of a pack already here
    put(src('resourcepacks/Custom.zip'), 'my own pack')
    put(src('resourcepacks/notes.txt'), 'not a pack')
    put(src('shaderpacks/BSL.zip'), 'bsl')
    put(src('options.txt'), 'fov:0.9\nresourcePacks:["vanilla","file/Custom.zip","file/Faithful-1.21.zip"]\n')
    put(src('config/iris.properties'), 'shaderPack=BSL.zip\nenableShaders=true\n')
  })

  test('one copy each (same Modrinth project = the one already here), switched on as in the other launcher', async () => {
    const report = await importFrom(source(), { ...none, resourcepacks: true, shaderpacks: true }, manifest, () => {})
    expect(report.resourcepacks).toBe(1)
    expect(report.shaderpacks).toBe(1)
    expect(readdirSync(inst('resourcepacks')).sort()).toEqual(['Custom.zip', 'Faithful-26.3.zip'])
    // top first: Faithful (the copy already here) above Custom, as in the other launcher
    expect(readFileSync(inst('options.txt'), 'utf8')).toContain('resourcePacks:["vanilla","file/Custom.zip","file/Faithful-26.3.zip"]')
    expect(readFileSync(inst('options.txt'), 'utf8')).toContain('fov:0.5') // settings not imported: kept
    expect(readFileSync(inst('config/iris.properties'), 'utf8')).toMatch(/shaderPack=BSL\.zip[\s\S]*enableShaders=true/)

    // again: nothing more
    expect((await importFrom(source(), { ...none, resourcepacks: true, shaderpacks: true }, manifest, () => {})).resourcepacks).toBe(0)
    expect(readdirSync(inst('resourcepacks'))).toHaveLength(2)
  })

  test('settings without packs: the packs on stay the ones here, not the other launcher’s', async () => {
    await importFrom(source(), { ...none, settings: true }, manifest, () => {})
    const options = readFileSync(inst('options.txt'), 'utf8')
    expect(options).toContain('fov:0.9')
    expect(options).toContain('resourcePacks:["vanilla","file/Faithful-26.3.zip"]')
  })
})

describe('settings imported into a new preset', () => {
  test('stay with that preset: the previous one gets its keybinds and server list back', async () => {
    put(inst('servers.dat'), 'hemisphere')
    const survival = (await sets.saveSet('Survival'))!
    put(join(root, 'other', 'options.txt'), 'key_key.jump:key.keyboard.j\n')
    put(join(root, 'other', 'servers.dat'), 'other servers')
    const source: ImportSource = { id: join(root, 'other'), launcher: 'folder', name: 'other', path: join(root, 'other'), minecraft: null, has: { settings: true, servers: true, resourcepacks: 0, shaderpacks: 0, config: false, mods: 1 } }
    await sets.presetForImport('new', 'Other', 'My mods', manifest)
    await importFrom(source, { settings: true, servers: true, resourcepacks: false, shaderpacks: false, config: false, mods: false }, manifest, () => {})
    await sets.keepImportInPreset()
    expect(readFileSync(inst('servers.dat'), 'utf8')).toBe('other servers')

    await sets.switchSet(survival.id, manifest, 'My mods')
    expect(readFileSync(inst('servers.dat'), 'utf8')).toBe('hemisphere')
    expect(readFileSync(inst('options.txt'), 'utf8')).toContain('fov:0.5')
    expect(readFileSync(inst('options.txt'), 'utf8')).not.toContain('key.keyboard.j')
  })
})
