// Herald phase S3: the launcher's schema 2 reader (signature, vaults sealed by the Herald server, commit addresses).
import { describe, expect, it, vi } from 'vitest'
import { createPublicKey, generateKeyPairSync, sign } from 'node:crypto'
import { sealVault, toB64 } from '../herald/server/src/crypto'
import { clockOffset, contentAtCommit } from '../src/shared/herald'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', isPackaged: true, getLocale: () => 'en' } }))
const { verifyFeedV2, openVaultFile } = await import('../src/main/core/remote/feedV2')

const { privateKey } = generateKeyPairSync('ed25519')
const pub = createPublicKey(privateKey)
const feed = {
  schema: 2,
  sequence: 4,
  updatedAt: '2026-10-09T10:00:00.000Z',
  news: [],
  maintenances: [],
  restart: null,
  events: [],
  banners: [],
  welcome: [],
  backgrounds: [],
  vaults: [],
  vaultKeys: {},
}

describe('schema 2 feed reader', () => {
  it('accepts a signed feed and refuses a tampered one', () => {
    const bytes = Buffer.from(JSON.stringify(feed))
    const sig = sign(null, bytes, privateKey).toString('base64')
    expect(verifyFeedV2(bytes, sig, pub).sequence).toBe(4)
    expect(() => verifyFeedV2(Buffer.from(JSON.stringify({ ...feed, sequence: 99 })), sig, pub)).toThrow(/signature/)
  })

  it('opens a vault sealed by the Herald server, and only with the right key and content', async () => {
    const item = { id: 'secret', date: '2026-10-20', category: 'event', title: { en: 'Secret' }, body: { en: 'Shh' }, showFrom: '2026-10-20T16:00:00Z' }
    const sealed = await sealVault(new TextEncoder().encode(JSON.stringify(item)))
    const vault = { id: 'v1', kind: 'news' as const, opensAt: '2026-10-20T16:00:00Z', file: { path: 'v2/vaults/v1.bin', sha512: sealed.sha512, size: sealed.file.length }, plainSha256: sealed.plainSha256 }
    const file = Buffer.from(sealed.file)
    expect(openVaultFile(file, toB64(sealed.key), vault)).toMatchObject({ id: 'secret', title: { en: 'Secret' } })
    expect(() => openVaultFile(file, toB64(new Uint8Array(32)), vault)).toThrow()
    expect(() => openVaultFile(file, toB64(sealed.key), { ...vault, plainSha256: '0'.repeat(64) })).toThrow(/does not match/)
    // a vault declared as another kind is refused by that kind's schema
    expect(() => openVaultFile(file, toB64(sealed.key), { ...vault, kind: 'maintenance' })).toThrow()
  })
})

describe('Herald helpers', () => {
  it('reads the content at one commit (no GitHub cache)', () => {
    const sha = 'ac1109ab7a532237859c1abcc304806e2b24618f'
    expect(contentAtCommit('https://raw.githubusercontent.com/Kyoonit/Hemisphere-Launcher/main/content/', sha)).toBe(`https://raw.githubusercontent.com/Kyoonit/Hemisphere-Launcher/${sha}/content/`)
    expect(contentAtCommit('https://raw.githubusercontent.com/Kyoonit/herald-test-content/main/content/', 'main')).toBeNull()
    expect(contentAtCommit('http://127.0.0.1:8099/', sha)).toBeNull()
    expect(contentAtCommit('https://evil.example/Kyoonit/x/main/content/', sha)).toBeNull()
  })
  it('estimates the server clock from one answer', () => {
    expect(clockOffset(10_500, 10_000, 10_200)).toBe(400)
    expect(clockOffset(9_600, 10_000, 10_000)).toBe(-400)
  })
})
