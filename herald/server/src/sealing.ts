/**
 * Sealed content (go-live, S12): nothing published can be read from the public content repository or its history.
 *   · CONTENT KEYS seal the feed and the mod pack index (one per publication): made when the publisher takes a job,
 *     given to launchers (GET /content-key/<id>) only once published, and refused 15 minutes after being replaced —
 *     the copies left in the history can never be opened again.
 *   · Pictures and pack config files are sealed with keys DERIVED from the master secret (same file → same bytes,
 *     never uploaded twice); their keys travel inside the sealed feed / manifest, never in clear.
 * Format: src/shared/sealed.ts.
 */
import { seal, sha512Hex, toB64 } from '../../../src/shared/sealed.ts'
import { fromB64, unwrapKey, wrapKey } from './crypto'

/** How long a replaced key is still given (a launcher that read the previous pulse a moment ago) */
export const KEY_GRACE_MS = 15 * 60_000

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('')

/** HMAC-SHA-256 of a label with the master secret: deterministic keys, IVs and names (never guessable without it) */
async function derive(master: string, label: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', fromB64(master) as Uint8Array<ArrayBuffer>, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(label)))
}

type SealedFile = { path: string; key: string; sha512: string; size: number }

/** Seals a file with its own derived key (kept in content_files under `storeAs`); computed once, then read back. */
async function sealedOnce(db: D1Database, master: string, storeAs: string, label: string, plain: () => Promise<Uint8Array>, now: number, padTo: number): Promise<{ key: string; sha512: string; size: number }> {
  const key = await derive(master, `${label}:key`)
  const kept = await db.prepare('SELECT sha512, length(bytes) AS size FROM content_files WHERE path = ?1').bind(storeAs).first<{ sha512: string; size: number }>()
  if (kept) return { key: toB64(key), sha512: kept.sha512, size: kept.size }
  const iv = (await derive(master, `${label}:iv`)).subarray(0, 12)
  const bytes = await seal(await plain(), key, 'f', padTo, iv)
  const sha512 = await sha512Hex(bytes)
  await db.prepare('INSERT OR IGNORE INTO content_files (path, bytes, sha512, created_at) VALUES (?1, ?2, ?3, ?4)').bind(storeAs, bytes, sha512, now).run()
  return { key: toB64(key), sha512, size: bytes.length }
}

/** A picture in clear in the feed → sealed file v2/images/<random-looking name>.bin and its key */
export async function sealedPicture(db: D1Database, master: string, imageId: string, now: number): Promise<SealedFile> {
  const path = `v2/images/${hex(await derive(master, `image:${imageId}:name`)).slice(0, 32)}.bin`
  const s = await sealedOnce(db, master, path, `image:${imageId}`, async () => {
    const row = await db.prepare('SELECT bytes FROM images WHERE id = ?1').bind(imageId).first<{ bytes: ArrayBuffer }>()
    if (!row) throw new Error(`picture ${imageId} is missing`)
    return new Uint8Array(row.bytes)
  }, now, 64 * 1024)
  return { path, ...s }
}

/** A pack config file (sent by Herald) → sealed, kept as pack/<sha>.bin for the publisher; its address in the repository */
export async function sealedPackFile(db: D1Database, master: string, plain: Uint8Array, plainSha512: string, now: number): Promise<{ repoPath: string; key: string; sha512: string; size: number }> {
  const repoPath = `clients/files/${hex(await derive(master, `pack:${plainSha512}:name`)).slice(0, 32)}.bin`
  const s = await sealedOnce(db, master, `pack/${plainSha512.slice(0, 64)}.bin`, `pack:${plainSha512}`, async () => plain, now, 16 * 1024)
  return { repoPath, ...s }
}

/** The key and repository address a config file gets (to check a proposal without its bytes) */
export async function packFileSeal(master: string, plainSha512: string): Promise<{ repoPath: string; key: string }> {
  return { repoPath: `clients/files/${hex(await derive(master, `pack:${plainSha512}:name`)).slice(0, 32)}.bin`, key: toB64(await derive(master, `pack:${plainSha512}:key`)) }
}

// ------------------------------------------------------------------------------------------------ content keys

const newId = (kind: string) => `${kind}-${hex(crypto.getRandomValues(new Uint8Array(12)))}`

/** A new content key (not given to anyone until the publication that uses it is done) */
export async function newContentKey(db: D1Database, master: string, kind: 'feed' | 'pack', now: number): Promise<{ id: string; key: string }> {
  const key = crypto.getRandomValues(new Uint8Array(32))
  const id = newId(kind)
  await db.prepare('INSERT INTO content_keys (id, kind, key_wrapped, created_at) VALUES (?1, ?2, ?3, ?4)').bind(id, kind, await wrapKey(key, master), now).run()
  return { id, key: toB64(key) }
}

/** The pack key in force (to read the sealed index already in the repository) */
export async function currentPackKey(db: D1Database, master: string): Promise<{ id: string; key: string } | null> {
  const row = await db.prepare("SELECT id, key_wrapped FROM content_keys WHERE kind = 'pack' AND published_at IS NOT NULL AND retired_at IS NULL ORDER BY published_at DESC LIMIT 1").first<{ id: string; key_wrapped: string }>()
  return row ? { id: row.id, key: toB64(await unwrapKey(row.key_wrapped, master)) } : null
}

/** A publication is done: its keys are given from now on, the ones they replace are retired. */
export async function publishKeys(db: D1Database, ids: string[], now: number): Promise<void> {
  for (const id of ids) {
    const row = await db.prepare('SELECT kind FROM content_keys WHERE id = ?1').bind(id).first<{ kind: string }>()
    if (!row) continue
    await db.batch([
      db.prepare('UPDATE content_keys SET published_at = ?2 WHERE id = ?1 AND published_at IS NULL').bind(id, now),
      db.prepare('UPDATE content_keys SET retired_at = ?3 WHERE kind = ?2 AND id != ?1 AND published_at IS NOT NULL AND retired_at IS NULL').bind(id, row.kind, now),
    ])
  }
}

/** GET /content-key/<id> (public, like the vault keys): only for what is online now (or replaced moments ago) */
export async function contentKey(db: D1Database, master: string, id: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const now = Date.now()
  const row = await db.prepare('SELECT key_wrapped, published_at, retired_at FROM content_keys WHERE id = ?1').bind(id).first<{ key_wrapped: string; published_at: number | null; retired_at: number | null }>()
  if (!row || row.published_at === null) return { status: 404, body: { error: 'unknown key', now } }
  if (row.retired_at !== null && now - row.retired_at > KEY_GRACE_MS) return { status: 410, body: { error: 'replaced', now } }
  return { status: 200, body: { key: toB64(await unwrapKey(row.key_wrapped, master)), now } }
}
