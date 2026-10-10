/**
 * Staff profiles (phase S4). A profile = a name, a role, permission changes, and a random CODE shown once: only its
 * HMAC (with the CODE_PEPPER secret) is stored. Sign-in gives a random session token; only its SHA-256 is stored.
 * Sessions last 30 days after their last use. 5 wrong codes lock the profile for 15 minutes.
 */
import { canChangeProfile, effectivePermissions, ROLES, type Permission, type Role } from '../../../src/shared/heraldRoles.ts'
import { toB64 } from './crypto'

export interface AccountsEnv {
  DB: D1Database
  CODE_PEPPER: string
  BOOTSTRAP_TOKEN?: string
}

export interface ProfileRow {
  id: string
  name: string
  role: Role
  perms_add: string
  perms_remove: string
  revoked_at: number | null
  created_at: number
  last_seen: number | null
}
export interface Actor {
  profile: ProfileRow
  permissions: Permission[]
}

const SESSION_MS = 30 * 86_400_000
const LOCK_MS = 15 * 60_000
const MAX_FAILURES = 5
const ONLINE_MS = 75_000
/** No 0/O, 1/I/L: easy to read out and type */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
const utf8 = (s: string) => new TextEncoder().encode(s)

export function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20))
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length])
  return [0, 5, 10, 15].map((i) => chars.slice(i, i + 5).join('')).join('-')
}
export const normalizeCode = (code: string) => code.toUpperCase().replace(/[^0-9A-Z]/g, '')

export async function hashCode(pepper: string, code: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', utf8(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return hex(await crypto.subtle.sign('HMAC', key, utf8(normalizeCode(code))))
}
const sha256 = async (s: string) => hex(await crypto.subtle.digest('SHA-256', utf8(s)))
const sameHash = (a: string, b: string) => {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

const permissionsOf = (p: ProfileRow) => effectivePermissions(p.role, JSON.parse(p.perms_add), JSON.parse(p.perms_remove))
export const publicProfile = (p: ProfileRow, now = Date.now()) => ({
  id: p.id,
  name: p.name,
  role: p.role,
  add: JSON.parse(p.perms_add) as string[],
  remove: JSON.parse(p.perms_remove) as string[],
  permissions: permissionsOf(p),
  revoked: p.revoked_at !== null,
  online: p.last_seen !== null && now - p.last_seen < ONLINE_MS,
  lastSeen: p.last_seen,
  createdAt: p.created_at,
})

export async function logActivity(db: D1Database, actor: string | null, action: string, target: string | null = null, detail: unknown = null): Promise<void> {
  await db.prepare('INSERT INTO activity (at, profile_id, action, target, detail) VALUES (?1, ?2, ?3, ?4, ?5)').bind(Date.now(), actor, action, target, detail === null ? null : JSON.stringify(detail)).run()
}

const cleanName = (name: unknown) => (typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '')
const validName = (name: string) => /^[\p{L}\p{N}_ .'-]{2,32}$/u.test(name)
const list = (x: unknown): string[] => (Array.isArray(x) ? x.filter((p): p is string => typeof p === 'string').slice(0, 50) : [])

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

async function insertProfile(env: AccountsEnv, name: string, role: Role, add: string[], remove: string[], by: string | null) {
  const code = newCode()
  const id = `p-${crypto.randomUUID().slice(0, 13)}`
  try {
    await env.DB.prepare('INSERT INTO profiles (id, name, name_key, role, perms_add, perms_remove, code_hash, created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)')
      .bind(id, name, name.toLowerCase(), role, JSON.stringify(add), JSON.stringify(remove), await hashCode(env.CODE_PEPPER, code), by, Date.now())
      .run()
  } catch {
    throw new HttpError(409, 'A profile already has this name.')
  }
  return { id, code }
}

/** First accounts (Owner, Developer), with a one-time BOOTSTRAP_TOKEN secret, only while those roles have nobody. */
export async function bootstrap(env: AccountsEnv, body: { token?: string; name?: unknown; role?: unknown }) {
  if (!env.BOOTSTRAP_TOKEN || body.token !== env.BOOTSTRAP_TOKEN) throw new HttpError(404, 'not found')
  const role = body.role === 'owner' || body.role === 'developer' ? body.role : null
  const name = cleanName(body.name)
  if (!role || !validName(name)) throw new HttpError(400, 'name and role (owner or developer) expected')
  if (await env.DB.prepare('SELECT 1 FROM profiles WHERE role = ?1').bind(role).first()) throw new HttpError(409, `The ${role} profile already exists.`)
  const created = await insertProfile(env, name, role, [], [], null)
  await logActivity(env.DB, created.id, 'profile.bootstrap', created.id, { name, role })
  return { profile: created.id, code: created.code }
}

/** Tests only (/dev routes, never in production): the "Herald Test" admin profile with a fresh code, created once. */
export async function testProfile(env: AccountsEnv) {
  const existing = await env.DB.prepare("SELECT id FROM profiles WHERE name_key = 'herald test'").first<{ id: string }>()
  if (!existing) return insertProfile(env, 'Herald Test', 'admin', [], [], null)
  const code = newCode()
  await env.DB.prepare('UPDATE profiles SET code_hash = ?2, revoked_at = NULL, failed_logins = 0, locked_until = NULL WHERE id = ?1').bind(existing.id, await hashCode(env.CODE_PEPPER, code)).run()
  return { id: existing.id, code }
}

export async function login(env: AccountsEnv, body: { name?: unknown; code?: unknown }) {
  const name = cleanName(body.name)
  const code = typeof body.code === 'string' ? body.code : ''
  const now = Date.now()
  const p = await env.DB.prepare('SELECT *, code_hash FROM profiles WHERE name_key = ?1').bind(name.toLowerCase()).first<ProfileRow & { code_hash: string; failed_logins: number; locked_until: number | null }>()
  if (!p || p.revoked_at !== null) throw new HttpError(401, 'Wrong name or code.')
  if (p.locked_until && p.locked_until > now) throw new HttpError(429, `Too many wrong codes: try again in ${Math.ceil((p.locked_until - now) / 60_000)} min.`)
  if (!sameHash(await hashCode(env.CODE_PEPPER, code), p.code_hash)) {
    const failures = p.failed_logins + 1
    const lock = failures >= MAX_FAILURES
    await env.DB.prepare('UPDATE profiles SET failed_logins = ?2, locked_until = ?3 WHERE id = ?1').bind(p.id, lock ? 0 : failures, lock ? now + LOCK_MS : p.locked_until).run()
    if (lock) await logActivity(env.DB, null, 'profile.locked', p.id, { name: p.name })
    throw new HttpError(401, lock ? 'Too many wrong codes: profile locked for 15 min.' : 'Wrong name or code.')
  }
  const token = toB64(crypto.getRandomValues(new Uint8Array(32))).replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' })[c]!)
  await env.DB.batch([
    env.DB.prepare('UPDATE profiles SET failed_logins = 0, locked_until = NULL, last_seen = ?2 WHERE id = ?1').bind(p.id, now),
    env.DB.prepare('INSERT INTO sessions (token_hash, profile_id, created_at, last_used, expires_at) VALUES (?1, ?2, ?3, ?3, ?4)').bind(await sha256(token), p.id, now, now + SESSION_MS),
  ])
  await logActivity(env.DB, p.id, 'session.signin')
  return { token, me: publicProfile({ ...p, last_seen: now }) }
}

/** The signed-in profile behind a request, or a 401. Sliding expiry; presence updated at most every 30 s. */
export async function authenticate(env: AccountsEnv, req: Request): Promise<Actor> {
  const token = req.headers.get('authorization')?.match(/^Bearer ([\w-]{20,100})$/)?.[1]
  if (!token) throw new HttpError(401, 'Not signed in.')
  const now = Date.now()
  const hash = await sha256(token)
  const row = await env.DB.prepare('SELECT p.*, s.last_used FROM sessions s JOIN profiles p ON p.id = s.profile_id WHERE s.token_hash = ?1 AND s.expires_at > ?2').bind(hash, now).first<ProfileRow & { last_used: number }>()
  if (!row || row.revoked_at !== null) throw new HttpError(401, 'Your session ended. Sign in again.')
  if (now - row.last_used > 30_000)
    await env.DB.batch([
      env.DB.prepare('UPDATE sessions SET last_used = ?2, expires_at = ?3 WHERE token_hash = ?1').bind(hash, now, now + SESSION_MS),
      env.DB.prepare('UPDATE profiles SET last_seen = ?2 WHERE id = ?1').bind(row.id, now),
    ])
  return { profile: row, permissions: permissionsOf(row) }
}

export async function logout(env: AccountsEnv, req: Request, actor: Actor) {
  const token = req.headers.get('authorization')!.slice(7)
  await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?1').bind(await sha256(token)).run()
  await env.DB.prepare('UPDATE profiles SET last_seen = ?2 WHERE id = ?1').bind(actor.profile.id, Date.now() - ONLINE_MS).run()
  await logActivity(env.DB, actor.profile.id, 'session.signout')
}

/** The journal's "who": the profile's name, or the name it had when it was deleted for good */
export const WHO = 'coalesce(p.name, f.name) AS who'
export const WHO_JOIN = 'LEFT JOIN profiles p ON p.id = a.profile_id LEFT JOIN former_profiles f ON f.id = a.profile_id'
/** Lodge keepers are not staff: the journal never shows them what happens to profiles (revoked, deleted…) */
export const hiddenFor = (actor: Actor) => (actor.profile.role === 'lodgeKeeper' ? "a.action NOT LIKE 'profile.%'" : null)

/** Everything the app refreshes every 15 s: who is online, recent activity. */
export async function sync(env: AccountsEnv, actor: Actor) {
  const now = Date.now()
  const people = (await env.DB.prepare('SELECT * FROM profiles WHERE revoked_at IS NULL ORDER BY name_key').all<ProfileRow>()).results.map((p) => publicProfile(p, now))
  const activity = (await env.DB.prepare(`SELECT a.id, a.at, a.action, a.target, a.detail, ${WHO} FROM activity a ${WHO_JOIN} ${hiddenFor(actor) ? `WHERE ${hiddenFor(actor)}` : ''} ORDER BY a.id DESC LIMIT 50`).all()).results.map((a) => ({ ...a, detail: a.detail ? JSON.parse(a.detail as string) : null }))
  // Changes when a publication, a publish job, a setting or a change of the mod pack changes: the app reloads only then
  const stamp = await env.DB.prepare('SELECT (SELECT count(*) || \'-\' || coalesce(max(updated_at), 0) FROM publications) || \'-\' || (SELECT coalesce(max(updated_at), 0) FROM publish_jobs) || \'-\' || (SELECT coalesce(max(updated_at), 0) FROM settings) || \'-\' || (SELECT coalesce(max(updated_at), 0) FROM pack_proposals) AS s').first<{ s: string }>()
  return { now, me: publicProfile(actor.profile, now), people, activity, contentStamp: stamp?.s ?? '' }
}

// ------------------------------------------------------------------------------------------------ managing profiles

export async function listProfiles(env: AccountsEnv, actor: Actor) {
  if (!actor.permissions.includes('profiles.manage')) throw new HttpError(403, 'You cannot manage profiles.')
  return (await env.DB.prepare('SELECT * FROM profiles ORDER BY name_key').all<ProfileRow>()).results.map((p) => publicProfile(p))
}

export async function createProfile(env: AccountsEnv, actor: Actor, body: { name?: unknown; role?: unknown; add?: unknown; remove?: unknown }) {
  const name = cleanName(body.name)
  const role = ROLES.find((r) => r === body.role)
  if (!validName(name)) throw new HttpError(400, 'A name has 2 to 32 letters, digits, spaces, dots, dashes or underscores.')
  if (!role) throw new HttpError(400, 'Unknown role.')
  const change = { role, add: list(body.add), remove: list(body.remove) }
  const refused = canChangeProfile({ role: actor.profile.role, permissions: actor.permissions }, null, change)
  if (refused) throw new HttpError(403, refused)
  const created = await insertProfile(env, name, role, change.add, change.remove, actor.profile.id)
  await logActivity(env.DB, actor.profile.id, 'profile.create', created.id, { name, role, add: change.add, remove: change.remove })
  return created
}

async function target(env: AccountsEnv, id: string) {
  const p = await env.DB.prepare('SELECT * FROM profiles WHERE id = ?1').bind(id).first<ProfileRow>()
  if (!p) throw new HttpError(404, 'Unknown profile.')
  return p
}

export async function updateProfile(env: AccountsEnv, actor: Actor, id: string, body: { role?: unknown; add?: unknown; remove?: unknown; revoked?: unknown }) {
  const p = await target(env, id)
  const role = (ROLES.find((r) => r === body.role) ?? p.role) as Role
  const change = { role, add: body.add === undefined ? JSON.parse(p.perms_add) : list(body.add), remove: body.remove === undefined ? JSON.parse(p.perms_remove) : list(body.remove) }
  const refused = canChangeProfile({ role: actor.profile.role, permissions: actor.permissions }, p.role, { ...change, add: change.add.filter((x: string) => !JSON.parse(p.perms_add).includes(x)) })
  if (refused) throw new HttpError(403, refused)
  if (p.id === actor.profile.id && (body.revoked === true || role !== p.role)) throw new HttpError(403, 'You cannot revoke yourself or change your own role.')
  const revoked = body.revoked === true ? (p.revoked_at ?? Date.now()) : body.revoked === false ? null : p.revoked_at
  await env.DB.prepare('UPDATE profiles SET role = ?2, perms_add = ?3, perms_remove = ?4, revoked_at = ?5 WHERE id = ?1').bind(id, role, JSON.stringify(change.add), JSON.stringify(change.remove), revoked).run()
  if (revoked !== null) await env.DB.prepare('DELETE FROM sessions WHERE profile_id = ?1').bind(id).run()
  await logActivity(env.DB, actor.profile.id, body.revoked === true ? 'profile.revoke' : body.revoked === false ? 'profile.restore' : 'profile.update', id, { name: p.name, role, add: change.add, remove: change.remove })
  return publicProfile({ ...p, role, perms_add: JSON.stringify(change.add), perms_remove: JSON.stringify(change.remove), revoked_at: revoked })
}

/** Deletes a REVOKED profile for good: its sessions and the profile go, its name stays for the journal. */
export async function deleteProfile(env: AccountsEnv, actor: Actor, id: string) {
  const p = await target(env, id)
  const refused = canChangeProfile({ role: actor.profile.role, permissions: actor.permissions }, p.role, { role: p.role, add: [], remove: [] })
  if (refused) throw new HttpError(403, refused)
  if (p.revoked_at === null) throw new HttpError(409, 'Revoke the profile first: only revoked profiles can be deleted.')
  if (p.id === actor.profile.id) throw new HttpError(403, 'You cannot delete yourself.')
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE profile_id = ?1').bind(id),
    env.DB.prepare('INSERT OR REPLACE INTO former_profiles (id, name, deleted_at) VALUES (?1, ?2, ?3)').bind(id, p.name, Date.now()),
    env.DB.prepare('DELETE FROM profiles WHERE id = ?1').bind(id),
  ])
  await logActivity(env.DB, actor.profile.id, 'profile.delete', id, { name: p.name, role: p.role })
  return { ok: true }
}

export async function newProfileCode(env: AccountsEnv, actor: Actor, id: string) {
  const p = await target(env, id)
  const refused = canChangeProfile({ role: actor.profile.role, permissions: actor.permissions }, p.role, { role: p.role, add: [], remove: [] })
  if (refused) throw new HttpError(403, refused)
  const code = newCode()
  await env.DB.prepare('UPDATE profiles SET code_hash = ?2, failed_logins = 0, locked_until = NULL WHERE id = ?1').bind(id, await hashCode(env.CODE_PEPPER, code)).run()
  await env.DB.prepare('DELETE FROM sessions WHERE profile_id = ?1').bind(id).run()
  await logActivity(env.DB, actor.profile.id, 'profile.newCode', id, { name: p.name })
  return { code }
}
