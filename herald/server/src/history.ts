/**
 * Traceability and comfort (phase S11): the full shared journal (filters, older pages), the history of the settings
 * Herald edits (every version kept in settings_versions, so a removed background period can come back), and the
 * publication templates ("Build contest"…).
 */
import { ACTIVITY_AREAS, PublicationTemplatesSchema, type ActivityArea } from '../../../src/shared/heraldPublications.ts'
import type { Permission } from '../../../src/shared/heraldRoles.ts'
import { HttpError, logActivity, type Actor } from './accounts'

/** GET /activity?before=<id>&who=<profile>&area=<area>: 100 entries, newest first (every staff member reads it) */
export async function listActivity(db: D1Database, url: URL) {
  const where: string[] = []
  const binds: unknown[] = []
  const before = Number(url.searchParams.get('before'))
  if (before > 0) where.push(`a.id < ?${binds.push(before)}`)
  const who = url.searchParams.get('who')
  if (who && /^p-[a-z0-9-]{1,20}$/.test(who)) where.push(`a.profile_id = ?${binds.push(who)}`)
  const area = url.searchParams.get('area') as ActivityArea | null
  if (area && area in ACTIVITY_AREAS) where.push(`(${ACTIVITY_AREAS[area].map((p) => `a.action LIKE ?${binds.push(`${p}%`)}`).join(' OR ')})`)
  const target = url.searchParams.get('target')
  if (target && /^[a-z]-[a-z0-9]{8,12}$/.test(target)) where.push(`a.target = ?${binds.push(target)}`)
  const rows = (
    await db
      .prepare(`SELECT a.id, a.at, a.action, a.target, a.detail, p.name AS who FROM activity a LEFT JOIN profiles p ON p.id = a.profile_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY a.id DESC LIMIT 101`)
      .bind(...binds)
      .all<{ id: number; at: number; action: string; target: string | null; detail: string | null; who: string | null }>()
  ).results
  return { entries: rows.slice(0, 100).map((a) => ({ ...a, detail: a.detail ? JSON.parse(a.detail) : null })), more: rows.length > 100 }
}

/** The settings whose versions Herald shows, and who may read them */
const HISTORY: Record<string, Permission[]> = {
  backgrounds: ['backgrounds.write'],
  public: ['settings.public', 'settings.staffCode'],
  'templates.publications': ['templates.write'],
}

/** GET /settings/history/<key>: the last 50 versions (value, who, when) */
export async function settingsHistory(db: D1Database, actor: Actor, key: string) {
  const needs = HISTORY[key]
  if (!needs) throw new HttpError(404, 'Unknown setting.')
  if (!needs.some((p) => actor.permissions.includes(p))) throw new HttpError(403, 'You cannot see this history.')
  const rows = (
    await db
      .prepare('SELECT v.id, v.at, v.action, v.value, p.name AS who FROM settings_versions v LEFT JOIN profiles p ON p.id = v.by WHERE v.key = ?1 ORDER BY v.id DESC LIMIT 50')
      .bind(key)
      .all<{ id: number; at: number; action: string; value: string; who: string | null }>()
  ).results
  return { versions: rows.map((r) => ({ ...r, value: JSON.parse(r.value) })) }
}

/** The publication templates (same rules as the maintenance message templates) */
export async function getPublicationTemplates(db: D1Database) {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'templates.publications'").first<{ value: string }>()
  return row ? JSON.parse(row.value) : []
}

export async function savePublicationTemplates(db: D1Database, actor: Actor, body: { templates?: unknown; change?: unknown }) {
  if (!actor.permissions.includes('templates.write')) throw new HttpError(403, 'You cannot change the templates.')
  const parsed = PublicationTemplatesSchema.safeParse(body.templates)
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join(' · '))
  const now = Date.now()
  const value = JSON.stringify(parsed.data)
  await db.batch([
    db.prepare("INSERT INTO settings (key, value, updated_by, updated_at) VALUES ('templates.publications', ?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = ?1, updated_by = ?2, updated_at = ?3").bind(value, actor.profile.id, now),
    db.prepare("INSERT INTO settings_versions (key, value, action, by, at) VALUES ('templates.publications', ?1, 'templates.publications', ?2, ?3)").bind(value, actor.profile.id, now),
  ])
  await logActivity(db, actor.profile.id, 'templates.publications', null, { count: parsed.data.length, change: typeof body.change === 'string' ? body.change.slice(0, 80) : null })
  return parsed.data
}
