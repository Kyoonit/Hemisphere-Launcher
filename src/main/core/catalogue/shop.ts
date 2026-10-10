import { app, safeStorage } from 'electron'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { HERALD_URL } from '@shared/herald'
import { fromB64, unseal } from '@shared/sealed'
import type { PlayerSession, ShopBundle, ShopDelivery, ShopError, ShopItem, ShopResult } from '@shared/catalogueShop'
import { getAccountsState, getLaunchCredentials } from '../auth/accounts'
import { heraldUrl } from '../remote/feedV2'

/**
 * The catalogue in the launcher (1.4, step 3c): Patreon models and skins to try on.
 *
 * The list is public (GET /shop) and kept for offline use. An item is given only to a Minecraft account Herald has
 * checked: the launcher "joins" a one-time server id at Mojang with the player's own token (as when joining a
 * Minecraft server), then Herald asks Mojang who joined it; the token never goes to Herald. Herald answers with a
 * player token for 30 days.
 *
 * Each item arrives sealed (AES-GCM envelope), its textures marked for that player. It is kept sealed on disk, per
 * account, and opened in memory only when shown; its key is kept with Windows' protection for this user (Electron
 * safeStorage, DPAPI), so items already seen stay viewable offline while the account's 30-day access lasts. Without
 * that protection keys stay in memory only. A player blocked by staff (a leak) gets nothing more, and what this PC
 * kept for that account is removed as soon as Herald says so.
 */

const MOJANG = 'https://sessionserver.mojang.com'
const TIMEOUT = 15_000
const dev = () => !app.isPackaged
const mojang = () => ((dev() && import.meta.env?.MAIN_VITE_MOJANG_SESSION) || MOJANG).replace(/\/$/, '')
/** a test server gets its own folder: test items never mix with real ones */
const dir = () => join(app.getPath('userData'), heraldUrl() === HERALD_URL ? 'catalogue' : 'catalogue-test')
const itemFile = (uuid: string, id: string, version: number) => join(dir(), 'items', uuid, `${id}-v${version}.bin`)

class Failure extends Error {
  constructor(
    public code: ShopError,
    message: string = code,
  ) {
    super(message)
  }
}

// ------------------------------------------------------------------------------------------------ protected stores

/** A small JSON store encrypted with safeStorage (kept in memory too; never written in clear) */
function protectedStore<T>(name: string) {
  let value: Record<string, T> | null = null
  const file = () => join(dir(), name)
  return {
    async get(): Promise<Record<string, T>> {
      if (value) return value
      value = {}
      if (!safeStorage.isEncryptionAvailable()) return value
      try {
        value = JSON.parse(safeStorage.decryptString(await readFile(file()))) as Record<string, T>
      } catch {
        // none yet, or made by another Windows user: start again
      }
      return value
    },
    async save(): Promise<void> {
      if (!value || !safeStorage.isEncryptionAvailable()) return
      await mkdir(dir(), { recursive: true })
      await writeFile(`${file()}.tmp`, safeStorage.encryptString(JSON.stringify(value)))
      await rename(`${file()}.tmp`, file())
    },
  }
}
const players = protectedStore<{ token: string; expiresAt: number }>('players.bin')
const keys = protectedStore<string>('keys.bin')
const keyName = (uuid: string, id: string, version: number) => `${uuid}/${id}/${version}`

// ------------------------------------------------------------------------------------------------ the server

async function herald<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${heraldUrl()}${path}`, { ...init, cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT) })
  } catch {
    throw new Failure('offline')
  }
  const body = (await res.json().catch(() => ({}))) as T & { error?: string; blocked?: boolean }
  if (res.status === 403 && body.blocked) throw new Failure('blocked', body.error)
  if (res.status === 401) throw new Failure('not-verified', body.error)
  if (res.status === 403) throw new Failure('not-verified', body.error)
  if (res.status === 404) throw new Failure('unknown-item', body.error)
  if (!res.ok) throw new Failure(res.status >= 500 ? 'offline' : 'failed', body.error)
  return body
}

/** The active account, if Herald can check it (a Microsoft account) */
function activeAccount(): { id: string; name: string } {
  const s = getAccountsState()
  const a = s.accounts.find((x) => x.id === s.activeId)
  if (!a || a.kind !== 'microsoft') throw new Failure('needs-microsoft')
  return a
}

/** A player token for this account: kept while valid, else Mojang's check again */
async function playerToken(accountId: string, fresh = false): Promise<string> {
  const store = await players.get()
  const kept = store[accountId]
  if (!fresh && kept && kept.expiresAt > Date.now() + 3_600_000) return kept.token
  let creds
  try {
    creds = await getLaunchCredentials(accountId)
  } catch {
    throw new Failure('not-verified', 'the Microsoft session must be renewed: sign in again')
  }
  if (creds.userType !== 'msa') throw new Failure('needs-microsoft')
  const { serverId } = await herald<{ serverId: string }>('/player/challenge')
  let joined: Response
  try {
    joined = await fetch(`${mojang()}/session/minecraft/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accessToken: creds.accessToken, selectedProfile: creds.uuid, serverId }),
      signal: AbortSignal.timeout(TIMEOUT),
    })
  } catch {
    throw new Failure('offline')
  }
  if (!joined.ok) throw new Failure(joined.status === 403 ? 'not-verified' : 'offline', `Mojang said ${joined.status}`)
  const session = await herald<PlayerSession>('/player/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: creds.name, serverId }) })
  if (session.id !== accountId) throw new Failure('not-verified', 'Mojang answered for another account')
  store[accountId] = { token: session.token, expiresAt: session.expiresAt }
  await players.save()
  return session.token
}

/** Kept copies open while the account's access lasts; once it ends, Herald must give it again (online) */
async function access(accountId: string): Promise<void> {
  const kept = (await players.get())[accountId]
  if (kept && kept.expiresAt > Date.now()) return
  try {
    await playerToken(accountId, true)
  } catch (err) {
    if (err instanceof Failure && err.code === 'offline') throw new Failure('offline', 'the access to the catalogue must be renewed online')
    throw err
  }
}

/** A blocked account: everything kept for it on this PC goes */
async function forget(accountId: string): Promise<void> {
  await rm(join(dir(), 'items', accountId), { recursive: true, force: true })
  const store = await keys.get()
  for (const k of Object.keys(store)) if (k.startsWith(`${accountId}/`)) delete store[k]
  await keys.save()
  delete (await players.get())[accountId]
  await players.save()
}

// ------------------------------------------------------------------------------------------------ list

let listed: ShopItem[] | null = null

const wrap = async <T>(work: () => Promise<T>): Promise<ShopResult<T>> => {
  try {
    return { ok: true, value: await work() }
  } catch (err) {
    if (err instanceof Failure) return { ok: false, error: err.code, message: err.message }
    console.warn('[shop]', err)
    return { ok: false, error: 'failed' }
  }
}

/** The items shown in the launchers; the last list seen when Herald cannot be reached */
export function listShop(): Promise<ShopResult<{ items: ShopItem[]; offline: boolean }>> {
  return wrap(async () => {
    const file = join(dir(), 'shop.json')
    try {
      const { items } = await herald<{ items: ShopItem[] }>('/shop')
      listed = items
      await mkdir(dir(), { recursive: true })
      await writeFile(file, JSON.stringify(items))
      await prune(items)
      return { items, offline: false }
    } catch (err) {
      if (!(err instanceof Failure) || err.code !== 'offline') throw err
      listed ??= JSON.parse(await readFile(file, 'utf8').catch(() => '[]')) as ShopItem[]
      return { items: listed, offline: true }
    }
  })
}

/** Items taken out of the launchers, or replaced by a new version: their copies and keys go */
async function prune(items: ShopItem[]): Promise<void> {
  const current = new Set(items.map((i) => `${i.id}-v${i.version}.bin`))
  const shown = new Set(items.map((i) => i.id))
  const store = await keys.get()
  for (const uuid of await readdir(join(dir(), 'items')).catch(() => [] as string[])) {
    for (const f of await readdir(join(dir(), 'items', uuid)).catch(() => [] as string[])) {
      const m = f.match(/^(c-[a-z0-9]{10})-v(\d+)\.bin$/)
      // a new version of an item still shown replaces the old one when it is opened (offline, the old one stays)
      if (m && (current.has(f) || shown.has(m[1]))) continue
      await rm(join(dir(), 'items', uuid, f), { force: true })
      if (m) delete store[keyName(uuid, m[1], Number(m[2]))]
    }
  }
  await keys.save()
}

/** An item's picture (data: URL), kept on disk */
export function shopThumbnail(id: unknown): Promise<ShopResult<string | null>> {
  return wrap(async () => {
    const item = (listed ?? []).find((i) => i.id === id)
    if (!item?.thumbnail) return null
    const file = join(dir(), 'thumbs', `${item.id}-v${item.version}-${item.publishedAt ?? 0}.webp`)
    let bytes = await readFile(file).catch(() => null)
    if (!bytes) {
      let res: Response
      try {
        res = await fetch(`${heraldUrl()}/shop/thumb/${item.id}`, { signal: AbortSignal.timeout(TIMEOUT) })
      } catch {
        return null
      }
      if (!res.ok) return null
      bytes = Buffer.from(await res.arrayBuffer())
      await mkdir(join(dir(), 'thumbs'), { recursive: true })
      await writeFile(file, bytes)
    }
    return `data:image/webp;base64,${bytes.toString('base64')}`
  })
}

// ------------------------------------------------------------------------------------------------ items

async function open(uuid: string, id: string, version: number): Promise<ShopBundle | null> {
  const key = (await keys.get())[keyName(uuid, id, version)]
  const sealed = key ? await readFile(itemFile(uuid, id, version)).catch(() => null) : null
  if (!key || !sealed) return null
  try {
    const bundle = JSON.parse(new TextDecoder().decode(await unseal(new Uint8Array(sealed), fromB64(key)))) as ShopBundle
    return bundle.format === 1 && bundle.id === id ? bundle : null
  } catch {
    return null
  }
}

/** Another version of this item kept for this account (offline, before the new one could be fetched) */
async function anyKept(uuid: string, id: string): Promise<ShopBundle | null> {
  const files = await readdir(join(dir(), 'items', uuid)).catch(() => [] as string[])
  const versions = files.map((f) => f.match(/^(c-[a-z0-9]{10})-v(\d+)\.bin$/)).filter((m) => m?.[1] === id).map((m) => Number(m![2]))
  for (const v of versions.sort((a, b) => b - a)) {
    const b = await open(uuid, id, v)
    if (b) return b
  }
  return null
}

/** An item for the active account, opened in memory: kept copy, else from Herald (sealed and marked for this player) */
export function shopItem(id: unknown): Promise<ShopResult<ShopBundle>> {
  return wrap(async () => {
    if (typeof id !== 'string' || !/^c-[a-z0-9]{10}$/.test(id)) throw new Failure('unknown-item')
    const account = activeAccount()
    try {
      return await openItem(account, id)
    } catch (err) {
      if (err instanceof Failure && err.code === 'blocked') await forget(account.id)
      throw err
    }
  })
}

/** The item: the kept copy while the access lasts, else from Herald */
async function openItem(account: { id: string }, id: string): Promise<ShopBundle> {
  const item = (listed ?? []).find((i) => i.id === id)
  if (item && (await keys.get())[keyName(account.id, id, item.version)]) {
    await access(account.id)
    const kept = await open(account.id, id, item.version)
    if (kept) return kept
  }
  let delivery: ShopDelivery
  try {
    const get = async (fresh: boolean) => herald<ShopDelivery>(`/shop/${id}`, { headers: { authorization: `Player ${await playerToken(account.id, fresh)}` } })
    delivery = await get(false).catch((err) => (err instanceof Failure && err.code === 'not-verified' ? get(true) : Promise.reject(err)))
  } catch (err) {
    const kept = err instanceof Failure && err.code === 'offline' && (await players.get())[account.id]?.expiresAt > Date.now() ? await anyKept(account.id, id) : null
    if (kept) return kept
    throw err
  }
  const file = itemFile(account.id, id, delivery.version)
  await mkdir(join(dir(), 'items', account.id), { recursive: true })
  await writeFile(file, fromB64(delivery.sealed))
  const store = await keys.get()
  store[keyName(account.id, id, delivery.version)] = delivery.key
  // older versions of this item for this account go
  for (const f of await readdir(join(dir(), 'items', account.id))) {
    const m = f.match(/^(c-[a-z0-9]{10})-v(\d+)\.bin$/)
    if (m && m[1] === id && Number(m[2]) !== delivery.version) {
      await rm(join(dir(), 'items', account.id, f), { force: true })
      delete store[keyName(account.id, id, Number(m[2]))]
    }
  }
  await keys.save()
  const bundle = await open(account.id, id, delivery.version)
  if (!bundle) throw new Failure('failed', 'the item could not be opened')
  return bundle
}
