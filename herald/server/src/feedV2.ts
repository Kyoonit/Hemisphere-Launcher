/**
 * Schema 2 publishing on the server side: every item whose time has not come yet is LOCKED in a vault (its own AES
 * key, kept wrapped in D1 until the opening time) and only the vault is listed in the feed. No validation here (CPU
 * budget): the publisher validates the whole feed with the shared schema before signing, and refuses with a reason.
 */
import { sealVault, toB64, unwrapKey, wrapKey } from './crypto'

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
export interface PublishFile {
  path: string
  b64: string
  sha512: string
}

/** Where each kind lives in the draft, and which time opens it. */
const LISTS = [
  ['news', 'news', (x: Item) => x.showFrom],
  ['maintenances', 'maintenance', (x: Item) => x.announceFrom ?? x.start],
  ['events', 'event', (x: Item) => x.showFrom],
  ['banners', 'banner', (x: Item) => x.showFrom],
  ['welcome', 'welcome', (x: Item) => x.showFrom],
  ['backgrounds', 'background', (x: Item) => x.showFrom],
] as const

/** Locks the future items of a draft; returns the feed body (without schema/sequence/updatedAt) and the vault files. */
export async function sealFuture(db: D1Database, master: string, draft: FeedDraft, now: number): Promise<{ feed: Record<string, unknown>; files: PublishFile[] }> {
  const feed: Record<string, unknown> = { ...draft, vaults: [], vaultKeys: {} }
  const vaults: unknown[] = []
  const files: PublishFile[] = []
  const lock = async (kind: string, item: unknown, opensAt: string) => {
    const id = `v-${crypto.randomUUID().slice(0, 18)}`
    const sealed = await sealVault(new TextEncoder().encode(JSON.stringify(item)))
    const path = `v2/vaults/${id}.bin`
    await db.prepare('INSERT INTO vaults (id, opens_at, key_wrapped, kind) VALUES (?1, ?2, ?3, ?4)').bind(id, Date.parse(opensAt), await wrapKey(sealed.key, master), kind).run()
    vaults.push({ id, kind, opensAt, file: { path, sha512: sealed.sha512, size: sealed.file.length }, plainSha256: sealed.plainSha256 })
    files.push({ path, b64: toB64(sealed.file), sha512: sealed.sha512 })
  }
  const future = (iso: unknown) => typeof iso === 'string' && Date.parse(iso) > now

  for (const [list, kind, opens] of LISTS) {
    const items = (draft[list] ?? []) as Item[]
    const clear: Item[] = []
    for (const item of items) {
      const at = opens(item)
      if (future(at)) await lock(kind, item, at as string)
      else clear.push(item)
    }
    feed[list] = clear
  }
  if (draft.restart) {
    const rules = draft.restart.rules ?? []
    const later = rules.filter((r) => future(r.from))
    const clear = rules.filter((r) => !future(r.from))
    if (!clear.length && later.length) clear.push(later.shift()!) // a feed always has one rule in clear
    for (const r of later) await lock('restartRule', r, r.from as string)
    feed.restart = { rules: clear, exceptions: draft.restart.exceptions ?? [] }
  }
  feed.vaults = vaults
  return { feed, files }
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
