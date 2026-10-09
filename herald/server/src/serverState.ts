/**
 * The Server tab (phase S6): maintenances (planned, or started/ended right now in an emergency) and the daily restart
 * (dated changes, days without restart, extra restarts). These are feed parts kept in `settings` ('feed.base'); every
 * change is kept in `settings_versions`, journaled, and published at once (no review: these are staff tools).
 * A planned change is refused if someone changed the same thing meanwhile; emergencies always apply to the latest state.
 */
import { z } from 'zod'
import { MaintenanceSchema, RestartExceptionSchema, RestartRuleSchema } from '../../../src/shared/feedV2.ts'
import type { FeedBase } from '../../../src/shared/heraldPublications.ts'
import type { Permission } from '../../../src/shared/heraldRoles.ts'
import { HttpError, logActivity, type Actor } from './accounts'
import { feedBase, type Publisher, type PublicationsEnv } from './publications'

const KEY = 'feed.base'
const WEEK = 7 * 86_400_000

function need(actor: Actor, p: Permission, what: string) {
  if (!actor.permissions.includes(p)) throw new HttpError(403, `You cannot ${what}.`)
}

/** The version of the feed base the app last saw (its update time; 0 = never saved) */
export async function baseVersion(db: D1Database): Promise<number> {
  return (await db.prepare('SELECT updated_at FROM settings WHERE key = ?1').bind(KEY).first<{ updated_at: number }>())?.updated_at ?? 0
}

async function save(env: PublicationsEnv, actor: Actor, base: FeedBase, action: string, expected: unknown | null) {
  const current = await baseVersion(env.DB)
  if (expected !== null && expected !== current) throw new HttpError(409, 'Someone changed the server settings meanwhile. Look again, then retry.')
  const now = Math.max(Date.now(), current + 1)
  // Maintenances ended more than a week ago leave the feed (they stay in the history)
  const kept: FeedBase = { ...base, maintenances: base.maintenances.filter((m) => !m.end || Date.parse(m.end) > now - WEEK) }
  const value = JSON.stringify(kept)
  await env.DB.batch([
    env.DB.prepare('INSERT INTO settings (key, value, updated_by, updated_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(key) DO UPDATE SET value = ?2, updated_by = ?3, updated_at = ?4').bind(KEY, value, actor.profile.id, now),
    env.DB.prepare('INSERT INTO settings_versions (key, value, action, by, at) VALUES (?1, ?2, ?3, ?4, ?5)').bind(KEY, value, action, actor.profile.id, now),
  ])
  return { base: kept, baseVersion: now }
}

const newId = () => `m-${[...crypto.getRandomValues(new Uint8Array(10))].map((b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('')}`
const iso = (t: number) => new Date(t).toISOString()
const running = (m: { start: string; end?: string }, now: number) => Date.parse(m.start) <= now && (!m.end || Date.parse(m.end) > now)
const issues = (err: z.ZodError) => err.issues.map((i) => `${i.path.join('.') || 'value'}: ${i.message}`).join(' · ')

/** Plan a maintenance, or change a planned one */
export async function saveMaintenance(env: PublicationsEnv, actor: Actor, body: { version?: unknown; maintenance?: unknown }, run: Publisher) {
  need(actor, 'maintenance.write', 'plan maintenances')
  const input = body.maintenance as Record<string, unknown> | undefined
  const parsed = MaintenanceSchema.safeParse({ ...input, id: typeof input?.id === 'string' ? input.id : newId() })
  if (!parsed.success) throw new HttpError(400, issues(parsed.error))
  const m = parsed.data
  if (m.end && Date.parse(m.end) <= Date.parse(m.start)) throw new HttpError(400, 'The end is before the start.')
  if (m.announceFrom && Date.parse(m.announceFrom) > Date.parse(m.start)) throw new HttpError(400, 'The announcement must come before the start.')
  const base = await feedBase(env.DB)
  const existing = base.maintenances.some((x) => x.id === m.id)
  const saved = await save(env, actor, { ...base, maintenances: existing ? base.maintenances.map((x) => (x.id === m.id ? m : x)) : [...base.maintenances, m] }, existing ? 'maintenance.update' : 'maintenance.plan', body.version)
  await logActivity(env.DB, actor.profile.id, existing ? 'maintenance.update' : 'maintenance.plan', m.id, { start: m.start, end: m.end ?? null, message: m.message.en.slice(0, 120) })
  return { ...saved, job: await run(`maintenance ${m.id}`) }
}

export async function deleteMaintenance(env: PublicationsEnv, actor: Actor, id: string, body: { version?: unknown }, run: Publisher) {
  need(actor, 'maintenance.write', 'remove maintenances')
  const base = await feedBase(env.DB)
  const m = base.maintenances.find((x) => x.id === id)
  if (!m) throw new HttpError(404, 'Unknown maintenance.')
  if (running(m, Date.now())) throw new HttpError(409, 'It is running: use “The server is back online” to end it.')
  const saved = await save(env, actor, { ...base, maintenances: base.maintenances.filter((x) => x.id !== id) }, 'maintenance.delete', body.version)
  await logActivity(env.DB, actor.profile.id, 'maintenance.delete', id, { start: m.start, message: m.message.en.slice(0, 120) })
  return { ...saved, job: await run(`maintenance ${id} removed`) }
}

/** Emergency: the server goes into maintenance now (launchers show it within 2 minutes) */
export async function maintenanceNow(env: PublicationsEnv, actor: Actor, body: { message?: unknown; end?: unknown }, run: Publisher) {
  need(actor, 'maintenance.emergency', 'start a maintenance')
  const now = Date.now()
  const base = await feedBase(env.DB)
  if (base.maintenances.some((m) => running(m, now))) throw new HttpError(409, 'A maintenance is already running.')
  const parsed = MaintenanceSchema.safeParse({ id: newId(), message: body.message, start: iso(now), ...(typeof body.end === 'string' ? { end: body.end } : {}) })
  if (!parsed.success) throw new HttpError(400, issues(parsed.error))
  if (parsed.data.end && Date.parse(parsed.data.end) <= now) throw new HttpError(400, 'The expected end is already past.')
  const saved = await save(env, actor, { ...base, maintenances: [...base.maintenances, parsed.data] }, 'maintenance.start', null)
  await logActivity(env.DB, actor.profile.id, 'maintenance.start', parsed.data.id, { end: parsed.data.end ?? null, message: parsed.data.message.en.slice(0, 120) })
  return { ...saved, job: await run('maintenance now') }
}

/** Emergency: the server is back online (ends every running maintenance now) */
export async function backOnline(env: PublicationsEnv, actor: Actor, run: Publisher) {
  need(actor, 'maintenance.emergency', 'end a maintenance')
  const now = Date.now()
  const base = await feedBase(env.DB)
  const ended = base.maintenances.filter((m) => running(m, now))
  if (!ended.length) throw new HttpError(409, 'No maintenance is running.')
  const saved = await save(env, actor, { ...base, maintenances: base.maintenances.map((m) => (running(m, now) ? { ...m, end: iso(now) } : m)) }, 'maintenance.end', null)
  for (const m of ended) await logActivity(env.DB, actor.profile.id, 'maintenance.end', m.id, { message: m.message.en.slice(0, 120) })
  return { ...saved, job: await run('back online') }
}

const RestartSchema = z.object({ rules: z.array(RestartRuleSchema).min(1).max(20), exceptions: z.array(RestartExceptionSchema).max(60) })

/** The daily restart: its rules (each in force from a date) and exceptions */
export async function saveRestart(env: PublicationsEnv, actor: Actor, body: { version?: unknown; restart?: unknown }, run: Publisher) {
  need(actor, 'restart.write', 'change the daily restart')
  const parsed = RestartSchema.safeParse(body.restart)
  if (!parsed.success) throw new HttpError(400, issues(parsed.error))
  const now = Date.now()
  const { rules, exceptions } = parsed.data
  if (!rules.some((r) => Date.parse(r.from) <= now)) throw new HttpError(400, 'One rule must already be in force.')
  for (const e of exceptions) if (!e.skip && !e.extra) throw new HttpError(400, `${e.date}: a day without restart or an extra restart.`)
  // Old rules (replaced by a newer one already in force) and past exceptions are dropped
  const inForce = rules.filter((r) => Date.parse(r.from) <= now).sort((a, b) => Date.parse(b.from) - Date.parse(a.from))[0]
  const kept = { rules: [inForce, ...rules.filter((r) => Date.parse(r.from) > now)], exceptions: exceptions.filter((e) => Date.parse(`${e.date}T23:59:59Z`) > now - 2 * 86_400_000) }
  const base = await feedBase(env.DB)
  const saved = await save(env, actor, { ...base, restart: kept }, 'restart.update', body.version)
  await logActivity(env.DB, actor.profile.id, 'restart.update', null, { time: inForce.time, timeZone: inForce.timeZone, changes: kept.rules.length - 1, exceptions: kept.exceptions.length })
  return { ...saved, job: await run('daily restart') }
}

/** The history of the Server tab (who changed what, when) */
export async function serverHistory(env: PublicationsEnv) {
  return (await env.DB.prepare("SELECT v.id, v.action, v.at, p.name AS who FROM settings_versions v LEFT JOIN profiles p ON p.id = v.by WHERE v.key = 'feed.base' ORDER BY v.id DESC LIMIT 100").all()).results
}

const TemplatesSchema = z.array(z.object({ id: z.string().regex(/^t-[a-z0-9-]{1,30}$/), name: z.string().trim().min(1).max(40), text: z.string().trim().min(1).max(300) })).max(20)

/** The ready-made maintenance messages (not part of the feed: nothing is published) */
export async function saveTemplates(env: PublicationsEnv, actor: Actor, body: { templates?: unknown }) {
  need(actor, 'templates.write', 'change the templates')
  const parsed = TemplatesSchema.safeParse(body.templates)
  if (!parsed.success) throw new HttpError(400, issues(parsed.error))
  const now = Date.now()
  const value = JSON.stringify(parsed.data)
  await env.DB.batch([
    env.DB.prepare("INSERT INTO settings (key, value, updated_by, updated_at) VALUES ('templates.maintenance', ?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = ?1, updated_by = ?2, updated_at = ?3").bind(value, actor.profile.id, now),
    env.DB.prepare("INSERT INTO settings_versions (key, value, action, by, at) VALUES ('templates.maintenance', ?1, 'templates.update', ?2, ?3)").bind(value, actor.profile.id, now),
  ])
  await logActivity(env.DB, actor.profile.id, 'templates.update', null, { count: parsed.data.length })
  return parsed.data
}
