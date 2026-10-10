import { app } from 'electron'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SkinInfo } from '@shared/skins'
import { getAccountsState } from '../auth/accounts'

/**
 * An account's skin and cape, for the 3D views (launcher 1.4). Asked to Mojang's session server (public, by UUID),
 * the textures downloaded from Mojang's texture server only, checked (PNG, Minecraft sizes) and kept in
 * userData/skins/ by hash, with the last known skin of each account: Home shows it offline too.
 */
const FRESH_MS = 10 * 60_000
const MAX_BYTES = 256 * 1024
/** Mojang's default skin (Steve), for offline test accounts and when nothing is known yet */
const STEVE = '31f477eb1a7beee631c2ca64d06f8f68fa93a3386d04452ab27f43acdf1b60cb'

export const dir = () => join(app.getPath('userData'), 'skins')
const memo = new Map<string, { at: number; info: SkinInfo }>()

/** Texture hash of a Mojang texture URL (the session server gives http:// URLs: always fetched over https) */
const textureHash = (url: unknown): string | null => (typeof url === 'string' ? (/^https?:\/\/textures\.minecraft\.net\/texture\/([0-9a-f]{16,80})$/.exec(url)?.[1] ?? null) : null)

/** Width and height of a PNG, or null when it isn't one */
export function pngSize(b: Buffer): { width: number; height: number } | null {
  if (b.length < 24 || !b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) || b.toString('ascii', 12, 16) !== 'IHDR') return null
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
}
/** A skin is 64×64 (or 64×32, the old format); a cape 64×32 or a larger multiple (HD capes) */
export const isSkinPng = (b: Buffer) => {
  const s = pngSize(b)
  return !!s && s.width === 64 && (s.height === 64 || s.height === 32)
}
export const isCapePng = (b: Buffer) => {
  const s = pngSize(b)
  return !!s && s.width >= 22 && s.width <= 1024 && s.height >= 17 && s.height <= 512 && s.width % 2 === 0
}

/** A Mojang texture by hash, kept on disk; refused when `check` fails */
export async function texture(hash: string, check: (b: Buffer) => boolean): Promise<Buffer> {
  const file = join(dir(), `${hash}.png`)
  if (existsSync(file)) {
    const kept = await readFile(file)
    if (check(kept)) return kept
  }
  const res = await fetch(`https://textures.minecraft.net/texture/${hash}`, { signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`texture ${hash.slice(0, 8)}: HTTP ${res.status}`)
  const bytes = Buffer.from(await res.arrayBuffer())
  if (bytes.length > MAX_BYTES || !check(bytes)) throw new Error(`texture ${hash.slice(0, 8)}: not a Minecraft texture`)
  await mkdir(dir(), { recursive: true })
  await writeFile(`${file}.tmp`, bytes)
  await rename(`${file}.tmp`, file)
  return bytes
}

export const dataUrl = (b: Buffer) => `data:image/png;base64,${b.toString('base64')}`

export interface Known {
  skin: string
  slim: boolean
  cape: string | null
}

/** Told about each skin an account is seen wearing (the wardrobe's history) */
let seen: ((id: string, png: Buffer, slim: boolean) => Promise<void>) | null = null
export const onSkinSeen = (cb: typeof seen) => (seen = cb)

async function build(id: string, k: Known, fallback: boolean, fresh = false): Promise<SkinInfo> {
  const cape = k.cape ? await texture(k.cape, isCapePng).catch(() => null) : null
  const skin = await texture(k.skin, isSkinPng)
  if (fresh) await seen?.(id, skin, k.slim) // what Mojang says now (not the skin kept for offline)
  return { id, skin: dataUrl(skin), slim: k.slim, cape: cape ? dataUrl(cape) : null, fallback }
}

/** Skin, model and cape of any player (public, by UUID), from Mojang's session server */
export async function fromMojang(id: string): Promise<Known> {
  const res = await fetch(`https://sessionserver.mojang.com/session/minecraft/profile/${id}`, { signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`profile: HTTP ${res.status}`)
  const profile = (await res.json()) as { properties?: { name?: string; value?: string }[] }
  const value = profile.properties?.find((p) => p.name === 'textures')?.value
  const tex = value ? (JSON.parse(Buffer.from(value, 'base64').toString('utf8')) as { textures?: { SKIN?: { url?: string; metadata?: { model?: string } }; CAPE?: { url?: string } } }) : {}
  return { skin: textureHash(tex.textures?.SKIN?.url) ?? STEVE, slim: tex.textures?.SKIN?.metadata?.model === 'slim', cape: textureHash(tex.textures?.CAPE?.url) }
}

/**
 * The skin of an account (default: the active one). Mojang is asked at most every 10 minutes per account (`refresh`
 * asks again, e.g. after the skin was changed); offline, the last known one is used. Null when there's no account.
 */
export async function getSkin(id?: string, refresh = false): Promise<SkinInfo | null> {
  const state = getAccountsState()
  const account = state.accounts.find((a) => a.id === (id ?? state.activeId))
  if (!account) return null
  if (account.kind === 'offline') return build(account.id, { skin: STEVE, slim: false, cape: null }, true)
  const m = memo.get(account.id)
  if (m && !refresh && Date.now() - m.at < FRESH_MS) return m.info
  const knownFile = join(dir(), `${account.id}.json`)
  try {
    const known = await fromMojang(account.id)
    const info = await build(account.id, known, false, true)
    await mkdir(dir(), { recursive: true })
    await writeFile(knownFile, JSON.stringify(known))
    memo.set(account.id, { at: Date.now(), info })
    return info
  } catch (err) {
    console.warn('[skins] using the last known skin:', err instanceof Error ? err.message : err)
    try {
      const k = JSON.parse(await readFile(knownFile, 'utf8')) as Known
      if (/^[0-9a-f]{16,80}$/.test(k.skin)) return await build(account.id, { skin: k.skin, slim: !!k.slim, cape: k.cape && /^[0-9a-f]{16,80}$/.test(k.cape) ? k.cape : null }, false)
    } catch {
      /* nothing kept yet */
    }
    return build(account.id, { skin: STEVE, slim: false, cape: null }, true).catch(() => null)
  }
}

const players = new Map<string, { at: number; info: SkinInfo }>()

/**
 * The skin of any player (the server's player cards), by UUID: asked to Mojang at most every 10 minutes per player.
 * Bots and unknown players wear Steve. Never told to the wardrobe (not the user's accounts).
 */
export async function getPlayerSkin(uuid: unknown): Promise<SkinInfo | null> {
  const id = typeof uuid === 'string' ? uuid.replace(/-/g, '').toLowerCase() : ''
  if (!/^[0-9a-f]{32}$/.test(id)) return null
  const m = players.get(id)
  if (m && Date.now() - m.at < FRESH_MS) return m.info
  // offline-mode ids (version 3) are not Mojang accounts
  const known = id[12] === '4' ? await fromMojang(id).catch(() => null) : null
  const info = await build(id, known ?? { skin: STEVE, slim: false, cape: null }, !known).catch(() => null)
  if (info) {
    if (players.size > 200) players.clear()
    players.set(id, { at: Date.now(), info })
  }
  return info
}
