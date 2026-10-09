/**
 * Schema 2 publishing on the server side: every item whose time has not come yet is LOCKED in a vault (its own AES
 * key, kept wrapped in D1 until the opening time) and only the vault is listed in the feed. A news picture goes with
 * its item: locked with the same key when the news is scheduled, in clear (v2/images/) otherwise.
 * No validation here (CPU budget): the publisher validates the whole feed with the shared schema before signing.
 *
 * Files are kept in D1 (content_files) and fetched by the publisher by path; files already in the content
 * repository are not sent again. A vault is reused while its item, content and opening time do not change.
 */
import { sealVault, sealWithKey, sha256Hex, sha512Hex, toB64, unwrapKey, wrapKey } from './crypto'

type Item = Record<string, unknown> & { id?: string }
export type FeedDraft = Record<string, unknown> & {
  news?: Item[]
  maintenances?: Item[]
  events?: Item[]
  banners?: Item[]
  welcome?: Item[]
  backgrounds?: Item[]
  restart?: { rules?: Item[]; exceptions?: Item[] } | null
}
/** A file the publish job writes next to the feed (its bytes: content_files, by path) */
export interface PublishFile {
  path: string
  sha512: string
  size: number
}
type ContentFile = { path: string; sha512: string; size: number }

/** Where each kind lives in the draft, and which time opens it. */
const LISTS = [
  ['news', 'news', (x: Item) => x.showFrom],
  ['maintenances', 'maintenance', (x: Item) => x.announceFrom ?? x.start],
  ['events', 'event', (x: Item) => x.showFrom],
  ['banners', 'banner', (x: Item) => x.showFrom],
  ['welcome', 'welcome', (x: Item) => x.showFrom],
  ['backgrounds', 'background', (x: Item) => x.showFrom],
] as const

const utf8 = (s: string) => new TextEncoder().encode(s)
const imageId = (path: string) => path.match(/^v2\/images\/([0-9a-f]{64})\.webp$/)?.[1] ?? null

async function keepFile(db: D1Database, path: string, bytes: Uint8Array, sha512: string, now: number): Promise<void> {
  await db.prepare('INSERT OR IGNORE INTO content_files (path, bytes, sha512, created_at) VALUES (?1, ?2, ?3, ?4)').bind(path, bytes, sha512, now).run()
}

/** Locks the future items of a draft; returns the feed body (without schema/sequence/updatedAt) and its files. */
export async function sealFuture(db: D1Database, master: string, draft: FeedDraft, now: number): Promise<{ feed: Record<string, unknown>; files: PublishFile[] }> {
  const feed: Record<string, unknown> = { ...draft, vaults: [], vaultKeys: {} }
  const vaults: unknown[] = []
  const files = new Map<string, PublishFile>()
  const addFile = (f: ContentFile) => files.set(f.path, { path: f.path, sha512: f.sha512, size: f.size })

  const lock = async (kind: string, item: Item, opensAt: string, itemKey: string) => {
    const opens = Date.parse(opensAt)
    const hash = await sha256Hex(utf8(`${opensAt}\n${JSON.stringify(item)}`))
    const reused = await db.prepare('SELECT listing FROM vaults WHERE item_key = ?1 AND plain_sha256 = ?2 AND opens_at = ?3 AND listing IS NOT NULL').bind(itemKey, hash, opens).first<{ listing: string }>()
    if (reused) {
      const listing = JSON.parse(reused.listing) as { file: ContentFile; image?: ContentFile }
      addFile(listing.file)
      if (listing.image) addFile(listing.image)
      vaults.push(listing)
      return
    }
    const id = `v-${crypto.randomUUID().slice(0, 18)}`
    const key = crypto.getRandomValues(new Uint8Array(32))
    let content: Item = item
    let image: ContentFile | undefined
    // A scheduled news picture is locked with the same key: nobody sees it before its time either
    const pic = item.imageFile as ContentFile | undefined
    const picId = pic ? imageId(pic.path) : null
    if (pic && picId) {
      const row = await db.prepare('SELECT bytes FROM images WHERE id = ?1').bind(picId).first<{ bytes: ArrayBuffer }>()
      if (!row) throw new Error(`picture ${picId} is missing`)
      const sealedPic = await sealWithKey(new Uint8Array(row.bytes), key)
      image = { path: `v2/vaults/${id}-img.bin`, sha512: await sha512Hex(sealedPic), size: sealedPic.length }
      await keepFile(db, image.path, sealedPic, image.sha512, now)
      content = { ...item, imageFile: { path: image.path, sha512: pic.sha512, size: pic.size } }
    }
    const sealed = await sealVault(utf8(JSON.stringify(content)), key)
    const file = { path: `v2/vaults/${id}.bin`, sha512: sealed.sha512, size: sealed.file.length }
    await keepFile(db, file.path, sealed.file, sealed.sha512, now)
    const listing = { id, kind, opensAt, file, plainSha256: sealed.plainSha256, ...(image ? { image } : {}) }
    await db.prepare('INSERT INTO vaults (id, opens_at, key_wrapped, kind, item_key, plain_sha256, listing) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
      .bind(id, opens, await wrapKey(key, master), kind, itemKey, hash, JSON.stringify(listing))
      .run()
    addFile(file)
    if (image) addFile(image)
    vaults.push(listing)
  }
  const future = (iso: unknown) => typeof iso === 'string' && Date.parse(iso) > now

  for (const [list, kind, opens] of LISTS) {
    const items = (draft[list] ?? []) as Item[]
    const clear: Item[] = []
    for (const item of items) {
      const at = opens(item)
      if (future(at)) await lock(kind, item, at as string, `${kind}:${item.id}`)
      else clear.push(item)
    }
    feed[list] = clear
  }
  // Pictures of the news already shown: in clear, next to the feed
  for (const n of feed.news as Item[]) {
    const pic = n.imageFile as ContentFile | undefined
    const picId = pic ? imageId(pic.path) : null
    if (!pic || !picId) continue
    await db.prepare('INSERT OR IGNORE INTO content_files (path, bytes, sha512, created_at) SELECT ?1, bytes, sha512, ?2 FROM images WHERE id = ?3').bind(pic.path, now, picId).run()
    addFile(pic)
  }
  if (draft.restart) {
    const rules = draft.restart.rules ?? []
    const later = rules.filter((r) => future(r.from))
    const clear = rules.filter((r) => !future(r.from))
    if (!clear.length && later.length) clear.push(later.shift()!) // a feed always has one rule in clear
    for (const r of later) await lock('restartRule', r, r.from as string, `restartRule:${r.from}`)
    feed.restart = { rules: clear, exceptions: draft.restart.exceptions ?? [] }
  }
  feed.vaults = vaults
  return { feed, files: [...files.values()] }
}

/** Keys of the vaults of this feed that are open now (by the server clock): the fallback published in `vaultKeys`. */
export async function openKeys(db: D1Database, master: string, feed: Record<string, unknown>, now: number): Promise<Record<string, string>> {
  const keys: Record<string, string> = {}
  for (const v of (feed.vaults ?? []) as { id: string; opensAt: string }[]) {
    if (Date.parse(v.opensAt) > now) continue
    const row = await db.prepare('SELECT key_wrapped FROM vaults WHERE id = ?1').bind(v.id).first<{ key_wrapped: string }>()
    if (row) keys[v.id] = toB64(await unwrapKey(row.key_wrapped, master))
  }
  return keys
}

/** The files a feed lists (vault files, vault pictures, pictures of news in clear) */
export function listedFiles(feed: Record<string, unknown>): PublishFile[] {
  const out: PublishFile[] = []
  for (const v of (feed.vaults ?? []) as { file: ContentFile; image?: ContentFile }[]) out.push(v.file, ...(v.image ? [v.image] : []))
  for (const n of (feed.news ?? []) as Item[]) if (n.imageFile) out.push(n.imageFile as ContentFile)
  return out.map(({ path, sha512, size }) => ({ path, sha512, size }))
}
