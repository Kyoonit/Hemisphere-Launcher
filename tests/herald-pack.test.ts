import { describe, expect, it } from 'vitest'
import { createHash, generateKeyPairSync, randomBytes, verify } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { ClientManifestSchema, ContentIndexSchema, HERALD_TEST_CONTENT_BASE, isAllowedDownloadUrl, type ClientManifest } from '../src/shared/manifest'
import { HERALD_CONTENT_BASE } from '../src/shared/herald'
import { bumpKind, manifestBytesText, newerReleases, nextVersion, packChanges, packFileUrl, packReadiness, pickLoader, resolvePack, type DraftMod, type ModrinthGet, type MrProject, type MrVersion } from '../src/shared/heraldPack'
import { buildPack, buildRelease, checkOnModrinth, PackError, type PackJob, type PublishJob, type RunKey } from '../tools/herald/publisher'
import { fromB64, seal, toB64, unseal, type SealedDocument } from '../src/shared/sealed'

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

describe('Herald mod pack: publishing (sealed)', () => {
  const next: ClientManifest = { ...online, clientVersion: '1.0.3', createdAt: '2026-10-09T12:00:00.000Z' }
  const oldIndex = { schema: 1, sequence: 3, updatedAt: '2026-10-08T00:00:00.000Z', latest: { clientVersion: '1.0.2', minecraft: '26.3', manifest: 'clients/1.0.2/manifest.json', sha512: sha(onlineBytes), size: onlineBytes.length }, previous: null, previousCanJoin: true }
  const oldText = JSON.stringify(oldIndex, null, 2) + '\n'
  const oldSig = 'c2lnbmF0dXJlIG9mIHRoZSBvbGQgaW5kZXg='
  const key = (kind: string): RunKey => ({ id: `${kind}-${randomBytes(12).toString('hex')}`, key: toB64(randomBytes(32)) })
  const pack = (extra: Partial<PackJob> = {}): PackJob => ({ proposalId: 'k-aaaaaaaaaa', manifest: next, basedOn: { sequence: 3, clientVersion: '1.0.2', sha512: sha(onlineBytes) }, previousCanJoin: true, ...extra })
  const job = (extra: Partial<PublishJob>): PublishJob => ({ id: 'j', sequence: 9, schema: 2, feed: {}, ...extra })
  type Files = Record<string, Buffer>
  const reader = (files: Files) => (p: string) => files[p] ?? null
  // The repository before Herald seals it: the pack in clear
  const clear: Files = { 'content/index.json': Buffer.from(oldText), 'content/index.json.sig': Buffer.from(oldSig + '\n'), 'content/clients/1.0.2/manifest.json': onlineBytes }
  const now = new Date('2026-10-09T12:00:00Z')
  const open = async (file: Buffer, k: RunKey) => JSON.parse(new TextDecoder().decode(await unseal(new Uint8Array(file), fromB64(k.key)))) as SealedDocument
  const apply = (files: Files, writes: { path: string; bytes: Buffer }[]) => ({ ...Object.fromEntries(Object.entries(files).filter(([p]) => p.endsWith('.bin'))), ...Object.fromEntries(writes.map((w) => [w.path, w.bytes])) })

  it('seals the pack in clear as it is (same signed bytes), once', async () => {
    const k = key('pack')
    const out = await buildPack(job({ seal: { feed: key('feed'), pack: { current: null, next: k } } }), 'content', privateKey, reader(clear), now)
    expect(out.packSealed).toBe(true)
    expect(out.writes.every((w) => w.path.endsWith('.bin'))).toBe(true)
    const index = out.writes.find((w) => w.path === 'content/index.bin')!
    for (const word of ['1.0.2', 'Sodium', 'clientVersion']) expect(out.writes.some((w) => w.bytes.includes(word))).toBe(false)
    const doc = await open(index.bytes, k)
    expect(doc.doc).toBe(oldText)
    expect(doc.sig).toBe(oldSig)
    const m = doc.files!['clients/1.0.2/manifest.json']
    const sealedManifest = apply(clear, out.writes)[`content/${m.path}`]
    expect(Buffer.from(await unseal(new Uint8Array(sealedManifest), fromB64(m.key))).equals(onlineBytes)).toBe(true)
    // Already sealed: nothing more
    expect((await buildPack(job({ seal: { feed: key('feed'), pack: { current: k, next: key('pack') } } }), 'content', privateKey, reader(apply(clear, out.writes)), now)).writes).toEqual([])
  })

  it('an approved change: new sealed manifest and index, signed, after the pack it replaces (kept as previous)', async () => {
    const k1 = key('pack')
    const sealedRepo = apply(clear, (await buildPack(job({ seal: { feed: key('feed'), pack: { current: null, next: k1 } } }), 'content', privateKey, reader(clear), now)).writes)
    const k2 = key('pack')
    const out = await buildPack(job({ pack: pack(), seal: { feed: key('feed'), pack: { current: k1, next: k2 } } }), 'content', privateKey, reader(sealedRepo), now)
    expect(out.packSealed).toBe(true)
    for (const word of ['1.0.3', 'Sodium', 'sequence']) expect(out.writes.some((w) => w.bytes.includes(word))).toBe(false)
    const doc = await open(out.writes.find((w) => w.path === 'content/index.bin')!.bytes, k2)
    expect(verify(null, Buffer.from(doc.doc), publicKey, Buffer.from(doc.sig, 'base64'))).toBe(true)
    const index = ContentIndexSchema.parse(JSON.parse(doc.doc))
    expect(index.sequence).toBe(4)
    expect(index.latest.clientVersion).toBe('1.0.3')
    expect(index.previous?.clientVersion).toBe('1.0.2')
    const repo2 = apply(sealedRepo, out.writes)
    for (const ref of [index.latest, index.previous!]) {
      const f = doc.files![ref.manifest]
      const plain = Buffer.from(await unseal(new Uint8Array(repo2[`content/${f.path}`]), fromB64(f.key)))
      expect(sha(plain)).toBe(ref.sha512)
    }
    // published by an earlier job: nothing again
    expect((await buildPack(job({ pack: pack(), seal: { feed: key('feed'), pack: { current: k2, next: key('pack') } } }), 'content', privateKey, reader(repo2), now)).writes).toEqual([])
  })

  it('refused when the online pack changed, or the version exists, or without the key to read the sealed index', async () => {
    const k1 = key('pack')
    const sealedRepo = apply(clear, (await buildPack(job({ seal: { feed: key('feed'), pack: { current: null, next: k1 } } }), 'content', privateKey, reader(clear), now)).writes)
    await expect(buildPack(job({ pack: pack({ basedOn: { sequence: 3, clientVersion: '1.0.2', sha512: H('0') } }), seal: { feed: key('feed'), pack: { current: k1, next: key('pack') } } }), 'content', privateKey, reader(sealedRepo), now)).rejects.toThrow(/changed meanwhile/)
    await expect(buildPack(job({ pack: pack({ manifest: { ...next, clientVersion: '1.0.2' } }), seal: { feed: key('feed'), pack: { current: k1, next: key('pack') } } }), 'content', privateKey, reader(sealedRepo), now)).rejects.toThrow(PackError)
    await expect(buildPack(job({ pack: pack(), seal: { feed: key('feed'), pack: { current: null, next: key('pack') } } }), 'content', privateKey, reader(sealedRepo), now)).rejects.toThrow(/no key was given/)
  })

  it('config files: only sealed, with the exact sealed bytes the manifest lists', async () => {
    const plain = Buffer.from('{"a":1}')
    const fileKey = randomBytes(32)
    const sealedFile = Buffer.from(await seal(new Uint8Array(plain), fileKey, 'f', 16 * 1024))
    const name = 'a'.repeat(32)
    const file = { path: 'config/a.json', url: `${HERALD_TEST_CONTENT_BASE}clients/files/${name}.bin`, sha512: sha(plain), size: plain.length, policy: 'default' as const, seal: { key: toB64(fileKey), sha512: sha(sealedFile), size: sealedFile.length } }
    const withFile = { ...next, files: [file] }
    const out = await buildPack(job({ pack: pack({ manifest: withFile, fileBytes: { [file.sha512]: sealedFile.toString('base64') } }), seal: { feed: key('feed'), pack: { current: null, next: key('pack') } } }), 'content', privateKey, reader({}), now)
    expect(out.writes.find((w) => w.path === `content/clients/files/${name}.bin`)?.bytes.equals(sealedFile)).toBe(true)
    await expect(buildPack(job({ pack: pack({ manifest: withFile, fileBytes: { [file.sha512]: plain.toString('base64') } }), seal: { feed: key('feed'), pack: { current: null, next: key('pack') } } }), 'content', privateKey, reader({}), now)).rejects.toThrow(/does not match/)
    const { seal: _s, ...unsealed } = file
    await expect(buildPack(job({ pack: pack({ manifest: { ...next, files: [{ ...unsealed, url: `${HERALD_TEST_CONTENT_BASE}clients/1.0.3/files/config/a.json` }] } }), seal: { feed: key('feed'), pack: { current: null, next: key('pack') } } }), 'content', privateKey, reader({}), now)).rejects.toThrow(/not sealed/)
  })

  it('goes out with the feed in the same commit', async () => {
    const feed = { news: [], maintenances: [], events: [], banners: [], welcome: [], backgrounds: [], vaults: [], vaultKeys: {}, restart: { rules: [{ from: '2026-01-01T00:00:00Z', time: '17:00', timeZone: 'Europe/Paris', durationMin: 5 }], exceptions: [] } }
    const { writes } = await buildRelease({ id: 'j', sequence: 9, schema: 2, feed, pack: pack(), seal: { feed: key('feed'), pack: { current: null, next: key('pack') } } }, 'content', privateKey, now, reader(clear))
    expect(writes.map((f) => f.path)).toContain('content/index.bin')
    expect(writes.map((f) => f.path)).toContain('content/v2/feed.bin')
    expect(writes.every((w) => w.path.endsWith('.bin'))).toBe(true)
  })
})
