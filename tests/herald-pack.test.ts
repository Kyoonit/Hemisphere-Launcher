import { describe, expect, it } from 'vitest'
import { createHash, generateKeyPairSync, verify } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { ClientManifestSchema, ContentIndexSchema, HERALD_TEST_CONTENT_BASE, isAllowedDownloadUrl, type ClientManifest } from '../src/shared/manifest'
import { HERALD_CONTENT_BASE } from '../src/shared/herald'
import { bumpKind, manifestBytesText, newerReleases, nextVersion, packChanges, packFileUrl, packReadiness, pickLoader, resolvePack, type DraftMod, type ModrinthGet, type MrProject, type MrVersion } from '../src/shared/heraldPack'
import { buildPack, buildRelease, checkOnModrinth, PackError, type PackJob } from '../tools/herald/publisher'

const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const online = ClientManifestSchema.parse(JSON.parse(readFileSync('content/clients/1.0.2/manifest.json', 'utf8')))
const onlineBytes = Buffer.from(manifestBytesText(online))
const sha = (b: Buffer) => createHash('sha512').update(b).digest('hex')
const H = (c: string) => c.repeat(128)

// ---------------------------------------------------------------- a fake Modrinth
const version = (id: string, project: string, extra: Partial<MrVersion> = {}): MrVersion => ({
  id,
  project_id: project,
  version_number: `${id}-1.0`,
  version_type: 'release',
  game_versions: ['26.3'],
  loaders: ['fabric'],
  files: [{ url: `https://cdn.modrinth.com/data/${project}/versions/${id}/${id}.jar`, filename: `${id}.jar`, primary: true, size: 1000, hashes: { sha512: H(id[0]) } }],
  dependencies: [],
  ...extra,
})
const VERSIONS: MrVersion[] = [
  version('aaa', 'PA', { dependencies: [{ project_id: 'PLIB', version_id: null, dependency_type: 'required' }] }),
  version('lll', 'PLIB'),
  version('bbb', 'PB', { dependencies: [{ project_id: 'PA', version_id: null, dependency_type: 'incompatible' }] }),
  version('old', 'PC', { game_versions: ['26.2'] }),
]
const PROJECTS: MrProject[] = [
  { id: 'PA', slug: 'mod-a', title: 'Mod A', description: 'A' },
  { id: 'PLIB', slug: 'lib', title: 'Lib', description: 'Library for A' },
  { id: 'PB', slug: 'mod-b', title: 'Mod B', description: 'B' },
  { id: 'PC', slug: 'mod-c', title: 'Mod C', description: 'C' },
]
const get: ModrinthGet = async <T,>(path: string): Promise<T> => {
  const ids = (q: string) => JSON.parse(decodeURIComponent(path.split(`${q}=`)[1].split('&')[0])) as string[]
  if (path.startsWith('/versions?')) return VERSIONS.filter((v) => ids('ids').includes(v.id)) as T
  if (path.startsWith('/projects?')) return PROJECTS.filter((p) => ids('ids').includes(p.id)) as T
  const m = path.match(/^\/project\/(\w+)\/version/)
  if (m) return VERSIONS.filter((v) => v.project_id === m[1] && v.game_versions.includes(ids('game_versions')[0])) as T
  throw new Error(`unexpected ${path}`)
}
const pick = (projectId: string, versionId: string): DraftMod => ({ projectId, versionId, category: 'comfort', recommended: false, defaultEnabled: true, description: { en: projectId } })

describe('Herald mod pack: Modrinth', () => {
  it('adds the libraries a mod needs, finds conflicts and versions for another Minecraft', async () => {
    const r = await resolvePack(get, '26.3', [pick('PA', 'aaa'), pick('PB', 'bbb'), pick('PC', 'old')])
    expect(r.added).toEqual(['lib'])
    expect(r.mods.find((m) => m.id === 'mod-a')!.requires).toEqual(['lib'])
    expect(r.mods.find((m) => m.id === 'lib')!.category).toBe('library')
    expect(r.problems.join(' ')).toMatch(/Mod B does not work with Mod A/)
    expect(r.problems.join(' ')).toMatch(/Mod C old-1.0 is not made for Minecraft 26.3/)
  })

  it('a library nothing needs any more is pointed out', async () => {
    const r = await resolvePack(get, '26.3', [{ ...pick('PLIB', 'lll'), category: 'library' }])
    expect(r.unused).toEqual(['lib'])
  })

  it('the publisher checks every mod against Modrinth', () => {
    const r = { ...online, mods: online.mods.slice(0, 1) }
    const m = r.mods[0]
    const good: MrVersion = { ...version(m.source!.modrinth.versionId, m.source!.modrinth.projectId), game_versions: [online.minecraft], files: [{ url: m.file.url, filename: 'x.jar', primary: true, size: m.file.size, hashes: { sha512: m.file.sha512 } }] }
    expect(() => checkOnModrinth(r, [good])).not.toThrow()
    expect(() => checkOnModrinth(r, [{ ...good, files: [{ ...good.files[0], size: 1 }] }])).toThrow(/not Modrinth's/)
    expect(() => checkOnModrinth(r, [])).toThrow(PackError)
  })
})

describe('Herald mod pack: a new Minecraft', () => {
  it('lists the releases newer than the pack (no snapshots), newest first', () => {
    const versions = [
      { id: '26.4-snapshot-3', type: 'snapshot', releaseTime: '2026-10-07T10:00:00+00:00' },
      { id: '26.3', type: 'release', releaseTime: '2026-09-15T11:23:02+00:00' },
      { id: '26.2', type: 'release', releaseTime: '2026-06-16T12:03:33+00:00' },
      { id: '26.4', type: 'release', releaseTime: '2026-12-01T10:00:00+00:00' },
    ]
    expect(newerReleases(versions, '26.2').map((v) => v.id)).toEqual(['26.4', '26.3'])
    expect(newerReleases(versions, '26.4')).toEqual([])
    expect(newerReleases(versions, '9.9')).toEqual([])
  })

  it("takes Fabric's newest stable loader; none when Fabric is not ready", () => {
    expect(pickLoader([{ version: '0.20.0-beta.1', stable: false }, { version: '0.19.6', stable: true }])).toBe('0.19.6')
    expect(pickLoader([])).toBeNull()
  })

  it('says which mods already have a build for the new Minecraft', async () => {
    const mods = [
      { id: 'mod-a', name: 'Mod A', category: 'comfort' as const, source: { modrinth: { projectId: 'PA', versionId: 'aaa' } } },
      { id: 'mod-c', name: 'Mod C', category: 'comfort' as const, source: { modrinth: { projectId: 'PC', versionId: 'old' } } },
    ]
    const r = await packReadiness(get, '26.3', mods)
    expect(r.map((m) => [m.id, m.status, m.versionId])).toEqual([['mod-a', 'release', 'aaa'], ['mod-c', 'none', null]])
  })
})

describe('Herald mod pack: changes and versions', () => {
  it('names what changes and proposes the version (patch, minor, major)', () => {
    const updated = { ...online, mods: online.mods.map((m) => (m.id === 'sodium' ? { ...m, version: 'new', file: { ...m.file, sha512: H('f') } } : m)) }
    const c = packChanges(online, updated)
    expect(c.updated.map((u) => u.mod.id)).toEqual(['sodium'])
    expect(bumpKind(c)).toBe('patch')
    const added = { ...online, mods: [...online.mods, { ...online.mods[1], id: 'newmod', category: 'comfort' as const, file: { ...online.mods[1].file, path: 'mods/new.jar' } }] }
    expect(bumpKind(packChanges(online, added))).toBe('minor')
    expect(bumpKind(packChanges(online, { ...online, minecraft: '26.4' }))).toBe('major')
    expect([nextVersion('1.0.2', 'patch'), nextVersion('1.0.2', 'minor'), nextVersion('1.0.2', 'major')]).toEqual(['1.0.3', '1.1.0', '2.0.0'])
    expect(packChanges(online, { ...online, mods: online.mods.filter((m) => m.id !== 'sodium') }).removed.map((m) => m.id)).toEqual(['sodium'])
  })

  it('config files may come from Herald content repositories, nowhere else', () => {
    expect(isAllowedDownloadUrl(packFileUrl(HERALD_CONTENT_BASE, '1.0.3', 'config/a.json'))).toBe(true)
    expect(isAllowedDownloadUrl(packFileUrl(HERALD_TEST_CONTENT_BASE, '1.0.3', 'config/a.json'))).toBe(true)
    expect(isAllowedDownloadUrl('https://raw.githubusercontent.com/Kyoonit/other/main/content/a.json')).toBe(false)
  })
})

describe('Herald mod pack: publishing', () => {
  const next: ClientManifest = { ...online, clientVersion: '1.0.3', createdAt: '2026-10-09T12:00:00.000Z' }
  const oldIndex = { schema: 1, sequence: 3, updatedAt: '2026-10-08T00:00:00.000Z', latest: { clientVersion: '1.0.2', minecraft: '26.3', manifest: 'clients/1.0.2/manifest.json', sha512: sha(onlineBytes), size: onlineBytes.length }, previous: null, previousCanJoin: true }
  const job = (extra: Partial<PackJob> = {}): PackJob => ({ proposalId: 'k-aaaaaaaaaa', manifest: next, basedOn: { sequence: 3, clientVersion: '1.0.2', sha512: sha(onlineBytes) }, previousCanJoin: true, ...extra })
  const repo = (files: Record<string, unknown>) => (p: string) => (p in files ? Buffer.from(typeof files[p] === 'string' ? (files[p] as string) : JSON.stringify(files[p])) : null)
  const now = new Date('2026-10-09T12:00:00Z')

  it('writes the manifest and a signed index the launcher accepts, after the pack it replaces', () => {
    const out = buildPack(job(), 'content', privateKey, repo({ 'content/index.json': oldIndex }), now)
    expect(out.map((f) => f.path)).toEqual(['content/clients/1.0.3/manifest.json', 'content/index.json', 'content/index.json.sig'])
    const index = ContentIndexSchema.parse(JSON.parse(out[1].bytes.toString('utf8')))
    expect(index.sequence).toBe(4)
    expect(index.latest).toMatchObject({ clientVersion: '1.0.3', sha512: sha(out[0].bytes), size: out[0].bytes.length })
    expect(index.previous?.clientVersion).toBe('1.0.2')
    expect(verify(null, out[1].bytes, publicKey, Buffer.from(out[2].bytes.toString('utf8').trim(), 'base64'))).toBe(true)
  })

  it('first pack in a repository: never a lower sequence than the pack it replaces', () => {
    const out = buildPack(job(), 'content', privateKey, repo({}), now)
    const index = ContentIndexSchema.parse(JSON.parse(out[1].bytes.toString('utf8')))
    expect(index.sequence).toBe(4)
    expect(index.previous).toBeNull()
  })

  it('nothing again when an earlier job published it; refused when the online pack changed or the version exists', () => {
    const published = buildPack(job(), 'content', privateKey, repo({ 'content/index.json': oldIndex }), now)
    const after = repo({ 'content/index.json': published[1].bytes.toString('utf8') })
    expect(buildPack(job(), 'content', privateKey, after, now)).toEqual([])
    expect(() => buildPack(job({ basedOn: { sequence: 3, clientVersion: '1.0.2', sha512: H('0') } }), 'content', privateKey, repo({ 'content/index.json': oldIndex }), now)).toThrow(/changed meanwhile/)
    expect(() => buildPack(job(), 'content', privateKey, repo({ 'content/index.json': oldIndex, 'content/clients/1.0.3/manifest.json': '{}' }), now)).toThrow(/already published/)
  })

  it('config files: only with the exact bytes the manifest lists', () => {
    const bytes = Buffer.from('{"a":1}')
    const file = { path: 'config/a.json', url: packFileUrl(HERALD_TEST_CONTENT_BASE, '1.0.3', 'config/a.json'), sha512: sha(bytes), size: bytes.length, policy: 'default' as const }
    const withFile = { ...next, files: [file] }
    const out = buildPack(job({ manifest: withFile, fileBytes: { [file.sha512]: bytes.toString('base64') } }), 'content', privateKey, repo({}), now)
    expect(out.find((f) => f.path === 'content/clients/1.0.3/files/config/a.json')?.bytes.equals(bytes)).toBe(true)
    expect(() => buildPack(job({ manifest: withFile, fileBytes: { [file.sha512]: Buffer.from('other').toString('base64') } }), 'content', privateKey, repo({}), now)).toThrow(/does not match/)
  })

  it('goes out with the feed in the same commit', () => {
    const feed = { news: [], maintenances: [], events: [], banners: [], welcome: [], backgrounds: [], vaults: [], vaultKeys: {}, restart: { rules: [{ from: '2026-01-01T00:00:00Z', time: '17:00', timeZone: 'Europe/Paris', durationMin: 5 }], exceptions: [] } }
    const out = buildRelease({ id: 'j', sequence: 9, schema: 2, feed, pack: job() }, 'content', privateKey, now, repo({ 'content/index.json': oldIndex }))
    expect(out.map((f) => f.path)).toContain('content/clients/1.0.3/manifest.json')
    expect(out.map((f) => f.path)).toContain('content/v2/feed.json')
  })
})
