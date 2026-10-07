// Content security: path safety, download hosts, schema rules, signature + hash verification.
import { describe, expect, test, vi } from 'vitest'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ClientManifestSchema, isAllowedDownloadUrl, isSafeRelativePath, type ClientManifest } from '../src/shared/manifest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', isPackaged: true } }))
const { verifyContent } = await import('../src/main/core/remote/content')

describe('isSafeRelativePath', () => {
  test.each(['mods/sodium.jar', 'config/sodium-options.json', 'resourcepacks/Hemisphere Pack.zip', 'shaderpacks/a/b.txt'])('accepts %s', (p) =>
    expect(isSafeRelativePath(p)).toBe(true),
  )
  test.each([
    ['../evil.jar', 'parent dir'],
    ['mods/../../evil.jar', 'escape via ..'],
    ['/mods/a.jar', 'absolute'],
    ['C:/Windows/a.dll', 'drive letter'],
    ['mods\\a.jar', 'backslash'],
    ['saves/world/level.dat', 'folder not allowed'],
    ['options.txt', 'top-level file'],
    ['mods/con.jar', 'reserved Windows name'],
    ['mods/a.jar:stream', 'alternate data stream'],
    ['mods/', 'empty name'],
    ['mods/a.', 'trailing dot'],
  ])('rejects %s (%s)', (p) => expect(isSafeRelativePath(p)).toBe(false))
})

describe('isAllowedDownloadUrl', () => {
  test('allows Modrinth CDN and our content folder', () => {
    expect(isAllowedDownloadUrl('https://cdn.modrinth.com/data/AANobbMI/versions/x/sodium.jar')).toBe(true)
    expect(isAllowedDownloadUrl('https://raw.githubusercontent.com/Kyoonit/Hemisphere-Launcher/main/content/clients/1.0.0/files/config/a.json')).toBe(true)
  })
  test.each([
    'http://cdn.modrinth.com/a.jar', // not https
    'https://evil.com/a.jar',
    'https://cdn.modrinth.com.evil.com/a.jar',
    'https://raw.githubusercontent.com/someone-else/repo/main/content/a.jar', // other repo on the same host
    'https://user:pw@cdn.modrinth.com/a.jar',
    'https://cdn.modrinth.com:8443/a.jar',
    'file:///C:/a.jar',
  ])('rejects %s', (u) => expect(isAllowedDownloadUrl(u)).toBe(false))
})

const mod = (id: string, requires: string[] = [], path = `mods/${id}.jar`) => ({
  id,
  name: id,
  description: { en: id },
  category: 'performance' as const,
  recommended: true,
  defaultEnabled: true,
  requires,
  version: '1.0',
  file: { path, url: `https://cdn.modrinth.com/${id}.jar`, sha512: 'a'.repeat(128), size: 10 },
})
const manifest = (mods: ReturnType<typeof mod>[]): ClientManifest => ({
  schema: 1,
  clientVersion: '1.0.0',
  createdAt: new Date().toISOString(),
  minecraft: '26.3',
  loader: { type: 'fabric', version: '0.19.5' },
  mods,
  files: [],
})

describe('ClientManifestSchema', () => {
  test('accepts a valid manifest', () => expect(ClientManifestSchema.safeParse(manifest([mod('a'), mod('b', ['a'])])).success).toBe(true))
  test('rejects duplicate ids', () => expect(ClientManifestSchema.safeParse(manifest([mod('a'), mod('a', [], 'mods/x.jar')])).success).toBe(false))
  test('rejects duplicate paths (case-insensitive)', () =>
    expect(ClientManifestSchema.safeParse(manifest([mod('a', [], 'mods/A.jar'), mod('b', [], 'mods/a.jar')])).success).toBe(false))
  test('rejects unknown dependency', () => expect(ClientManifestSchema.safeParse(manifest([mod('a', ['missing'])])).success).toBe(false))
  test('rejects a mod outside mods/', () => expect(ClientManifestSchema.safeParse(manifest([mod('a', [], 'config/a.jar')])).success).toBe(false))
})

describe('verifyContent', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const manifestBytes = Buffer.from(JSON.stringify(manifest([mod('a')])))
  const index = (bytes: Buffer) =>
    Buffer.from(
      JSON.stringify({
        schema: 1,
        sequence: 1,
        updatedAt: new Date().toISOString(),
        latest: { clientVersion: '1.0.0', minecraft: '26.3', manifest: 'clients/1.0.0/manifest.json', sha512: createHash('sha512').update(bytes).digest('hex'), size: bytes.length },
        previous: null,
        previousCanJoin: false,
      }),
    )
  const indexBytes = index(manifestBytes)
  const sig = sign(null, indexBytes, privateKey).toString('base64')

  test('accepts correctly signed content', () => {
    expect(verifyContent(indexBytes, sig, manifestBytes, publicKey).manifest.mods[0].id).toBe('a')
  })
  test('rejects a modified index', () => {
    const tampered = Buffer.from(indexBytes.toString().replace('"previousCanJoin":false', '"previousCanJoin":true '))
    expect(() => verifyContent(tampered, sig, manifestBytes, publicKey)).toThrow(/signature/)
  })
  test('rejects a modified manifest', () => {
    const tampered = Buffer.from(manifestBytes.toString().replace('cdn.modrinth.com/a', 'cdn.modrinth.com/b'))
    expect(() => verifyContent(indexBytes, sig, tampered, publicKey)).toThrow(/mismatch/)
  })
  test('rejects content signed by another key', () => {
    const other = generateKeyPairSync('ed25519')
    expect(() => verifyContent(indexBytes, sign(null, indexBytes, other.privateKey).toString('base64'), manifestBytes, publicKey)).toThrow(/signature/)
  })
})

test('the published content/ folder verifies with the key built into the launcher', () => {
  const dir = join(__dirname, '..', 'content')
  const indexBytes = readFileSync(join(dir, 'index.json'))
  const { latest } = JSON.parse(indexBytes.toString())
  const { manifest } = verifyContent(indexBytes, readFileSync(join(dir, 'index.json.sig'), 'utf8'), readFileSync(join(dir, latest.manifest)))
  expect(manifest.mods.some((m) => m.id === 'sodium')).toBe(true)
})
