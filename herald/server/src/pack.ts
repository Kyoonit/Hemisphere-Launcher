/**
 * The mod pack (phase S10). Herald builds the next client manifest on the staff PC (Modrinth) and sends it whole as a
 * PROPOSAL (`pack.propose`); ANOTHER member with `pack.approve` approves it (never the one who proposed it). From then
 * on every publish job carries it, until GitHub Actions has published it: the publisher checks each mod against
 * Modrinth again, refuses if the online pack changed meanwhile, writes clients/<v>/ and signs index.json.
 * One change at a time: a new proposal waits until the open one is published, rejected or withdrawn.
 */
import { ClientManifestSchema } from '../../../src/shared/manifest.ts'
import { compareVersions, MAX_PACK_FILE, PackBaseSchema, packFileKey, packFileUrl, type PackProposal, type PackStatus } from '../../../src/shared/heraldPack.ts'
import { HttpError, logActivity, type Actor } from './accounts'
import { sha512Hex } from './crypto'
import type { Publisher } from './publications'

export interface PackEnv {
  DB: D1Database
  GITHUB_REPO: string
  GITHUB_BRANCH: string
  CONTENT_DIR: string
}

/** Where this server's content is published (the pack's config files are addressed there) */
export const contentBaseOf = (env: PackEnv) => `https://raw.githubusercontent.com/${env.GITHUB_REPO}/${env.GITHUB_BRANCH}/${env.CONTENT_DIR}/`

interface Row {
  id: string
  status: PackStatus
  client_version: string
  manifest: string
  based_on: string
  previous_can_join: number
  note: string
  proposed_by: string
  proposed_at: number
  decided_by: string | null
  decided_at: number | null
  decision_note: string | null
  commit_sha: string | null
  updated_at: number
  proposed_name: string | null
  decided_name: string | null
}

const SELECT = 'SELECT k.*, a.name AS proposed_name, b.name AS decided_name FROM pack_proposals k LEFT JOIN profiles a ON a.id = k.proposed_by LEFT JOIN profiles b ON b.id = k.decided_by'
const OPEN = "k.status IN ('proposed', 'approved', 'failed')"

const toProposal = (r: Row): PackProposal => ({
  id: r.id,
  status: r.status,
  clientVersion: r.client_version,
  manifest: JSON.parse(r.manifest),
  basedOn: JSON.parse(r.based_on),
  previousCanJoin: Boolean(r.previous_can_join),
  note: r.note,
  proposedBy: r.proposed_by,
  proposedByName: r.proposed_name,
  proposedAt: r.proposed_at,
  decidedBy: r.decided_by,
  decidedByName: r.decided_name,
  decidedAt: r.decided_at,
  decisionNote: r.decision_note,
  commit: r.commit_sha,
  updatedAt: r.updated_at,
})

function need(actor: Actor, approve = false) {
  const ok = approve ? actor.permissions.includes('pack.approve') : actor.permissions.includes('pack.propose') || actor.permissions.includes('pack.approve')
  if (!ok) throw new HttpError(403, approve ? 'You cannot approve changes of the mod pack.' : 'You cannot change the mod pack.')
}

/** The open change (if any) and the last ones, with where the pack is published. */
export async function getPack(env: PackEnv, actor: Actor) {
  need(actor)
  const rows = (await env.DB.prepare(`${SELECT} ORDER BY k.proposed_at DESC LIMIT 8`).all<Row>()).results
  return { proposals: rows.map(toProposal), contentBase: contentBaseOf(env) }
}

async function load(env: PackEnv, id: string): Promise<Row> {
  const row = await env.DB.prepare(`${SELECT} WHERE k.id = ?1`).bind(id).first<Row>()
  if (!row) throw new HttpError(404, 'This change of the pack does not exist.')
  return row
}

const newId = () => `k-${[...crypto.getRandomValues(new Uint8Array(10))].map((b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('')}`

/** body: { manifest, basedOn, previousCanJoin, note, replaces? } — `replaces`: my own proposal not approved yet */
export async function proposePack(env: PackEnv, actor: Actor, body: Record<string, unknown>) {
  if (!actor.permissions.includes('pack.propose')) throw new HttpError(403, 'You cannot propose changes of the mod pack.')
  const base = PackBaseSchema.safeParse(body.basedOn)
  if (!base.success) throw new HttpError(400, 'The online pack this change starts from is missing.')
  const parsed = ClientManifestSchema.safeParse(body.manifest)
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.') || 'pack'}: ${i.message}`).join(' · '))
  const manifest = parsed.data
  if (compareVersions(manifest.clientVersion, base.data.clientVersion) <= 0) throw new HttpError(400, `The new version must be higher than the one players have (${base.data.clientVersion}).`)
  const unsourced = manifest.mods.filter((m) => !m.source)
  if (unsourced.length) throw new HttpError(400, `Every mod comes from Modrinth: ${unsourced.map((m) => m.name).join(', ')} does not.`)
  for (const f of manifest.files) {
    if (f.url !== packFileUrl(contentBaseOf(env), manifest.clientVersion, f.path)) throw new HttpError(400, `${f.path}: wrong address.`)
    const kept = await env.DB.prepare('SELECT sha512 FROM content_files WHERE path = ?1').bind(packFileKey(f.sha512)).first<{ sha512: string }>()
    if (kept?.sha512 !== f.sha512) throw new HttpError(400, `${f.path}: the file was not sent to the server. Add it again.`)
  }
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : ''
  if (!note) throw new HttpError(400, 'Say in a few words why (shown to whoever approves).')

  const open = await env.DB.prepare(`${SELECT} WHERE ${OPEN} ORDER BY k.proposed_at DESC LIMIT 1`).first<Row>()
  const now = Date.now()
  const writes: D1PreparedStatement[] = []
  if (open) {
    const mine = body.replaces === open.id && open.proposed_by === actor.profile.id && open.status !== 'approved'
    if (!mine) throw new HttpError(409, `A change of the pack is already waiting (${open.client_version}, by ${open.proposed_name ?? 'someone'}): it must be published, rejected or withdrawn first.`)
    writes.push(env.DB.prepare("UPDATE pack_proposals SET status = 'replaced', updated_at = ?2 WHERE id = ?1").bind(open.id, now))
  }
  const id = newId()
  writes.push(
    env.DB.prepare(
      "INSERT INTO pack_proposals (id, status, client_version, manifest, based_on, previous_can_join, note, proposed_by, proposed_at, updated_at) VALUES (?1, 'proposed', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
    ).bind(id, manifest.clientVersion, JSON.stringify(manifest), JSON.stringify(base.data), body.previousCanJoin === false ? 0 : 1, note, actor.profile.id, now),
  )
  await env.DB.batch(writes)
  await logActivity(env.DB, actor.profile.id, 'pack.propose', id, { version: manifest.clientVersion, note })
  return getPack(env, actor)
}

/** Another member approves (or, after a failed publication, tries again): published with the next publish job. */
export async function approvePack(env: PackEnv, actor: Actor, id: string, run: Publisher) {
  need(actor, true)
  const row = await load(env, id)
  if (row.status !== 'proposed' && row.status !== 'failed') throw new HttpError(409, 'This change is not waiting for an approval any more.')
  if (row.proposed_by === actor.profile.id) throw new HttpError(403, 'Someone else must approve a change you proposed.')
  const now = Date.now()
  await env.DB.prepare("UPDATE pack_proposals SET status = 'approved', decided_by = ?2, decided_at = ?3, decision_note = NULL, updated_at = ?3 WHERE id = ?1").bind(id, actor.profile.id, now).run()
  await logActivity(env.DB, actor.profile.id, row.status === 'failed' ? 'pack.retry' : 'pack.approve', id, { version: row.client_version })
  return { ...(await getPack(env, actor)), job: await run('mod pack') }
}

export async function rejectPack(env: PackEnv, actor: Actor, id: string, body: Record<string, unknown>) {
  need(actor, true)
  const row = await load(env, id)
  if (row.status !== 'proposed' && row.status !== 'failed') throw new HttpError(409, 'This change is not waiting for an approval any more.')
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 300) : ''
  if (!note) throw new HttpError(400, 'Say why, so the change can be fixed.')
  const now = Date.now()
  await env.DB.prepare("UPDATE pack_proposals SET status = 'rejected', decided_by = ?2, decided_at = ?3, decision_note = ?4, updated_at = ?3 WHERE id = ?1").bind(id, actor.profile.id, now, note).run()
  await logActivity(env.DB, actor.profile.id, 'pack.reject', id, { version: row.client_version, note })
  return getPack(env, actor)
}

export async function withdrawPack(env: PackEnv, actor: Actor, id: string) {
  need(actor)
  const row = await load(env, id)
  if (row.proposed_by !== actor.profile.id && !actor.permissions.includes('pack.approve')) throw new HttpError(403, 'Only who proposed it (or an approver) can withdraw it.')
  if (row.status !== 'proposed' && row.status !== 'failed') throw new HttpError(409, 'This change cannot be withdrawn any more.')
  await env.DB.prepare("UPDATE pack_proposals SET status = 'withdrawn', updated_at = ?2 WHERE id = ?1").bind(id, Date.now()).run()
  await logActivity(env.DB, actor.profile.id, 'pack.withdraw', id, { version: row.client_version })
  return getPack(env, actor)
}

/** A config file for the pack (raw bytes): kept until published, addressed by its SHA-512. */
export async function uploadPackFile(env: PackEnv, actor: Actor, req: Request) {
  if (!actor.permissions.includes('pack.propose')) throw new HttpError(403, 'You cannot change the mod pack.')
  const bytes = new Uint8Array(await req.arrayBuffer())
  if (!bytes.length) throw new HttpError(400, 'The file is empty.')
  if (bytes.length > MAX_PACK_FILE) throw new HttpError(413, 'Files of the pack are limited to 1 MB here (configs).')
  const sha512 = await sha512Hex(bytes)
  await env.DB.prepare('INSERT OR IGNORE INTO content_files (path, bytes, sha512, created_at) VALUES (?1, ?2, ?3, ?4)').bind(packFileKey(sha512), bytes, sha512, Date.now()).run()
  return { sha512, size: bytes.length }
}

/** The approved change every publish job carries (until one of them has published it). */
export async function packForJob(db: D1Database): Promise<{ id: string; payload: Record<string, unknown> } | null> {
  const row = await db.prepare("SELECT id, manifest, based_on, previous_can_join FROM pack_proposals WHERE status = 'approved' ORDER BY decided_at DESC LIMIT 1").first<Pick<Row, 'id' | 'manifest' | 'based_on' | 'previous_can_join'>>()
  if (!row) return null
  return { id: row.id, payload: { proposalId: row.id, manifest: JSON.parse(row.manifest), basedOn: JSON.parse(row.based_on), previousCanJoin: Boolean(row.previous_can_join) } }
}

/** Result of a publish job carrying a pack. `part` = what the publisher refused (only a pack refusal fails the pack). */
export async function packJobFinished(db: D1Database, packId: string, result: { commit?: string; error?: string; part?: string }): Promise<void> {
  const now = Date.now()
  if (result.commit) {
    await db.prepare("UPDATE pack_proposals SET status = 'published', commit_sha = ?2, updated_at = ?3 WHERE id = ?1 AND status = 'approved'").bind(packId, result.commit, now).run()
  } else if (result.part === 'pack') {
    // Taken out of the next jobs (the news keep being published); an approver can try again or reject it
    await db.prepare("UPDATE pack_proposals SET status = 'failed', decision_note = ?2, updated_at = ?3 WHERE id = ?1 AND status = 'approved'").bind(packId, String(result.error ?? 'refused').slice(0, 1000), now).run()
  }
}
