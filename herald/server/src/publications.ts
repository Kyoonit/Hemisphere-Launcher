/**
 * Publications (phase S5): news, announcement banners, welcome messages. Life: draft → in review → ready (locked) →
 * published. Every change is a new version (kept forever); a save based on an older version is refused. Deleting
 * moves to the trash (restorable). Publishing sends the whole current state (every published publication + the
 * other feed parts) to the publish queue: see publishAll.
 */
import { DEFAULT_FEED_BASE, DEFAULT_MAINTENANCE_TEMPLATES, emptyData, feedDraft, ID_PREFIX, WRITE_PERMISSION, MAX_IMAGE_BYTES, problems, PUBLICATION_KINDS, PublicationDataSchema, STATUSES, type FeedBase, type Publication, type PublicationData, type PublicationKind, type Status } from '../../../src/shared/heraldPublications.ts'
import { RESTART_SCHEDULE } from '../../../src/shared/server.ts'
import type { Permission } from '../../../src/shared/heraldRoles.ts'
import { HttpError, logActivity, type Actor } from './accounts'
import { getBackgrounds } from './backgrounds'
import { getPublic } from './publicSettings'
import { backgroundItems } from '../../../src/shared/heraldBackgrounds.ts'
import { sha256Hex, sha512Hex } from './crypto'
import { openKeys, sealFuture } from './feedV2'

export interface PublicationsEnv {
  DB: D1Database
  VAULT_MASTER: string
}

interface Row {
  id: string
  kind: PublicationKind
  status: Status
  data: string
  published: string | null
  published_at: number | null
  published_by: string | null
  version: number
  editing_by: string | null
  editing_until: number | null
  editing_name: string | null
  created_by: string | null
  created_at: number
  updated_by: string | null
  updated_at: number
  deleted_at: number | null
}

const WRITE = WRITE_PERMISSION
const LOCK_MS = 45_000

const toPublication = (r: Row, now = Date.now()): Publication => ({
  id: r.id,
  kind: r.kind,
  status: r.status,
  data: JSON.parse(r.data),
  published: r.published ? JSON.parse(r.published) : null,
  publishedAt: r.published_at,
  publishedBy: r.published_by,
  version: r.version,
  createdBy: r.created_by,
  createdAt: r.created_at,
  updatedBy: r.updated_by,
  updatedAt: r.updated_at,
  deletedAt: r.deleted_at,
  editing: r.editing_by && r.editing_until && r.editing_until > now ? { by: r.editing_by, name: r.editing_name ?? '?', until: r.editing_until } : null,
})

const SELECT = 'SELECT pub.*, ed.name AS editing_name FROM publications pub LEFT JOIN profiles ed ON ed.id = pub.editing_by'

/** A restricted draft is hidden from roles it is not meant for (what is published is public anyway). */
const visible = (actor: Actor, p: Publication) => !p.data.visibleTo?.length || p.published !== null || p.data.visibleTo.includes(actor.profile.role) || actor.permissions.includes('drafts.restricted') || p.createdBy === actor.profile.id

function need(actor: Actor, p: Permission, what: string) {
  if (!actor.permissions.includes(p)) throw new HttpError(403, `You cannot ${what}.`)
}

async function load(env: PublicationsEnv, actor: Actor, id: string): Promise<Publication> {
  const row = await env.DB.prepare(`${SELECT} WHERE pub.id = ?1`).bind(id).first<Row>()
  if (!row) throw new HttpError(404, 'Unknown publication.')
  const p = toPublication(row)
  if (!visible(actor, p)) throw new HttpError(404, 'Unknown publication.')
  return p
}

export async function feedBase(db: D1Database): Promise<FeedBase> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'feed.base'").first<{ value: string }>()
  return row ? JSON.parse(row.value) : DEFAULT_FEED_BASE(RESTART_SCHEDULE)
}

/** Everything the Publications, Preview and Home screens need */
export async function listPublications(env: PublicationsEnv, actor: Actor) {
  const now = Date.now()
  const rows = (await env.DB.prepare(`${SELECT} ORDER BY pub.updated_at DESC LIMIT 500`).all<Row>()).results
  const state = await env.DB.prepare('SELECT sequence, commit_sha, updated_at FROM publish_state WHERE id = 1').first<{ sequence: number; commit_sha: string | null; updated_at: string }>()
  const jobs = (await env.DB.prepare('SELECT j.id, j.status, j.error, j.sequence, j.reason, j.created_at, j.started_at, j.updated_at, j.commit_sha, p.name AS who FROM publish_jobs j LEFT JOIN profiles p ON p.id = j.requested_by ORDER BY j.created_at DESC LIMIT 12').all()).results
  return {
    now,
    publications: rows.map((r) => toPublication(r, now)).filter((p) => visible(actor, p)),
    base: await feedBase(env.DB),
    live: state ? { sequence: state.sequence, commit: state.commit_sha, at: Date.parse(state.updated_at) } : null,
    /** Version of `base` (the Server tab sends it back: a stale change is refused) */
    ...(await (async () => {
      const b = await getBackgrounds(env.DB)
      const pub = await getPublic(env.DB)
      return { backgrounds: b.backgrounds, backgroundsVersion: b.version, publicSettings: pub }
    })()),
    maintenanceTemplates: JSON.parse((await env.DB.prepare("SELECT value FROM settings WHERE key = 'templates.maintenance'").first<{ value: string }>())?.value ?? JSON.stringify(DEFAULT_MAINTENANCE_TEMPLATES)),
    baseVersion: (await env.DB.prepare("SELECT updated_at FROM settings WHERE key = 'feed.base'").first<{ updated_at: number }>())?.updated_at ?? 0,
    jobs,
  }
}

export async function getPublication(env: PublicationsEnv, actor: Actor, id: string) {
  const publication = await load(env, actor, id)
  const versions = (await env.DB.prepare('SELECT v.version, v.status, v.action, v.at, p.name AS who FROM publication_versions v LEFT JOIN profiles p ON p.id = v.by WHERE v.publication_id = ?1 ORDER BY v.version DESC LIMIT 200').bind(id).all()).results
  const comments = (await env.DB.prepare('SELECT c.id, c.text, c.at, p.name AS who, c.author FROM comments c LEFT JOIN profiles p ON p.id = c.author WHERE c.publication_id = ?1 ORDER BY c.id').bind(id).all()).results
  return { publication, versions, comments }
}

/** One version of the history (to look at or bring back) */
export async function getVersion(env: PublicationsEnv, actor: Actor, id: string, version: number) {
  await load(env, actor, id)
  const v = await env.DB.prepare('SELECT version, status, action, data, at FROM publication_versions WHERE publication_id = ?1 AND version = ?2').bind(id, version).first<{ data: string }>()
  if (!v) throw new HttpError(404, 'Unknown version.')
  return { ...v, data: JSON.parse(v.data) }
}

/** Writes the new state + its history line, only if nobody saved meanwhile. */
async function commit(env: PublicationsEnv, actor: Actor, p: Publication, expected: unknown, change: { status?: Status; data?: PublicationData; published?: PublicationData | null; publishedAt?: number | null; deleted?: boolean }, action: string): Promise<Publication> {
  if (typeof expected !== 'number' || expected !== p.version)
    throw new HttpError(409, `${p.updatedBy === actor.profile.id ? 'You' : 'Someone'} changed this publication meanwhile (version ${p.version}). Reload it first.`)
  const now = Date.now()
  const next: Publication = {
    ...p,
    status: change.status ?? p.status,
    data: change.data ?? p.data,
    published: change.published !== undefined ? change.published : p.published,
    publishedAt: change.publishedAt !== undefined ? change.publishedAt : p.publishedAt,
    publishedBy: change.published !== undefined ? (change.published ? actor.profile.id : null) : p.publishedBy,
    version: p.version + 1,
    updatedBy: actor.profile.id,
    updatedAt: now,
    deletedAt: change.deleted === true ? now : change.deleted === false ? null : p.deletedAt,
  }
  const res = await env.DB.batch([
    env.DB.prepare('UPDATE publications SET status = ?3, data = ?4, published = ?5, published_at = ?6, published_by = ?7, version = ?8, updated_by = ?9, updated_at = ?10, deleted_at = ?11, deleted_by = ?12 WHERE id = ?1 AND version = ?2').bind(
      p.id, p.version, next.status, JSON.stringify(next.data), next.published ? JSON.stringify(next.published) : null, next.publishedAt, next.publishedBy, next.version, actor.profile.id, now, next.deletedAt, next.deletedAt ? actor.profile.id : null,
    ),
    env.DB.prepare('INSERT OR IGNORE INTO publication_versions (publication_id, version, status, data, action, by, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)').bind(p.id, next.version, next.status, JSON.stringify(next.data), action, actor.profile.id, now),
  ])
  if (!res[0].meta.changes) throw new HttpError(409, 'Someone changed this publication meanwhile. Reload it first.')
  return next
}

const title = (p: Pick<Publication, 'kind' | 'data'>) => (p.data.texts.en?.title || p.data.texts.en?.text || '(untitled)').slice(0, 80)

export async function createPublication(env: PublicationsEnv, actor: Actor, body: { kind?: unknown; zone?: unknown; data?: unknown }) {
  const kind = PUBLICATION_KINDS.find((k) => k === body.kind)
  if (!kind) throw new HttpError(400, 'Unknown kind.')
  need(actor, WRITE[kind], `write a ${kind}`)
  const zone = typeof body.zone === 'string' && body.zone.length < 64 ? body.zone : 'UTC'
  const data = body.data === undefined ? emptyData(kind, zone) : PublicationDataSchema.parse(body.data)
  const id = `${ID_PREFIX[kind]}-${[...crypto.getRandomValues(new Uint8Array(12))].map((b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('')}`
  const now = Date.now()
  await env.DB.batch([
    env.DB.prepare("INSERT INTO publications (id, kind, status, data, version, created_by, created_at, updated_by, updated_at) VALUES (?1, ?2, 'draft', ?3, 1, ?4, ?5, ?4, ?5)").bind(id, kind, JSON.stringify(data), actor.profile.id, now),
    env.DB.prepare("INSERT INTO publication_versions (publication_id, version, status, data, action, by, at) VALUES (?1, 1, 'draft', ?2, 'create', ?3, ?4)").bind(id, JSON.stringify(data), actor.profile.id, now),
  ])
  await logActivity(env.DB, actor.profile.id, 'publication.create', id, { kind, title: title({ kind, data }) })
  return load(env, actor, id)
}

export async function savePublication(env: PublicationsEnv, actor: Actor, id: string, body: { version?: unknown; data?: unknown }) {
  const p = await load(env, actor, id)
  need(actor, WRITE[p.kind], `edit a ${p.kind}`)
  if (p.deletedAt) throw new HttpError(409, 'This publication is in the trash: restore it first.')
  if (p.status === 'ready') throw new HttpError(423, 'This publication is Ready and locked: reopen it to change it.')
  const parsed = PublicationDataSchema.safeParse(body.data)
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' · '))
  const next = await commit(env, actor, p, body.version, { data: parsed.data }, 'save')
  // One journal line per person and publication every 10 minutes (an editing session, not every keystroke)
  const recent = await env.DB.prepare("SELECT 1 FROM activity WHERE profile_id = ?1 AND target = ?2 AND action = 'publication.edit' AND at > ?3").bind(actor.profile.id, id, Date.now() - 600_000).first()
  if (!recent) await logActivity(env.DB, actor.profile.id, 'publication.edit', id, { kind: p.kind, title: title(next) })
  return next
}

const ACTION_LABEL: Record<string, string> = { review: 'publication.review', ready: 'publication.ready', draft: 'publication.reopen' }

/** draft ⇄ in review → ready (locked; needs publications.approve and no problems) → draft again ("reopen") */
export async function setStatus(env: PublicationsEnv, actor: Actor, id: string, body: { version?: unknown; status?: unknown }) {
  const p = await load(env, actor, id)
  const status = STATUSES.find((s) => s === body.status)
  if (!status || status === p.status) throw new HttpError(400, 'Unknown or unchanged status.')
  if (p.deletedAt) throw new HttpError(409, 'This publication is in the trash: restore it first.')
  if (status === 'ready') {
    need(actor, 'publications.approve', 'mark a publication Ready')
    const issues = problems(p.kind, p.data)
    if (issues.length) throw new HttpError(422, issues.join(' '))
  } else need(actor, WRITE[p.kind], `change a ${p.kind}`)
  const next = await commit(env, actor, p, body.version, { status }, 'status')
  await logActivity(env.DB, actor.profile.id, ACTION_LABEL[status], id, { kind: p.kind, title: title(p) })
  return next
}

export async function publishPublication(env: PublicationsEnv, actor: Actor, id: string, body: { version?: unknown }, run: Publisher) {
  const p = await load(env, actor, id)
  need(actor, 'publications.publish', 'publish')
  if (p.deletedAt) throw new HttpError(409, 'This publication is in the trash: restore it first.')
  if (p.status !== 'ready') throw new HttpError(409, 'Mark it Ready first (a Ready publication is locked while it goes online).')
  const issues = problems(p.kind, p.data)
  if (issues.length) throw new HttpError(422, issues.join(' '))
  // "As soon as published" keeps the first publication time (an edit does not move the news to the top again)
  const next = await commit(env, actor, p, body.version, { published: p.data, publishedAt: p.publishedAt ?? Date.now() }, 'publish')
  await logActivity(env.DB, actor.profile.id, p.data.schedule.from && Date.parse(p.data.schedule.from) > Date.now() ? 'publication.schedule' : 'publication.publish', id, { kind: p.kind, title: title(p), from: p.data.schedule.from })
  return { publication: next, job: await run(`publish ${id}`) }
}

export async function unpublishPublication(env: PublicationsEnv, actor: Actor, id: string, body: { version?: unknown }, run: Publisher) {
  const p = await load(env, actor, id)
  need(actor, 'publications.publish', 'take a publication down')
  if (!p.published) throw new HttpError(409, 'It is not online.')
  const next = await commit(env, actor, p, body.version, { published: null, publishedAt: null }, 'unpublish')
  await logActivity(env.DB, actor.profile.id, 'publication.unpublish', id, { kind: p.kind, title: title(p) })
  return { publication: next, job: await run(`unpublish ${id}`) }
}

export async function deletePublication(env: PublicationsEnv, actor: Actor, id: string, body: { version?: unknown }, run: Publisher) {
  const p = await load(env, actor, id)
  need(actor, 'publications.delete', 'delete publications')
  if (p.deletedAt) throw new HttpError(409, 'Already in the trash.')
  const wasOnline = p.published !== null
  if (wasOnline) need(actor, 'publications.publish', 'take a publication down')
  const next = await commit(env, actor, p, body.version, { deleted: true, published: null, publishedAt: null }, 'delete')
  await logActivity(env.DB, actor.profile.id, 'publication.delete', id, { kind: p.kind, title: title(p), wasOnline })
  return { publication: next, job: wasOnline ? await run(`delete ${id}`) : null }
}

export async function restorePublication(env: PublicationsEnv, actor: Actor, id: string, body: { version?: unknown }) {
  const p = await load(env, actor, id)
  need(actor, 'publications.restore', 'restore publications')
  if (!p.deletedAt) throw new HttpError(409, 'It is not in the trash.')
  const next = await commit(env, actor, p, body.version, { deleted: false, status: 'draft' }, 'restore')
  await logActivity(env.DB, actor.profile.id, 'publication.restore', id, { kind: p.kind, title: title(p) })
  return next
}

export async function addComment(env: PublicationsEnv, actor: Actor, id: string, body: { text?: unknown }) {
  const p = await load(env, actor, id)
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (!text || text.length > 2000) throw new HttpError(400, 'A comment has 1 to 2000 characters.')
  await env.DB.prepare('INSERT INTO comments (publication_id, author, text, at) VALUES (?1, ?2, ?3, ?4)').bind(id, actor.profile.id, text, Date.now()).run()
  // Comments wake the other editors up (their list refreshes on updated_at)
  await env.DB.prepare('UPDATE publications SET updated_at = ?2 WHERE id = ?1').bind(id, Date.now()).run()
  await logActivity(env.DB, actor.profile.id, 'publication.comment', id, { kind: p.kind, title: title(p), text: text.slice(0, 120) })
  return getPublication(env, actor, id)
}

/** Soft lock: "X is editing" for the others, renewed by the editor every 20 s, released when it closes. */
export async function setEditing(env: PublicationsEnv, actor: Actor, id: string, body: { on?: unknown }) {
  await load(env, actor, id)
  const now = Date.now()
  if (body.on === true) await env.DB.prepare('UPDATE publications SET editing_by = ?2, editing_until = ?3 WHERE id = ?1 AND (editing_by IS NULL OR editing_by = ?2 OR editing_until < ?4)').bind(id, actor.profile.id, now + LOCK_MS, now).run()
  else await env.DB.prepare('UPDATE publications SET editing_by = NULL, editing_until = NULL WHERE id = ?1 AND editing_by = ?2').bind(id, actor.profile.id).run()
  return { ok: true }
}

// ------------------------------------------------------------------------------------------------ images

/** A WebP picture made by the app (≤ 1.5 MB). Same bytes = same id: uploading twice stores it once. */
export async function uploadImage(env: PublicationsEnv, actor: Actor, req: Request) {
  if (!PUBLICATION_KINDS.some((k) => actor.permissions.includes(WRITE[k])) && !actor.permissions.includes('backgrounds.write')) throw new HttpError(403, 'You cannot add pictures.')
  const bytes = new Uint8Array(await req.arrayBuffer())
  const width = Number(req.headers.get('x-width'))
  const height = Number(req.headers.get('x-height'))
  if (bytes.length > MAX_IMAGE_BYTES) throw new HttpError(413, 'Pictures are limited to 1.5 MB.')
  const webp = bytes.length > 12 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP'
  if (!webp || !(width > 0 && width <= 8192) || !(height > 0 && height <= 8192)) throw new HttpError(400, 'A WebP picture with its size is expected.')
  const id = await sha256Hex(bytes)
  const sha512 = await sha512Hex(bytes)
  await env.DB.prepare('INSERT OR IGNORE INTO images (id, bytes, sha512, size, width, height, created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)').bind(id, bytes, sha512, bytes.length, width, height, actor.profile.id, Date.now()).run()
  return { id, sha512, size: bytes.length, width, height }
}

export async function imageFile(env: PublicationsEnv, id: string): Promise<Response> {
  const row = await env.DB.prepare('SELECT bytes FROM images WHERE id = ?1').bind(id).first<{ bytes: ArrayBuffer }>()
  if (!row) throw new HttpError(404, 'Unknown picture.')
  return new Response(new Uint8Array(row.bytes), { headers: { 'content-type': 'image/webp', 'cache-control': 'private, max-age=31536000, immutable' } })
}

// ------------------------------------------------------------------------------------------------ publishing

/** Queues a publish job of the current state and starts the workflow; returns the job id. */
export type Publisher = (reason: string) => Promise<string>

/** The whole current state: every published publication + the other feed parts, future items locked in vaults. */
export async function buildFeed(env: PublicationsEnv, now: number) {
  const rows = (await env.DB.prepare('SELECT id, kind, published, published_at FROM publications WHERE published IS NOT NULL AND deleted_at IS NULL').all<{ id: string; kind: PublicationKind; published: string; published_at: number }>()).results
  const draft = feedDraft(rows.map((r) => ({ id: r.id, kind: r.kind, data: JSON.parse(r.published), publishedAt: r.published_at })), await feedBase(env.DB), now, backgroundItems((await getBackgrounds(env.DB)).backgrounds, now))
  // The launcher settings (support link, Discord id, staff code) replace the base's
  const { support: _s, discordAppId: _d, staffCode: _c, ...rest } = draft
  const { settings } = await getPublic(env.DB)
  const { feed, files } = await sealFuture(env.DB, env.VAULT_MASTER, { ...rest, ...settings }, now)
  return { feed, files, vaultKeys: await openKeys(env.DB, env.VAULT_MASTER, feed, now) }
}
