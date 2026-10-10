/**
 * Automatic backups (herald/backup): the nightly workflow of the private backups repository reports each result here
 * (BACKUP_TOKEN); staff with backups.view see the last ones, and Home warns when the last good one is too old.
 */
import { HttpError, type Actor } from './accounts'

const str = (v: unknown, max: number) => (typeof v === 'string' && v.length <= max ? v : null)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null)

/** POST /internal/backup (the workflow) */
export async function reportBackup(db: D1Database, body: Record<string, unknown>) {
  const url = str(body.url, 300)
  const now = Date.now()
  await db.batch([
    db
      .prepare('INSERT INTO backups (at, ok, name, size, sha256, url, kept, error) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)')
      .bind(now, body.ok === true ? 1 : 0, str(body.name, 120), num(body.size), str(body.sha256, 64), url && /^https:\/\/github\.com\//.test(url) ? url : null, num(body.kept), str(body.error, 300)),
    // the last 400 reports are plenty (more than a year)
    db.prepare('DELETE FROM backups WHERE id NOT IN (SELECT id FROM backups ORDER BY at DESC LIMIT 400)'),
  ])
  return { ok: true }
}

/** GET /backups (permission backups.view) */
export async function listBackups(db: D1Database, actor: Actor) {
  if (!actor.permissions.includes('backups.view')) throw new HttpError(403, 'You cannot see the backups.')
  const rows = (await db.prepare('SELECT at, ok, name, size, sha256, url, kept, error FROM backups ORDER BY at DESC LIMIT 40').all<{ at: number; ok: number; name: string | null; size: number | null; sha256: string | null; url: string | null; kept: number | null; error: string | null }>()).results
  const lastGood = (await db.prepare('SELECT max(at) AS at FROM backups WHERE ok = 1').first<{ at: number | null }>())?.at ?? null
  return { lastGood, backups: rows.map((r) => ({ at: r.at, ok: r.ok === 1, name: r.name, size: r.size, sha256: r.sha256, url: r.url, kept: r.kept, error: r.error })) }
}
