import { app } from 'electron'
import { createDecipheriv, createHash, createPublicKey, verify, type KeyObject } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FEED_V2_PATH, FeedV2Schema, VaultItemSchemas, type FeedV2, type Vault, type VaultKind } from '@shared/feedV2'
import { resolveFeed, type FeedView, type OpenedItems } from '@shared/schedule'
import { HERALD_CONTENT_BASE, HERALD_URL, PULSE_MS, clockOffset, contentAtCommit } from '@shared/herald'
import { getSettings } from '../settings/settings'
import { CONTENT_PUBLIC_KEY } from './publicKey'
import { conditionalGet, rememberEtag } from './conditional'

/**
 * Schema 2 feed (Herald). Same trust model as schema 1: signed with the content key, older sequences refused, last
 * good copy cached (works offline). On top of it:
 *   · every 2 minutes, the Herald server's PULSE says what was published last and in which commit; the feed is then
 *     read at that exact commit (GitHub's 5-minute cache is skipped). Pulse unreachable → normal read of the feed.
 *   · scheduled items arrive early, locked in VAULTS; at the opening time (by the SERVER's clock, learnt from its
 *     answers) the launcher asks for the key, opens the vault and shows the item at once.
 *   · the view is recomputed exactly when something is due (resolveFeed's nextChangeAt), not only every 2 minutes.
 * No schema 2 feed published yet → null, and the launcher keeps showing the schema 1 feed.
 */

const MAX_FEED = 512 * 1024
const dev = () => !app.isPackaged
const heraldUrl = () => ((dev() && import.meta.env?.MAIN_VITE_HERALD_URL) || HERALD_URL).replace(/\/$/, '')
const keyB64 = () => (dev() && import.meta.env?.MAIN_VITE_HERALD_PUBLIC_KEY) || CONTENT_PUBLIC_KEY
/** A test key gets its own cache: test content can never stay behind in the real one (sequence protection). */
const cacheDir = () => join(app.getPath('userData'), 'content-cache', keyB64() === CONTENT_PUBLIC_KEY ? 'v2' : 'v2-test')
let publicKey: KeyObject | null = null
const key = () => (publicKey ??= createPublicKey({ key: Buffer.from(keyB64(), 'base64'), format: 'der', type: 'spki' }))

let feed: FeedV2 | null = null
let offsetMs = 0 // server clock − this PC's clock
const opened = new Map<string, { kind: VaultKind; item: unknown }>()
let lastView = ''
let wakeTimer: NodeJS.Timeout | null = null
let notify: (view: FeedView | null) => void = () => {}

const serverNow = () => Date.now() + offsetMs
/** Signed move of the content (feed.contentBase) wins, then the dev test location, then the dedicated content repository. */
const contentBase = () => feed?.contentBase ?? ((dev() && import.meta.env?.MAIN_VITE_HERALD_CONTENT_BASE) || HERALD_CONTENT_BASE)
const language = () => {
  const l = getSettings().language
  return (l === 'auto' ? app.getLocale() : l).slice(0, 2).toLowerCase()
}

export function getFeedV2View(): FeedView | null {
  if (!feed) return null
  const items: OpenedItems = {}
  for (const { kind, item } of opened.values()) (items[kind] ??= []).push(item)
  return resolveFeed(feed, items, serverNow(), language())
}

// ------------------------------------------------------------------------------------------------ files

async function save(name: string, data: Buffer | string): Promise<void> {
  const path = join(cacheDir(), name)
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(`${path}.tmp`, data)
  await rename(`${path}.tmp`, path)
}

async function download(url: string, maxBytes: number): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000), cache: 'no-store' })
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > maxBytes) throw new Error(`${url}: too large`)
  return buf
}

/** Verifies signature + schema. Pure: same checks for network and cache. */
export function verifyFeedV2(bytes: Buffer, signatureB64: string, k: KeyObject = key()): FeedV2 {
  if (!verify(null, bytes, k, Buffer.from(signatureB64.trim(), 'base64'))) throw new Error('feed v2 signature is invalid')
  return FeedV2Schema.parse(JSON.parse(bytes.toString('utf8')))
}

/** Accepts a verified feed if it is newer; keeps it for offline starts. */
async function accept(bytes: Buffer, sig: string): Promise<boolean> {
  const next = verifyFeedV2(bytes, sig)
  if (feed && next.sequence <= feed.sequence) return false
  await save('feed.json', bytes)
  await save('feed.json.sig', sig)
  feed = next
  return true
}

// ------------------------------------------------------------------------------------------------ vaults

/** Decrypts a vault file (IV 12 bytes · ciphertext · GCM tag 16 bytes) and checks it is THE content of the feed. */
export function openVaultFile(file: Buffer, keyB64: string, vault: Vault): unknown {
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(keyB64, 'base64'), file.subarray(0, 12))
  decipher.setAuthTag(file.subarray(file.length - 16))
  const plain = Buffer.concat([decipher.update(file.subarray(12, file.length - 16)), decipher.final()])
  if (createHash('sha256').update(plain).digest('hex') !== vault.plainSha256) throw new Error(`vault ${vault.id}: content does not match the feed`)
  return VaultItemSchemas[vault.kind].parse(JSON.parse(plain.toString('utf8')))
}

async function vaultFile(v: Vault, base: string): Promise<Buffer> {
  const name = `vaults/${v.id}.bin`
  const cached = await readFile(join(cacheDir(), name)).catch(() => null)
  if (cached && createHash('sha512').update(cached).digest('hex') === v.file.sha512) return cached
  const bytes = await download(base + v.file.path, v.file.size + 1024)
  if (createHash('sha512').update(bytes).digest('hex') !== v.file.sha512) throw new Error(`vault ${v.id}: file does not match the feed`)
  await save(name, bytes)
  return bytes
}

/** Asks the Herald server for a due vault's key. The server's clock decides: "not yet" carries how long to wait. */
async function fetchKey(id: string): Promise<{ key: string } | { retryInMs: number } | null> {
  const sent = Date.now()
  try {
    const res = await fetch(`${heraldUrl()}/vault-key/${id}`, { signal: AbortSignal.timeout(10_000), cache: 'no-store' })
    const body = (await res.json()) as { key?: string; now?: number; retryInMs?: number }
    if (typeof body.now === 'number') offsetMs = clockOffset(body.now, sent, Date.now())
    if (res.status === 200 && typeof body.key === 'string') return { key: body.key }
    if (res.status === 425 && typeof body.retryInMs === 'number') return { retryInMs: body.retryInMs }
  } catch {
    /* offline or server down: the key will come in a later feed (vaultKeys) */
  }
  return null
}

/** Downloads the vaults in advance, opens the due ones. Returns the earliest instant (server clock) to try again. */
async function syncVaults(base: string): Promise<number | null> {
  if (!feed) return null
  let retryAt: number | null = null
  const later = (t: number) => (retryAt = retryAt === null ? t : Math.min(retryAt, t))
  for (const v of feed.vaults) {
    if (opened.has(v.id)) continue
    try {
      const file = await vaultFile(v, base)
      const opensAt = Date.parse(v.opensAt)
      let k = feed.vaultKeys[v.id] ?? null
      if (!k && serverNow() >= opensAt - 1000) {
        const got = await fetchKey(v.id)
        if (got && 'key' in got) k = got.key
        else later(got ? serverNow() + got.retryInMs + 50 : serverNow() + 30_000)
      } else if (!k) later(opensAt)
      if (!k) continue
      const item = openVaultFile(file, k, v)
      opened.set(v.id, { kind: v.kind, item })
      await save(`opened/${v.id}.json`, JSON.stringify({ kind: v.kind, item }))
    } catch (err) {
      console.warn(`[feed v2] vault ${v.id}:`, err instanceof Error ? err.message : err)
      later(serverNow() + 60_000)
    }
  }
  // Forget what the feed no longer lists (removed or replaced items)
  const ids = new Set(feed.vaults.map((v) => v.id))
  for (const id of [...opened.keys()]) if (!ids.has(id)) opened.delete(id)
  return retryAt
}

// ------------------------------------------------------------------------------------------------ polling

/** The pulse first (fresh in seconds), the feed's normal address when the Herald server can't be reached. */
async function refresh(): Promise<string> {
  const sent = Date.now()
  try {
    const res = await fetch(`${heraldUrl()}/pulse`, { signal: AbortSignal.timeout(10_000), cache: 'no-store' })
    if (!res.ok) throw new Error(`pulse: HTTP ${res.status}`)
    const pulse = (await res.json()) as { sequence?: number; commit?: string | null; now?: number }
    if (typeof pulse.now === 'number') offsetMs = clockOffset(pulse.now, sent, Date.now())
    const pinned = pulse.commit ? contentAtCommit(contentBase(), pulse.commit) : null
    if (typeof pulse.sequence === 'number' && pulse.sequence > (feed?.sequence ?? 0)) {
      if (!pinned) throw new Error('pulse: no commit address for this content location')
      await accept(await download(pinned + FEED_V2_PATH, MAX_FEED), (await download(`${pinned}${FEED_V2_PATH}.sig`, 4096)).toString('utf8'))
      return pinned
    }
    return pinned ?? contentBase()
  } catch (err) {
    if (!(err instanceof Error && err.message.includes('signature'))) await readPlain().catch((e) => console.warn('[feed v2]', e instanceof Error ? e.message : e))
    else console.warn('[feed v2]', err.message)
    return contentBase()
  }
}

async function readPlain(): Promise<void> {
  const url = contentBase() + FEED_V2_PATH
  const cached = await readFile(join(cacheDir(), 'feed.json')).catch(() => null)
  const got = await conditionalGet(url, MAX_FEED, cached ? cached.length : null, 15_000)
  if (got.notModified) return
  await accept(got.bytes, (await download(`${url}.sig`, 4096)).toString('utf8'))
  await rememberEtag(url, got.etag)
}

function emit(): void {
  const view = getFeedV2View()
  const json = JSON.stringify(view)
  if (json !== lastView) {
    lastView = json
    notify(view)
  }
}

/** Sleeps until the next due thing (vault opening, scheduled change), on the server's clock. */
function wakeAt(serverTime: number | null): void {
  if (wakeTimer) clearTimeout(wakeTimer)
  wakeTimer = null
  if (serverTime === null) return
  const delay = Math.min(Math.max(serverTime - serverNow(), 200), 60 * 60_000)
  wakeTimer = setTimeout(() => void cycle(false), delay)
}

let running = false
async function cycle(poll: boolean): Promise<void> {
  if (running) return
  running = true
  try {
    const base = poll ? await refresh() : contentBase()
    const retryAt = await syncVaults(base)
    emit()
    const next = [retryAt, getFeedV2View()?.nextChangeAt ?? null].filter((t): t is number => t !== null)
    wakeAt(next.length ? Math.min(...next) : null)
  } finally {
    running = false
  }
}

async function loadCache(): Promise<void> {
  try {
    feed = verifyFeedV2(await readFile(join(cacheDir(), 'feed.json')), await readFile(join(cacheDir(), 'feed.json.sig'), 'utf8'))
  } catch {
    feed = null
    return
  }
  for (const name of await readdir(join(cacheDir(), 'opened')).catch(() => [] as string[])) {
    const id = name.replace(/\.json$/, '')
    const v = feed.vaults.find((x) => x.id === id)
    if (!v) {
      await rm(join(cacheDir(), 'opened', name), { force: true })
      continue
    }
    try {
      const saved = JSON.parse(await readFile(join(cacheDir(), 'opened', name), 'utf8')) as { kind: VaultKind; item: unknown }
      opened.set(id, { kind: v.kind, item: VaultItemSchemas[v.kind].parse(saved.item) })
    } catch {
      /* opened again from the vault file */
    }
  }
}

/** Starts the schema 2 feed: cached copy at once, then the pulse every 2 minutes. `onChange(null)` = no schema 2 feed. */
export async function startFeedV2(onChange: (view: FeedView | null) => void): Promise<void> {
  notify = onChange
  await loadCache()
  emit()
  void cycle(true)
  setInterval(() => void cycle(true), PULSE_MS)
}

/** For a language change: the view may show other news. */
export const refreshFeedV2View = () => emit()
