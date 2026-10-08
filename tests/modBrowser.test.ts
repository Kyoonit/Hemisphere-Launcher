// Phase 18: staff mod policy, Modrinth version picking and validation, policy inside the signed feed.
import { describe, expect, test, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ModPolicySchema, policyFor, type ModPolicy } from '../src/shared/modBrowser'
import { FeedSchema } from '../src/shared/feed'

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0-test', getPath: () => '.' }, shell: { trashItem: async () => {} } }))
const { VersionSchema, pickVersion, primaryFile, safeIcon, updateTarget } = await import('../src/main/core/modrinth/api')
const { modKey, isDuplicate, hemisphereMods } = await import('../src/main/core/modrinth/playerMods')

const policy: ModPolicy = {
  rules: [
    { project: 'HbXXzLHU', name: 'X to Xray', verdict: 'blocked', reason: { en: 'cheat' } },
    { project: 'XeEZ3fK2', name: 'Freecam', verdict: 'askStaff', reason: { en: 'ask' } },
  ],
}

describe('mod policy', () => {
  test('blocked, ask staff, and everything else allowed', () => {
    expect(policyFor(policy, 'HbXXzLHU').verdict).toBe('blocked')
    expect(policyFor(policy, 'XeEZ3fK2')).toEqual({ verdict: 'askStaff', reason: { en: 'ask' } })
    expect(policyFor(policy, 'AANobbMI').verdict).toBe('allowed')
    expect(policyFor(policy, null).verdict).toBe('allowed') // mods added by hand (not on Modrinth)
    expect(policyFor(undefined, 'HbXXzLHU').verdict).toBe('allowed') // older feed without a policy
  })
  test('rejects ids that are not Modrinth project ids', () => {
    expect(ModPolicySchema.safeParse({ rules: [{ project: '../../x', name: 'x', verdict: 'blocked', reason: { en: 'x' } }] }).success).toBe(false)
  })
  test('the published staff policy is valid and blocks x-ray', () => {
    const src = JSON.parse(readFileSync(join(__dirname, '../content-src/feed.json'), 'utf8'))
    const parsed = ModPolicySchema.parse(src.modPolicy)
    expect(policyFor(parsed, 'HbXXzLHU').verdict).toBe('blocked')
  })
  test('the feed stays valid with and without a policy', () => {
    const base = { schema: 1, sequence: 1, updatedAt: new Date().toISOString(), maintenance: { active: false, message: { en: 'Back soon' } }, restart: null, news: [] }
    expect(FeedSchema.safeParse(base).success).toBe(true)
    expect(FeedSchema.safeParse({ ...base, modPolicy: policy }).success).toBe(true)
  })
})

const sha = 'a'.repeat(128)
const version = (id: string, type: 'release' | 'beta' | 'alpha', date: string, file = 'mod-1.0.jar') => ({
  id,
  project_id: 'AANobbMI',
  name: id,
  version_number: id,
  version_type: type,
  date_published: date,
  game_versions: ['26.3'],
  loaders: ['fabric'],
  dependencies: [],
  files: [{ url: `https://cdn.modrinth.com/data/AANobbMI/versions/${id}/${file}`, filename: file, primary: true, size: 10, hashes: { sha512: sha } }],
})

describe('Modrinth versions', () => {
  test('newest release first; betas only when there is no release', () => {
    const v = [version('aaaaaaa1', 'beta', '2026-10-05'), version('aaaaaaa2', 'release', '2026-09-01'), version('aaaaaaa3', 'release', '2026-09-20')].map((x) => VersionSchema.parse(x))
    expect(pickVersion(v)?.id).toBe('aaaaaaa3')
    expect(pickVersion([VersionSchema.parse(version('aaaaaaa1', 'beta', '2026-10-05'))])?.id).toBe('aaaaaaa1')
    expect(pickVersion([])).toBeNull()
  })
  test.each([
    ['a file name with a folder', { filename: '../evil.jar' }],
    ['a reserved Windows name', { filename: 'CON.jar' }],
    ['a download outside Modrinth', { url: 'https://evil.example/mod.jar' }],
    ['a fake checksum', { hashes: { sha512: 'nothex' } }],
  ])('refuses %s', (_name, patch) => {
    const v = version('aaaaaaa1', 'release', '2026-10-01')
    v.files[0] = { ...v.files[0], ...patch }
    expect(VersionSchema.safeParse(v).success).toBe(false)
  })
  test('primary file and icons from the Modrinth CDN only', () => {
    expect(primaryFile(VersionSchema.parse(version('aaaaaaa1', 'release', '2026-10-01'))).filename).toBe('mod-1.0.jar')
    expect(safeIcon('https://cdn.modrinth.com/data/AANobbMI/icon.png')).toBe('https://cdn.modrinth.com/data/AANobbMI/icon.png')
    expect(safeIcon('https://tracker.example/pixel.png')).toBe('')
    expect(safeIcon(null)).toBe('')
  })
})

describe('duplicates of Hemisphere mods', () => {
  const hemisphere = {
    projects: new Set(['YL57xq9U']),
    keys: new Set(['chatheads', 'irisshaders', 'iris', 'sodium', 'sodiumextra', 'modmenu', 'fabricapi'].map(modKey)),
  }
  test.each([
    ['Chat Heads', 'chatheads'],
    ['chat_heads-1.3.2.jar', 'chatheads'],
    ['chat-heads-fabric-1.3.2+26.3.jar', 'chatheads'],
    ['sodium-extra-fabric-0.9.4+mc26.3.jar', 'sodiumextra'],
    ['Iris Shaders', 'irisshaders'],
    ['3D Skin Layers', '3dskinlayers'],
    ['3dskinlayers-fabric-1.6.jar', '3dskinlayers'],
  ])('%s -> %s', (name, key) => expect(modKey(name)).toBe(key))
  test('same Modrinth project, same title or same file name = duplicate', () => {
    expect(isDuplicate({ file: 'whatever.jar', projectId: 'YL57xq9U', title: null }, hemisphere)).toBe(true)
    expect(isDuplicate({ file: 'chat_heads-1.3.2.jar', projectId: 'zzzzzzzz', title: 'Chat Heads (fork)' }, hemisphere)).toBe(true)
    expect(isDuplicate({ file: 'x.jar', projectId: null, title: 'Mod Menu' }, hemisphere)).toBe(true)
  })
  test('different mods with similar names are not duplicates', () => {
    expect(isDuplicate({ file: 'sodium-extra-0.9.4.jar', projectId: null, title: null }, { projects: new Set(), keys: new Set(['sodium']) })).toBe(false)
    expect(isDuplicate({ file: 'jade-26.3.5.jar', projectId: 'nvQzSEkH', title: 'Jade' }, hemisphere)).toBe(false)
    expect(isDuplicate({ file: 'x.jar', projectId: null, title: null }, null)).toBe(false)
  })
})

describe('taken-over Hemisphere mods', () => {
  const manifest = {
    mods: [
      { id: 'iris', name: 'Iris Shaders', file: { path: 'mods/iris-1.11.7.jar' }, source: { modrinth: { projectId: 'YL57xq9U', versionId: 'xxxxxxxx' } } },
      { id: 'sodium', name: 'Sodium', file: { path: 'mods/sodium-0.9.2.jar' }, source: { modrinth: { projectId: 'AANobbMI', versionId: 'yyyyyyyy' } } },
    ],
  } as never
  test('the player copy of a mod they took over is not a duplicate', () => {
    const copy = { file: 'iris-1.11.8.jar', projectId: 'YL57xq9U', title: 'Iris Shaders' }
    expect(isDuplicate(copy, hemisphereMods(manifest))).toBe(true)
    expect(isDuplicate(copy, hemisphereMods(manifest, new Set(['iris'])))).toBe(false)
    expect(isDuplicate({ file: 'sodium-0.9.3.jar', projectId: 'AANobbMI', title: 'Sodium' }, hemisphereMods(manifest, new Set(['iris'])))).toBe(true)
  })
})

describe('updates prefer stable releases', () => {
  const v = (id: string, type: 'release' | 'beta' | 'alpha', date: string) => VersionSchema.parse(version(id, type, date))
  const serve = (list: unknown[]) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(list), { status: 200 })))

  test('a newer alpha is not offered when a stable release exists (Sodium case)', async () => {
    const release = v('rel00001', 'release', '2026-09-01')
    const alpha = v('alp00001', 'alpha', '2026-10-01')
    serve([alpha, release].map((x) => ({ ...version(x.id, x.version_type, x.date_published) })))
    expect(await updateTarget('AANobbMI', 'rel00001', alpha, '26.3')).toBeNull()
  })
  test('a newer release is offered', async () => {
    const latest = v('rel00002', 'release', '2026-10-02')
    expect((await updateTarget('AANobbMI', 'rel00001', latest, '26.3'))?.id).toBe('rel00002')
  })
  test('from an alpha, the newer stable release is offered; never an older one', async () => {
    serve([version('alp00001', 'alpha', '2026-10-01'), version('rel00003', 'release', '2026-10-05'), version('rel00001', 'release', '2026-09-01')])
    expect((await updateTarget('AANobbMI', 'alp00001', v('alp00002', 'alpha', '2026-10-06'), '26.3'))?.id).toBe('rel00003')
    serve([version('alp00001', 'alpha', '2026-10-01'), version('rel00001', 'release', '2026-09-01')])
    expect(await updateTarget('AANobbMI', 'alp00001', v('alp00002', 'alpha', '2026-10-06'), '26.3')).toBeNull()
  })
})
