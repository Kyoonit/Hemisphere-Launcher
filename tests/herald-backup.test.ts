import { describe, expect, it } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
// @ts-expect-error plain JavaScript (it runs in the backups repository with Node only)
import { decryptBackup, encryptBackup, keep } from '../herald/backup/herald-backup.mjs'

const pair = () => generateKeyPairSync('rsa', { modulusLength: 2048 })
const pub = (k: ReturnType<typeof pair>) => (k.publicKey.export({ type: 'spki', format: 'der' }) as Buffer).toString('base64')

describe('backup encryption', () => {
  const owner = pair()
  const sql = Buffer.from('PRAGMA defer_foreign_keys=TRUE;\nCREATE TABLE profiles (id TEXT);\n' + "INSERT INTO profiles VALUES('p-1');\n".repeat(500))

  it('only the owner’s private key opens it, and it comes back whole', () => {
    const file: Buffer = encryptBackup(sql, pub(owner))
    expect(file.subarray(0, 8).toString()).toBe('HERALDBK')
    // compressed, and nothing readable inside
    expect(file.length).toBeLessThan(sql.length / 4)
    expect(file.includes(Buffer.from('profiles'))).toBe(false)
    expect(decryptBackup(file, owner.privateKey).equals(sql)).toBe(true)
    // two backups of the same data never look the same
    expect(encryptBackup(sql, pub(owner)).equals(file)).toBe(false)
  })

  it('refuses another key, a changed file, or something else', () => {
    const file: Buffer = encryptBackup(sql, pub(owner))
    expect(() => decryptBackup(file, pair().privateKey)).toThrow()
    const changed = Buffer.from(file)
    changed[changed.length - 40] ^= 1
    expect(() => decryptBackup(changed, owner.privateKey)).toThrow()
    expect(() => decryptBackup(Buffer.from('PK\u0003\u0004 a zip'), owner.privateKey)).toThrow('not a Herald backup')
  })
})

describe('what is kept', () => {
  const now = Date.UTC(2026, 9, 10, 3, 20)
  const day = (d: Date) => d.toISOString().slice(0, 10)
  const tags: string[] = []
  // one backup a night for 400 days, two on the last night (a manual run)
  for (let i = 0; i < 400; i++) tags.push(`backup-${day(new Date(now - i * 86_400_000))}-0317`)
  tags.push('backup-2026-10-10-0102', 'v1.0.0')

  it('keeps the newest of each of the last 30 days and one a month for a year', () => {
    const kept: string[] = keep(tags, now)
    const daily = kept.filter((t) => t >= 'backup-2026-09-11')
    expect(daily).toHaveLength(30)
    // tonight: the later run of the two
    expect(kept).toContain('backup-2026-10-10-0317')
    expect(kept).not.toContain('backup-2026-10-10-0102')
    // the first of each older month, nothing older than a year
    expect(kept).toContain('backup-2026-09-01-0317')
    expect(kept).toContain('backup-2025-11-01-0317')
    expect(kept).not.toContain('backup-2025-09-15-0317')
    expect(kept.length).toBeLessThanOrEqual(30 + 12)
    // not a backup: never touched
    expect(kept).not.toContain('v1.0.0')
  })

  it('never removes the only backup, however old', () => {
    expect(keep(['backup-2020-01-01-0317'], now)).toEqual(['backup-2020-01-01-0317'])
  })
})
