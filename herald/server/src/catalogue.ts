/**
 * Catalogue (launcher 1.4, Patreon try-on): the owner's models and skins, kept here with every version of their
 * files. Staff with catalogue permissions see it; files are given to the app for its previews; the original files can
 * only be downloaded with `catalogue.export` (the Owner's, see heraldRoles). Delivery to the launchers (sealed
 * copies, keys for verified accounts) is step 3c.
 */
import { cleanSheet, filesProblem, seesCatalogue, sheetProblems, type CatalogueFileInfo, type CatalogueItem, type CatalogueSheet, type CatalogueStatus, type CatalogueVersion } from '../../../src/shared/heraldCatalogue.ts'
import { HttpError, logActivity, type Actor } from './accounts'
import { fromB64, sha256Hex, toB64 } from './crypto'

export interface CatalogueEnv {
  DB: D1Database
}

const PART = 1_500_000

interface Row {
  id: string
  sheet: string
  status: CatalogueStatus
  version: number
  thumbnail: string | null
  created_at: number
  created_by: string | null
  updated_at: number
  updated_by: string | null
  published_at: number | null
}
interface FileRow {
  item_id: string
  version: number
  name: string
  size: number
  sha256: string
  created_at: number
  created_by: string | null
}

const need = (actor: Actor, p: string, what: string) => {
  if (!actor.permissions.includes(p as never)) throw new HttpError(403, `You cannot ${what}.`)
}
const newId = () => `c-${[...crypto.getRandomValues(new Uint8Array(10))].map((b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('')}`

function toItem(r: Row, files: FileRow[]): CatalogueItem {
  const versions = new Map<number, CatalogueVersion>()
  for (const f of files.filter((x) => x.item_id === r.id)) {
    const v = versions.get(f.version) ?? { version: f.version, at: f.created_at, by: f.created_by, files: [] as CatalogueFileInfo[] }
    v.files.push({ name: f.name, size: f.size, sha256: f.sha256 })
    versions.set(f.version, v)
  }
  const list = [...versions.values()].sort((a, b) => b.version - a.version)
  return {
    ...cleanSheet(JSON.parse(r.sheet) as Record<string, unknown>),
    id: r.id,
    status: r.status,
    version: r.version,
    files: versions.get(r.version)?.files ?? [],
    versions: list,
    thumbnail: r.thumbnail,
    createdAt: r.created_at,
    createdBy: r.created_by,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
    publishedAt: r.published_at,
  }
}

const FILES_SELECT = 'SELECT item_id, version, name, size, sha256, created_at, created_by FROM catalogue_files WHERE part = 0'

async function load(env: CatalogueEnv, id: string): Promise<CatalogueItem> {
  const r = await env.DB.prepare('SELECT * FROM catalogue_items WHERE id = ?1').bind(id).first<Row>()
  if (!r) throw new HttpError(404, 'Unknown catalogue item.')
  return toItem(r, (await env.DB.prepare(`${FILES_SELECT} AND item_id = ?1 ORDER BY name`).bind(id).all<FileRow>()).results)
}

export async function listCatalogue(env: CatalogueEnv, actor: Actor) {
  if (!seesCatalogue(actor.permissions)) throw new HttpError(403, 'You cannot see the catalogue.')
  const rows = (await env.DB.prepare('SELECT * FROM catalogue_items ORDER BY updated_at DESC LIMIT 1000').all<Row>()).results
  const files = (await env.DB.prepare(`${FILES_SELECT} ORDER BY name`).all<FileRow>()).results
  return { items: rows.map((r) => toItem(r, files)) }
}

export async function createItem(env: CatalogueEnv, actor: Actor, body: Record<string, unknown>) {
  need(actor, 'catalogue.write', 'add to the catalogue')
  const sheet = cleanSheet((body.sheet ?? {}) as Record<string, unknown>)
  const problems = sheetProblems(sheet)
  if (problems.length) throw new HttpError(400, problems.join(' '))
  const id = newId()
  const now = Date.now()
  await env.DB.prepare('INSERT INTO catalogue_items (id, sheet, created_at, created_by, updated_at, updated_by) VALUES (?1, ?2, ?3, ?4, ?3, ?4)').bind(id, JSON.stringify(sheet), now, actor.profile.id).run()
  await logActivity(env.DB, actor.profile.id, 'catalogue.create', id, { name: sheet.name, kind: sheet.kind })
  return load(env, id)
}

export async function saveSheet(env: CatalogueEnv, actor: Actor, id: string, body: Record<string, unknown>) {
  need(actor, 'catalogue.write', 'change the catalogue')
  const item = await load(env, id)
  const sheet: CatalogueSheet = cleanSheet((body.sheet ?? {}) as Record<string, unknown>, item)
  if (sheet.kind !== item.kind && item.version > 0) throw new HttpError(409, 'An item with files keeps its kind (model or skin).')
  // shown in the launchers: it must stay showable
  const problems = sheetProblems(sheet, item.status === 'published', item.version > 0)
  if (problems.length) throw new HttpError(400, problems.join(' '))
  await env.DB.prepare('UPDATE catalogue_items SET sheet = ?2, updated_at = ?3, updated_by = ?4 WHERE id = ?1').bind(id, JSON.stringify(sheet), Date.now(), actor.profile.id).run()
  await logActivity(env.DB, actor.profile.id, 'catalogue.update', id, { name: sheet.name })
  return load(env, id)
}

/** New files for an item: they become its next version (the previous ones are kept) */
export async function uploadFiles(env: CatalogueEnv, actor: Actor, id: string, body: Record<string, unknown>) {
  need(actor, 'catalogue.write', 'change the catalogue')
  const item = await load(env, id)
  const raw = Array.isArray(body.files) ? (body.files as { name?: unknown; data?: unknown }[]) : []
  let files: { name: string; bytes: Uint8Array }[]
  try {
    files = raw.map((f) => ({ name: String(f.name ?? ''), bytes: fromB64(String(f.data ?? '')) }))
  } catch {
    throw new HttpError(400, 'The files could not be read.')
  }
  const problem = filesProblem(item.kind, files)
  if (problem) throw new HttpError(400, problem)
  const version = Math.max(item.version, ...item.versions.map((v) => v.version)) + 1
  const now = Date.now()
  const statements: D1PreparedStatement[] = []
  for (const f of files) {
    const sha = await sha256Hex(f.bytes)
    for (let part = 0, at = 0; at < f.bytes.length || part === 0; part++, at += PART) {
      statements.push(
        env.DB.prepare('INSERT INTO catalogue_files (item_id, version, name, part, bytes, size, sha256, created_at, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)').bind(id, version, f.name, part, f.bytes.slice(at, at + PART), f.bytes.length, sha, now, actor.profile.id),
      )
    }
  }
  statements.push(env.DB.prepare('UPDATE catalogue_items SET version = ?2, updated_at = ?3, updated_by = ?4 WHERE id = ?1').bind(id, version, now, actor.profile.id))
  await env.DB.batch(statements)
  await logActivity(env.DB, actor.profile.id, 'catalogue.files', id, { name: item.name, version, files: files.map((f) => f.name) })
  return load(env, id)
}

/** Goes back to an earlier version of the files (kept as they were) */
export async function useVersion(env: CatalogueEnv, actor: Actor, id: string, body: Record<string, unknown>) {
  need(actor, 'catalogue.write', 'change the catalogue')
  const item = await load(env, id)
  const version = Number(body.version)
  if (!item.versions.some((v) => v.version === version)) throw new HttpError(404, 'Unknown version.')
  await env.DB.prepare('UPDATE catalogue_items SET version = ?2, updated_at = ?3, updated_by = ?4 WHERE id = ?1').bind(id, version, Date.now(), actor.profile.id).run()
  await logActivity(env.DB, actor.profile.id, 'catalogue.version', id, { name: item.name, version })
  return load(env, id)
}

async function readFiles(env: CatalogueEnv, id: string, version: number) {
  const parts = (await env.DB.prepare('SELECT name, part, bytes FROM catalogue_files WHERE item_id = ?1 AND version = ?2 ORDER BY name, part').bind(id, version).all<{ name: string; part: number; bytes: ArrayBuffer }>()).results
  const byName = new Map<string, Uint8Array[]>()
  for (const p of parts) byName.set(p.name, [...(byName.get(p.name) ?? []), new Uint8Array(p.bytes)])
  return [...byName].map(([name, chunks]) => {
    const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
    let at = 0
    for (const c of chunks) (all.set(c, at), (at += c.length))
    return { name, data: toB64(all) }
  })
}

/** The files of a version, for the app's previews (kept in memory there) */
export async function previewFiles(env: CatalogueEnv, actor: Actor, id: string, version?: number) {
  if (!seesCatalogue(actor.permissions)) throw new HttpError(403, 'You cannot see the catalogue.')
  const item = await load(env, id)
  const v = version ?? item.version
  if (!item.versions.some((x) => x.version === v)) throw new HttpError(404, 'No files yet.')
  return { version: v, files: await readFiles(env, id, v) }
}

/** The original files, to save on a PC: the Owner's (Admins given it by the Owner or a Developer), always in the journal */
export async function originalFiles(env: CatalogueEnv, actor: Actor, id: string, version?: number) {
  need(actor, 'catalogue.export', 'download original files')
  const r = await previewFiles(env, actor, id, version)
  const item = await load(env, id)
  await logActivity(env.DB, actor.profile.id, 'catalogue.export', id, { name: item.name, version: r.version })
  return r
}

export async function setStatus(env: CatalogueEnv, actor: Actor, id: string, body: Record<string, unknown>) {
  need(actor, 'catalogue.publish', 'show or hide catalogue items')
  const item = await load(env, id)
  const status = body.status as CatalogueStatus
  if (status !== 'published' && status !== 'hidden' && status !== 'draft') throw new HttpError(400, 'Unknown status.')
  if (status === 'published') {
    const problems = sheetProblems(item, true, item.version > 0)
    if (problems.length) throw new HttpError(400, problems.join(' '))
  }
  if (status === 'draft' && item.publishedAt) throw new HttpError(409, 'It was shown in the launchers: hide it instead.')
  const now = Date.now()
  await env.DB.prepare('UPDATE catalogue_items SET status = ?2, published_at = CASE WHEN ?2 = \'published\' THEN coalesce(published_at, ?3) ELSE published_at END, updated_at = ?3, updated_by = ?4 WHERE id = ?1').bind(id, status, now, actor.profile.id).run()
  await logActivity(env.DB, actor.profile.id, `catalogue.${status === 'published' ? 'publish' : status === 'hidden' ? 'hide' : 'draft'}`, id, { name: item.name })
  return load(env, id)
}

export async function setThumbnail(env: CatalogueEnv, actor: Actor, id: string, body: Record<string, unknown>) {
  need(actor, 'catalogue.write', 'change the catalogue')
  const image = typeof body.image === 'string' && /^[0-9a-f]{64}$/.test(body.image) ? body.image : null
  if (body.image !== null && !image) throw new HttpError(400, 'Unknown picture.')
  if (image && !(await env.DB.prepare('SELECT 1 FROM images WHERE id = ?1').bind(image).first())) throw new HttpError(404, 'Unknown picture.')
  await load(env, id)
  await env.DB.prepare('UPDATE catalogue_items SET thumbnail = ?2, updated_at = ?3, updated_by = ?4 WHERE id = ?1').bind(id, image, Date.now(), actor.profile.id).run()
  return load(env, id)
}

export async function deleteItem(env: CatalogueEnv, actor: Actor, id: string) {
  need(actor, 'catalogue.delete', 'delete catalogue items')
  const item = await load(env, id)
  await env.DB.batch([env.DB.prepare('DELETE FROM catalogue_files WHERE item_id = ?1').bind(id), env.DB.prepare('DELETE FROM catalogue_items WHERE id = ?1').bind(id)])
  await logActivity(env.DB, actor.profile.id, 'catalogue.delete', id, { name: item.name, versions: item.versions.length })
  return { ok: true }
}
