import { app, protocol } from 'electron'
import { createDecipheriv, createHash, createPublicKey, verify, type KeyObject } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FEED_V2_SEALED_PATH, FeedV2Schema, VaultItemSchemas, type Background, type FeedV2, type NewsItemV2, type Vault, type VaultKind } from '@shared/feedV2'
import { resolveFeed, type FeedView, type OpenedItems } from '@shared/schedule'
import { HERALD_CONTENT_BASE, HERALD_URL, PULSE_MS, clockOffset, contentAtCommit } from '@shared/herald'
import { fromB64, keyIdOf, unseal, type SealedDocument } from '@shared/sealed'
import { getSettings } from '../settings/settings'
import { backgroundDownloadsAllowed } from '../system/network'
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
 *   · pictures (Herald: news pictures, Home backgrounds) are files next to the feed, checked by SHA-512 and kept: a
 *     scheduled item brings its picture locked with its vault (opened with the same key). The page shows them through
 *     hemi-content://. Backgrounds (big) wait for a normal connection when the player saves data on metered ones.
 * No schema 2 feed published yet → null, and the launcher keeps showing the schema 1 feed.
 * SEALED (S12): nothing in the content repository can be read without the Herald server. The feed arrives sealed
 * (src/shared/sealed.ts); its key is asked for (GET /content-key/<id>) and given only while that feed is online. The
 * opened, verified feed is kept on disk: a launcher that has it keeps showing it when the server cannot be reached.
 */

/** Pictures reach the page through hemi-content://image/<sha512> (only files checked against the signed feed) */
export const CONTENT_SCHEME = 'hemi-content'
const MAX_PICTURE = 2 * 1024 * 1024

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
/** SHA-512 of the pictures checked and kept on disk */
const pictures = new Set<string>()
let lastView = ''
let wakeTimer: NodeJS.Timeout | null = null
let notify: (view: FeedView | null) => void = () => {}

const serverNow = () => Date.now() + offsetMs
/** Signed move of the content (feed.contentBase) wins, then the dev test location, then the dedicated content repository. */
const contentBase = () => feed?.contentBase ?? ((dev() && import.meta.env?.MAIN_VITE_HERALD_CONTENT_BASE) || HERALD_CONTENT_BASE)
/** Where Herald publishes: the mod pack is read there first too (S10) */
export const heraldContentBase = () => contentBase()
const language = () => {
  const l = getSettings().language
  return (l === 'auto' ? app.getLocale() : l).slice(0, 2).toLowerCase()
}

export function getFeedV2View(): FeedView | null {
  if (!feed) return null
  const items: OpenedItems = {}
  for (const { kind, item } of opened.values()) (items[kind] ??= []).push(item)
  const view = resolveFeed(feed, items, serverNow(), language())
  // A picture not downloaded yet: the news shows the built-in screenshot meanwhile
  view.news = view.news.map((n) => {
    const file = (n as NewsItemV2).imageFile
    return file ? { ...n, image: pictures.has(file.sha512) ? `${CONTENT_SCHEME}://image/${file.sha512}` : undefined } : n
  })
  // Home backgrounds: only the pictures already on disk (the built-in ones show meanwhile)
  if (view.backgrounds) view.backgrounds.items = view.backgrounds.items.map((b) => (pictures.has(b.image.sha512) ? { ...b, src: `${CONTENT_SCHEME}://image/${b.image.sha512}` } : b))
  return view
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

/** The key of a sealed file published by Herald (feed, mod pack index), from the Herald server: given only while it
 *  is online (src/shared/sealed.ts). */
export async function contentKey(file: Uint8Array): Promise<Uint8Array> {
  const id = keyIdOf(file)
  if (!id) throw new Error('not a sealed file')
  const sent = Date.now()
  const res = await fetch(`${heraldUrl()}/content-key/${id}`, { signal: AbortSignal.timeout(10_000), cache: 'no-store' })
  const body = (await res.json().catch(() => ({}))) as { key?: string; now?: number }
  if (typeof body.now === 'number') offsetMs = clockOffset(body.now, sent, Date.now())
  if (!res.ok || typeof body.key !== 'string') throw new Error(`key not given (HTTP ${res.status})`)
  return fromB64(body.key)
}

/** A sealed feed (as published): its key from the Herald server, then the signed document inside, checked. */
async function acceptSealed(file: Buffer): Promise<boolean> {
  const sealed = new Uint8Array(file)
  const doc = JSON.parse(new TextDecoder().decode(await unseal(sealed, await contentKey(sealed)))) as SealedDocument
  return accept(Buffer.from(doc.doc, 'utf8'), doc.sig)
}

/** Accepts a verified feed if it is newer; keeps it (opened) for offline starts. */
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

// ------------------------------------------------------------------------------------------------ pictures

const pictureFile = (sha512: string) => join(cacheDir(), 'images', `${sha512}.webp`)
const sha512Of = (b: Buffer) => createHash('sha512').update(b).digest('hex')

/** Pictures of the items shown (news, backgrounds): downloaded once, opened with their key (given by the sealed
 *  feed), checked against the signed feed. */
async function syncPictures(base: string): Promise<void> {
  const news = (feed?.news ?? []).flatMap((n) => (n.imageFile ? [n.imageFile] : []))
  const backgrounds = (feed?.backgrounds ?? []).map((b) => b.image).filter((f) => !pictures.has(f.sha512))
  const bigOk = backgrounds.length ? await backgroundDownloadsAllowed() : false
  for (const f of [...news, ...(bigOk ? backgrounds : [])]) {
    if (pictures.has(f.sha512) || !f.path.startsWith('v2/images/')) continue
    try {
      let bytes = await download(base + f.path, Math.min(f.seal?.size ?? f.size, MAX_PICTURE + 128 * 1024) + 1024)
      if (f.seal) {
        if (sha512Of(bytes) !== f.seal.sha512) throw new Error('file does not match the feed')
        bytes = Buffer.from(await unseal(new Uint8Array(bytes), fromB64(f.seal.key)))
      }
      if (sha512Of(bytes) !== f.sha512) throw new Error('picture does not match the feed')
      await save(`images/${f.sha512}.webp`, bytes)
      pictures.add(f.sha512)
    } catch (err) {
      console.warn(`[feed v2] picture ${f.path}:`, err instanceof Error ? err.message : err)
    }
  }
}

/** A vault's picture (locked with the vault's key): downloaded with the vault, opened with it. */
async function vaultPicture(v: Vault, base: string): Promise<Buffer | null> {
  if (!v.image) return null
  const name = `vaults/${v.id}-img.bin`
  const cached = await readFile(join(cacheDir(), name)).catch(() => null)
  if (cached && sha512Of(cached) === v.image.sha512) return cached
  const bytes = await download(base + v.image.path, Math.min(v.image.size, MAX_PICTURE + 64) + 1024)
  if (sha512Of(bytes) !== v.image.sha512) throw new Error(`vault ${v.id}: picture does not match the feed`)
  await save(name, bytes)
  return bytes
}

async function openVaultPicture(file: Buffer, keyB64: string, item: unknown): Promise<void> {
  const f = (item as NewsItemV2).imageFile ?? (item as Partial<Background>).image
  if (!f || pictures.has(f.sha512)) return
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(keyB64, 'base64'), file.subarray(0, 12))
  decipher.setAuthTag(file.subarray(file.length - 16))
  const plain = Buffer.concat([decipher.update(file.subarray(12, file.length - 16)), decipher.final()])
  if (sha512Of(plain) !== f.sha512) throw new Error('vault picture does not match its item')
  await save(`images/${f.sha512}.webp`, plain)
  pictures.add(f.sha512)
}

/** Must be registered before the app is ready, with the other schemes (all at once). */
export const contentScheme = { scheme: CONTENT_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }

export function serveContentPictures(): void {
  protocol.handle(CONTENT_SCHEME, async (request) => {
    const url = new URL(request.url)
    const sha = url.pathname.replace(/^\//, '')
    if (url.hostname !== 'image' || !/^[0-9a-f]{128}$/.test(sha) || !pictures.has(sha)) return new Response('not found', { status: 404 })
    try {
      return new Response(await readFile(pictureFile(sha)), { headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'max-age=31536000' } })
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
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
      const picture = await vaultPicture(v, base).catch((err) => {
        console.warn('[feed v2]', err instanceof Error ? err.message : err)
        return null
      })
      const opensAt = Date.parse(v.opensAt)
      let k = feed.vaultKeys[v.id] ?? null
      if (!k && serverNow() >= opensAt - 1000) {
        const got = await fetchKey(v.id)
        if (got && 'key' in got) k = got.key
        else later(got ? serverNow() + got.retryInMs + 50 : serverNow() + 30_000)
      } else if (!k) later(opensAt)
      if (!k) continue
      const item = openVaultFile(file, k, v)
      if (picture) await openVaultPicture(picture, k, item).catch((err) => console.warn(`[feed v2] vault ${v.id}:`, err instanceof Error ? err.message : err))
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
      await acceptSealed(await download(pinned + FEED_V2_SEALED_PATH, MAX_FEED))
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
  const url = contentBase() + FEED_V2_SEALED_PATH
  const cached = await readFile(join(cacheDir(), 'feed.json')).catch(() => null)
  const got = await conditionalGet(url, MAX_FEED, cached ? cached.length : null, 15_000)
  if (got.notModified) return
  await acceptSealed(got.bytes)
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
    if (poll) {
      await syncPictures(base)
      emit()
    }
    const next = [retryAt, getFeedV2View()?.nextChangeAt ?? null].filter((t): t is number => t !== null)
    wakeAt(next.length ? Math.min(...next) : null)
  } finally {
    running = false
  }
}

async function loadCache(): Promise<void> {
  for (const name of await readdir(join(cacheDir(), 'images')).catch(() => [] as string[])) {
    const sha = name.replace(/\.webp$/, '')
    if (/^[0-9a-f]{128}$/.test(sha)) pictures.add(sha)
  }
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
