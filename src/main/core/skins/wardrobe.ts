import { nativeImage } from 'electron'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { OwnedCape, Wardrobe, WardrobeError, WardrobeResult, WardrobeSkin } from '@shared/skins'
import { getAccountsState, getLaunchCredentials } from '../auth/accounts'
import { AuthError } from '../auth/errors'
import { dataUrl, dir, fromMojang, getSkin, isCapePng, isSkinPng, onSkinSeen, texture } from './skins'

/**
 * The wardrobe (launcher 1.4): a library of skins kept on this PC (imported PNGs, skins copied from a player by name),
 * the skins each account wore before (history), and the capes the account owns. A skin from either is put on the
 * account through Minecraft's services, with the account's own session (the player clicks "Wear").
 *
 * Files: userData/skins/wardrobe/<sha256>.png (each picture once), library.json, history-<account>.json.
 */
const MAX_BYTES = 256 * 1024
const MAX_LIBRARY = 200
const MAX_HISTORY = 30
const API = 'https://api.minecraftservices.com/minecraft/profile'

interface Entry {
  hash: string
  name: string
  slim: boolean
  source: WardrobeSkin['source']
  at: number
}

const pics = () => join(dir(), 'wardrobe')
const libraryFile = () => join(dir(), 'library.json')
const historyFile = (id: string) => join(dir(), `history-${id}.json`)
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')
const isHash = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v)

class WardrobeFail extends Error {
  constructor(readonly code: WardrobeError) {
    super(code)
  }
}

async function readList(file: string): Promise<Entry[]> {
  try {
    const list = JSON.parse(await readFile(file, 'utf8')) as Entry[]
    return Array.isArray(list) ? list.filter((e) => isHash(e?.hash)) : []
  } catch {
    return []
  }
}
async function writeList(file: string, list: Entry[]): Promise<void> {
  await mkdir(dir(), { recursive: true })
  await writeFile(`${file}.tmp`, JSON.stringify(list))
  await rename(`${file}.tmp`, file)
}

/** Keeps a skin PNG once, by its SHA-256 */
async function keepPicture(png: Buffer): Promise<string> {
  const hash = sha(png)
  const file = join(pics(), `${hash}.png`)
  if (!existsSync(file)) {
    await mkdir(pics(), { recursive: true })
    await writeFile(`${file}.tmp`, png)
    await rename(`${file}.tmp`, file)
  }
  return hash
}
const picture = async (hash: string): Promise<Buffer | null> => {
  const png = await readFile(join(pics(), `${hash}.png`)).catch(() => null)
  return png && isSkinPng(png) ? png : null
}

/**
 * Slim (Alex) arms: in a 64×64 skin, the 4th column of the right arm (x 54–55, y 20–31) is empty. `rgba` is the
 * decoded picture, 4 bytes per pixel, alpha last.
 */
export function looksSlim(rgba: Buffer, width: number, height: number): boolean {
  if (width !== 64 || height !== 64 || rgba.length < 64 * 64 * 4) return false
  for (let y = 20; y < 32; y++) for (let x = 54; x < 56; x++) if (rgba[(y * 64 + x) * 4 + 3] !== 0) return false
  return true
}
const guessSlim = (png: Buffer): boolean => {
  const img = nativeImage.createFromBuffer(png)
  const { width, height } = img.getSize()
  return looksSlim(img.toBitmap(), width, height)
}

// ---------------------------------------------------------------- history: what each account wore

async function remember(id: string, png: Buffer, slim: boolean): Promise<void> {
  const hash = await keepPicture(png)
  const list = await readList(historyFile(id))
  if (list[0]?.hash === hash && list[0].slim === slim) return // still the same
  const next = [{ hash, name: '', slim, source: 'worn' as const, at: Date.now() }, ...list.filter((e) => e.hash !== hash)].slice(0, MAX_HISTORY)
  await writeList(historyFile(id), next)
}
onSkinSeen((id, png, slim) => remember(id, png, slim).catch((err) => console.warn('[wardrobe] history:', err instanceof Error ? err.message : err)))

// ---------------------------------------------------------------- Minecraft services (the account's own session)

async function services(id: string, path: string, init: RequestInit = {}): Promise<unknown> {
  let token: string
  try {
    token = (await getLaunchCredentials(id)).accessToken
  } catch (err) {
    throw new WardrobeFail(err instanceof AuthError && err.code === 'network' ? 'network' : 'signedOut')
  }
  let res: Response
  try {
    res = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...init.headers }, signal: AbortSignal.timeout(20_000) })
  } catch {
    throw new WardrobeFail('network')
  }
  if (res.status === 401 || res.status === 403) throw new WardrobeFail('signedOut')
  if (res.status === 429) throw new WardrobeFail('tooMany')
  if (!res.ok) throw new WardrobeFail('refused')
  return res.json().catch(() => null)
}

interface McProfile {
  capes?: { id?: string; state?: string; url?: string; alias?: string }[]
}
const capesMemo = new Map<string, { at: number; capes: OwnedCape[] }>()

async function ownedCapes(id: string, profile?: McProfile): Promise<OwnedCape[] | null> {
  const m = capesMemo.get(id)
  if (!profile && m && Date.now() - m.at < 10 * 60_000) return m.capes
  try {
    const p = profile ?? ((await services(id, '')) as McProfile)
    const capes: OwnedCape[] = []
    for (const c of p?.capes ?? []) {
      const hash = typeof c.url === 'string' ? /^https?:\/\/textures\.minecraft\.net\/texture\/([0-9a-f]{16,80})$/.exec(c.url)?.[1] : null
      if (!hash || typeof c.id !== 'string') continue
      const png = await texture(hash, isCapePng).catch(() => null)
      if (png) capes.push({ id: c.id, name: typeof c.alias === 'string' ? c.alias : '', active: c.state === 'ACTIVE', cape: dataUrl(png) })
    }
    capesMemo.set(id, { at: Date.now(), capes })
    return capes
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- the wardrobe

const view = async (list: Entry[]): Promise<WardrobeSkin[]> => {
  const out: WardrobeSkin[] = []
  for (const e of list) {
    const png = await picture(e.hash)
    if (png) out.push({ hash: e.hash, name: e.name, slim: !!e.slim, source: e.source, at: e.at, skin: dataUrl(png) })
  }
  return out
}

const activeAccount = () => {
  const s = getAccountsState()
  return s.accounts.find((a) => a.id === s.activeId) ?? null
}

/** The wardrobe of the active account; `capes` asks Mojang for the capes it owns (kept 10 minutes) */
export async function getWardrobe(capes = true): Promise<Wardrobe> {
  const account = activeAccount()
  const canChange = account?.kind === 'microsoft' && account.status !== 'expired'
  return {
    library: await view(await readList(libraryFile())),
    history: account ? await view(await readList(historyFile(account.id))) : [],
    capes: canChange && capes ? await ownedCapes(account.id) : null,
    canChange,
  }
}

const done = async (added?: string): Promise<WardrobeResult> => ({ ok: true, wardrobe: await getWardrobe(), ...(added ? { added } : {}) })
const failed = (err: unknown): WardrobeResult => {
  if (err instanceof WardrobeFail) return { ok: false, error: err.code }
  console.warn('[wardrobe]', err instanceof Error ? err.message : err)
  return { ok: false, error: 'network' }
}

async function addToLibrary(png: Buffer, name: string, source: Entry['source'], slim: boolean): Promise<string> {
  if (png.length > MAX_BYTES || !isSkinPng(png)) throw new WardrobeFail('notSkin')
  const list = await readList(libraryFile())
  const hash = await keepPicture(png)
  if (!list.some((e) => e.hash === hash)) {
    if (list.length >= MAX_LIBRARY) throw new WardrobeFail('full')
    list.unshift({ hash, name: name.trim().slice(0, 32) || 'Skin', slim, source, at: Date.now() })
    await writeList(libraryFile(), list)
  }
  return hash
}

/** A PNG chosen by the player (64×64 or 64×32); slim arms are recognised */
export async function importFile(path: string): Promise<WardrobeResult> {
  try {
    const info = await stat(path)
    if (!info.isFile() || info.size > MAX_BYTES) throw new WardrobeFail('notSkin')
    const png = await readFile(path)
    if (!isSkinPng(png)) throw new WardrobeFail('notSkin')
    return done(await addToLibrary(png, basename(path).replace(/\.png$/i, ''), 'file', guessSlim(png)))
  } catch (err) {
    return failed(err)
  }
}

/** The skin a player wears now, by their name (public: Mojang's profile lookup and session server) */
export async function importPlayer(name: unknown): Promise<WardrobeResult> {
  if (typeof name !== 'string' || !/^[A-Za-z0-9_]{1,16}$/.test(name.trim())) return { ok: false, error: 'noPlayer' }
  try {
    let res: Response
    try {
      res = await fetch(`https://api.mojang.com/users/profiles/minecraft/${name.trim()}`, { signal: AbortSignal.timeout(15_000) })
    } catch {
      throw new WardrobeFail('network')
    }
    if (res.status === 204 || res.status === 404) throw new WardrobeFail('noPlayer')
    if (res.status === 429) throw new WardrobeFail('tooMany')
    if (!res.ok) throw new WardrobeFail('network')
    const who = (await res.json()) as { id?: string; name?: string }
    if (typeof who.id !== 'string' || !/^[0-9a-f]{32}$/.test(who.id)) throw new WardrobeFail('noPlayer')
    const known = await fromMojang(who.id).catch(() => {
      throw new WardrobeFail('network')
    })
    const png = await texture(known.skin, isSkinPng)
    return done(await addToLibrary(png, typeof who.name === 'string' ? who.name : name, 'player', known.slim))
  } catch (err) {
    return failed(err)
  }
}

/** Rename a library skin, or set its arms (slim/classic) */
export async function editSkin(hash: unknown, patch: { name?: unknown; slim?: unknown }): Promise<WardrobeResult> {
  if (!isHash(hash)) return { ok: false, error: 'refused' }
  const list = await readList(libraryFile())
  const e = list.find((x) => x.hash === hash)
  if (!e) return { ok: false, error: 'refused' }
  if (typeof patch.name === 'string' && patch.name.trim()) e.name = patch.name.trim().slice(0, 32)
  if (typeof patch.slim === 'boolean') e.slim = patch.slim
  await writeList(libraryFile(), list)
  return done()
}

/** A skin the account wore, kept in the library */
export async function keepFromHistory(hash: unknown, name: unknown): Promise<WardrobeResult> {
  const account = activeAccount()
  const e = account && isHash(hash) ? (await readList(historyFile(account.id))).find((x) => x.hash === hash) : null
  const png = e ? await picture(e.hash) : null
  if (!e || !png) return { ok: false, error: 'refused' }
  try {
    return done(await addToLibrary(png, typeof name === 'string' ? name : '', 'worn', e.slim))
  } catch (err) {
    return failed(err)
  }
}

/** Out of the library; the picture is deleted when no history uses it either */
export async function removeSkin(hash: unknown): Promise<WardrobeResult> {
  if (!isHash(hash)) return { ok: false, error: 'refused' }
  await writeList(libraryFile(), (await readList(libraryFile())).filter((e) => e.hash !== hash))
  const histories = (await readdir(dir()).catch(() => [] as string[])).filter((f) => /^history-[0-9a-f]{32}\.json$/.test(f))
  let used = false
  for (const f of histories) if ((await readList(join(dir(), f))).some((e) => e.hash === hash)) used = true
  if (!used) await unlink(join(pics(), `${hash}.png`)).catch(() => {})
  return done()
}

/** Puts a wardrobe skin (library or history) on the active account, with these arms */
export async function wearSkin(hash: unknown, slim: unknown): Promise<WardrobeResult> {
  const account = activeAccount()
  if (!account || account.kind !== 'microsoft') return { ok: false, error: 'signedOut' }
  const png = isHash(hash) ? await picture(hash) : null
  if (!png) return { ok: false, error: 'refused' }
  try {
    const form = new FormData()
    form.append('variant', slim === true ? 'slim' : 'classic')
    form.append('file', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'skin.png')
    await services(account.id, '/skins', { method: 'POST', body: form })
    await getSkin(account.id, true) // Home and the viewer show it at once (and the history gets it)
    return done()
  } catch (err) {
    return failed(err)
  }
}

/** Shows one of the account's capes, or none (null) */
export async function wearCape(capeId: unknown): Promise<WardrobeResult> {
  const account = activeAccount()
  if (!account || account.kind !== 'microsoft') return { ok: false, error: 'signedOut' }
  if (capeId !== null && (typeof capeId !== 'string' || !/^[0-9a-f-]{8,64}$/i.test(capeId))) return { ok: false, error: 'refused' }
  try {
    const profile = (await services(
      account.id,
      '/capes/active',
      capeId === null ? { method: 'DELETE' } : { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ capeId }) },
    )) as McProfile | null
    capesMemo.delete(account.id)
    if (profile?.capes) await ownedCapes(account.id, profile)
    await getSkin(account.id, true)
    return done()
  } catch (err) {
    return failed(err)
  }
}
