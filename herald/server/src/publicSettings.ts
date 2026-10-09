/**
 * Launcher settings (phase S9): support link and Discord application id (`settings.public`), the Developer tab's
 * staff code (`settings.staffCode`). Kept in `settings` ('public', every version in `settings_versions`), journaled,
 * published at once. The staff code arrives as its scrypt fingerprint only: the code never reaches the server.
 */
import { DEFAULT_PUBLIC, PublicSettingsSchema, type PublicSettings } from '../../../src/shared/heraldPublic.ts'
import { HttpError, logActivity, type Actor } from './accounts'
import type { Publisher, PublicationsEnv } from './publications'

const KEY = 'public'

export async function getPublic(db: D1Database): Promise<{ settings: PublicSettings; version: number; staffCodeAt: number | null; staffCodeBy: string | null }> {
  const row = await db.prepare('SELECT value, updated_at FROM settings WHERE key = ?1').bind(KEY).first<{ value: string; updated_at: number }>()
  // When and by whom the staff code was last changed (never the code itself)
  const code = await db
    .prepare("SELECT v.at, p.name FROM settings_versions v LEFT JOIN profiles p ON p.id = v.by WHERE v.key = ?1 AND v.action = 'settings.staffCode' ORDER BY v.id DESC LIMIT 1")
    .bind(KEY)
    .first<{ at: number; name: string | null }>()
  return { settings: row ? JSON.parse(row.value) : DEFAULT_PUBLIC, version: row?.updated_at ?? 0, staffCodeAt: code?.at ?? null, staffCodeBy: code?.name ?? null }
}

/** body: { version, part: 'public' | 'staffCode', settings } — only that part changes */
export async function savePublic(env: PublicationsEnv, actor: Actor, body: { version?: unknown; part?: unknown; settings?: unknown }, run: Publisher) {
  const part = body.part === 'staffCode' ? 'staffCode' : 'public'
  if (!actor.permissions.includes(part === 'staffCode' ? 'settings.staffCode' : 'settings.public')) throw new HttpError(403, part === 'staffCode' ? 'You cannot change the staff code.' : 'You cannot change the launcher settings.')
  const current = await getPublic(env.DB)
  if (body.version !== current.version) throw new HttpError(409, 'Someone changed the launcher settings meanwhile. Look again, then retry.')
  const input = (body.settings ?? {}) as Record<string, unknown>
  const merged: Record<string, unknown> = { ...current.settings }
  const fields = part === 'staffCode' ? ['staffCode'] : ['support', 'discordAppId']
  for (const f of fields) {
    if (input[f] === undefined || input[f] === null) delete merged[f]
    else merged[f] = input[f]
  }
  const parsed = PublicSettingsSchema.safeParse(merged)
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => `${i.path.join('.') || 'value'}: ${i.message}`).join(' · '))
  const now = Math.max(Date.now(), current.version + 1)
  const value = JSON.stringify(parsed.data)
  const action = part === 'staffCode' ? 'settings.staffCode' : 'settings.public'
  await env.DB.batch([
    env.DB.prepare('INSERT INTO settings (key, value, updated_by, updated_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(key) DO UPDATE SET value = ?2, updated_by = ?3, updated_at = ?4').bind(KEY, value, actor.profile.id, now),
    env.DB.prepare('INSERT INTO settings_versions (key, value, action, by, at) VALUES (?1, ?2, ?3, ?4, ?5)').bind(KEY, value, action, actor.profile.id, now),
  ])
  await logActivity(
    env.DB,
    actor.profile.id,
    action,
    null,
    part === 'staffCode' ? { reset: !parsed.data.staffCode } : { support: parsed.data.support?.url ?? null, discordAppId: parsed.data.discordAppId ?? null },
  )
  return { ...(await getPublic(env.DB)), job: await run(part === 'staffCode' ? 'staff code' : 'launcher settings') }
}
