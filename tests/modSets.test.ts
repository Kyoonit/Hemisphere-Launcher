// Phase 21: mod sets (save, switch without losing anything, share code) and the mod history.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, test, vi } from 'vitest'

let root = ''
vi.mock('electron', () => ({ app: { getPath: () => root, getVersion: () => '1.0.0' }, shell: { trashItem: async () => {} } }))
vi.mock('../src/main/core/game/target', () => ({ gamePaths: () => ({ root, instance: join(root, 'instance') }) }))

const sets = await import('../src/main/core/backup/modSets')
const history = await import('../src/main/core/modrinth/history')

const inst = (...p: string[]) => join(root, 'instance', ...p)
const put = (rel: string, data: string) => {
  mkdirSync(join(inst(rel), '..'), { recursive: true })
  writeFileSync(inst(rel), data)
}
const on = () => readdirSync(inst('mods')).sort()
const off = () => (existsSync(inst('mods-disabled')) ? readdirSync(inst('mods-disabled')).sort() : [])
const manifest = { clientVersion: '1.0.2', minecraft: '26.3', mods: [{ id: 'iris', file: { path: 'mods/iris.jar' } }] } as never

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hemi-sets-'))
  put('.hemisphere/state.json', JSON.stringify({ version: 1, clientVersion: '1.0.2', minecraft: '26.3', choices: { iris: false }, owned: {}, seeded: {}, detached: [] }))
  put('mods/sodium-1.0.jar', 'S1')
  put('mods/jade-2.0.jar', 'J2')
})

describe('mod sets', () => {
  test('switching keeps every mod: others are switched off, other versions kept aside', async () => {
    const survival = (await sets.saveSet('Survival'))!
    expect(survival).toMatchObject({ name: 'Survival', mods: 2, enabled: 2 })

    // building: Litematica added, Sodium updated, Iris on
    put('mods/litematica-1.0.jar', 'L1')
    rmSync(inst('mods/sodium-1.0.jar'))
    put('mods/sodium-2.0.jar', 'S2')
    put('.hemisphere/state.json', JSON.stringify({ version: 1, clientVersion: '1.0.2', minecraft: '26.3', choices: { iris: true }, owned: {}, seeded: {}, detached: [] }))
    const building = (await sets.saveSet('Building'))!

    expect(await sets.switchSet(survival.id, manifest, 'My mods')).toMatchObject({ ok: true, missing: [] })
    expect(on()).toEqual(['jade-2.0.jar', 'sodium-1.0.jar'])
    expect(off()).toEqual(['litematica-1.0.jar']) // not in Survival: off, not deleted
    expect((await sets.listSets()).active).toBe(survival.id)

    expect(await sets.switchSet(building.id, manifest, 'My mods')).toMatchObject({ ok: true, missing: [] })
    expect(on()).toEqual(['jade-2.0.jar', 'litematica-1.0.jar', 'sodium-2.0.jar'])
    expect(off()).toEqual([])
  })

  test('changes made while a set is active are kept in it', async () => {
    const a = (await sets.saveSet('A'))!
    const b = (await sets.saveSet('B'))!
    put('mods/zoomify-1.0.jar', 'Z1') // added while B is active
    await sets.switchSet(a.id, manifest, 'My mods')
    expect(off()).toEqual(['zoomify-1.0.jar'])
    await sets.switchSet(b.id, manifest, 'My mods')
    expect(on()).toContain('zoomify-1.0.jar')
  })

  test('the first switch saves the current mods as "My mods"', async () => {
    const a = (await sets.saveSet('A'))!
    // no active set any more (as after deleting it)
    writeFileSync(inst('.hemisphere/mod-sets/active.json'), JSON.stringify({ id: null }))
    put('mods/extra-1.0.jar', 'E1')
    expect(await sets.switchSet(a.id, manifest, 'My mods')).toMatchObject({ ok: true, savedAs: 'My mods' })
    expect((await sets.listSets()).sets.map((s) => s.name)).toEqual(['A', 'My mods'])
  })

  test('names are unique, rename and delete', async () => {
    const a = (await sets.saveSet('Events'))!
    expect((await sets.saveSet('events'))!.name).toBe('events (2)')
    expect(await sets.renameSet(a.id, '  Light  ')).toBe(true)
    expect(await sets.deleteSet(a.id)).toBe(true)
    expect((await sets.listSets()).sets.map((s) => s.name)).toEqual(['events (2)'])
    expect(await sets.saveSet('   ')).toBeNull()
  })

  test('share code: only Modrinth mods, and only valid codes are read', async () => {
    put(
      '.hemisphere/player-mods.json',
      JSON.stringify({ 'sodium-1.0.jar': { file: 'sodium-1.0.jar', size: 2, mtimeMs: 0, sha512: 'x', lookedUp: true, projectId: 'AANobbMI', versionId: 'abcdEFGH', versionNumber: '1.0', title: 'Sodium', icon: '', update: null, incompatibleWith: null } }),
    )
    const s = (await sets.saveSet('Mine'))!
    const r = await sets.shareSet(s.id, '26.3')
    if (!r.ok) throw new Error(r.reason)
    expect(r.code.startsWith('HSET1-')).toBe(true)
    expect(r.left).toEqual(['jade-2.0'])
    expect(sets.decodeSetCode(r.code)).toMatchObject({ n: 'Mine', mc: '26.3', m: [['AANobbMI', 'abcdEFGH', 1]], c: { iris: false } })
    expect(sets.decodeSetCode('HSET1-garbage')).toBeNull()
    expect(sets.decodeSetCode('hello')).toBeNull()
  })
})

describe('mod history', () => {
  test('newest first, the last 200', async () => {
    await history.record({ kind: 'install', name: 'Jade', projectId: 'nvQzSEkH', to: '2.0', toVersionId: 'aaaaaaaa' })
    await history.record({ kind: 'version', name: 'Jade', projectId: 'nvQzSEkH', from: '2.0', to: '1.0' })
    const list = history.readHistory()
    expect(list.map((e) => e.kind)).toEqual(['version', 'install'])
    expect(list[1]).toMatchObject({ from: null, toVersionId: 'aaaaaaaa' })
    for (let i = 0; i < 210; i++) await history.record({ kind: 'lock', name: `m${i}` })
    expect(history.readHistory()).toHaveLength(200)
  })
})

