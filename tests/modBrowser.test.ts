// Phase 18: staff mod policy, Modrinth version picking and validation, policy inside the signed feed.
import { describe, expect, test, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ModPolicySchema, policyFor, type ModPolicy } from '../src/shared/modBrowser'
import { FeedSchema } from '../src/shared/feed'

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0-test', getPath: () => '.' } }))
const { VersionSchema, pickVersion, primaryFile, safeIcon } = await import('../src/main/core/modrinth/api')

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
