/**
 * The Backgrounds tab (phase S8): Home pictures by period, kept in `settings` ('backgrounds'), every change kept in
 * `settings_versions`, journaled and published at once (like the Server tab). Pictures are the uploaded WebP images.
 */
import { backgroundProblems, BackgroundsSchema, DEFAULT_BACKGROUNDS, type Backgrounds } from '../../../src/shared/heraldBackgrounds.ts'
import { HttpError, logActivity, type Actor } from './accounts'
import type { Publisher, PublicationsEnv } from './publications'

const KEY = 'backgrounds'

export async function getBackgrounds(db: D1Database): Promise<{ backgrounds: Backgrounds; version: number }> {
  const row = await db.prepare('SELECT value, updated_at FROM settings WHERE key = ?1').bind(KEY).first<{ value: string; updated_at: number }>()
  return row ? { backgrounds: JSON.parse(row.value), version: row.updated_at } : { backgrounds: DEFAULT_BACKGROUNDS, version: 0 }
}

export async function saveBackgrounds(env: PublicationsEnv, actor: Actor, body: { version?: unknown; backgrounds?: unknown }, run: Publisher) {
  if (!actor.permissions.includes('backgrounds.write')) throw new HttpError(403, 'You cannot change the backgrounds.')
  const parsed = BackgroundsSchema.safeParse(body.backgrounds)
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => `${i.path.join('.') || 'value'}: ${i.message}`).join(' · '))
  const next = parsed.data
  const problems = backgroundProblems(next)
  if (problems.length) throw new HttpError(400, problems.join(' '))
  const current = await getBackgrounds(env.DB)
  if (body.version !== current.version) throw new HttpError(409, 'Someone changed the backgrounds meanwhile. Look again, then retry.')
  // Every picture must be one uploaded to Herald
  for (const id of new Set(next.periods.flatMap((p) => p.pictures.map((x) => x.image.id))))
    if (!(await env.DB.prepare('SELECT 1 FROM images WHERE id = ?1').bind(id).first())) throw new HttpError(400, 'A picture is missing on the server: add it again.')
  const now = Math.max(Date.now(), current.version + 1)
  const value = JSON.stringify(next)
  await env.DB.batch([
    env.DB.prepare('INSERT INTO settings (key, value, updated_by, updated_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(key) DO UPDATE SET value = ?2, updated_by = ?3, updated_at = ?4').bind(KEY, value, actor.profile.id, now),
    env.DB.prepare("INSERT INTO settings_versions (key, value, action, by, at) VALUES (?1, ?2, 'backgrounds.update', ?3, ?4)").bind(KEY, value, actor.profile.id, now),
  ])
  // What changed, in words, for the journal
  const was = new Map(current.backgrounds.periods.map((p) => [p.id, p]))
  const changed = next.periods.filter((p) => JSON.stringify(was.get(p.id)) !== JSON.stringify(p)).map((p) => p.name)
  const removed = current.backgrounds.periods.filter((p) => !next.periods.some((x) => x.id === p.id)).map((p) => p.name)
  await logActivity(env.DB, actor.profile.id, 'backgrounds.update', null, { changed, removed })
  return { backgrounds: next, backgroundsVersion: now, job: await run('backgrounds') }
}
