/**
 * The catalogue in the launchers (launcher 1.4, step 3c).
 *   GET  /player/challenge   a one-time server id; the launcher "joins" it at Mojang with the player's own token
 *   POST /player/verify      Herald asks Mojang (hasJoined) who joined it → a player token for 30 days. The launcher
 *                            never sends its Microsoft or Minecraft token here: Minecraft servers check players this way.
 *   GET  /shop               PUBLIC: the items shown in the launchers
 *   GET  /shop/thumb/<id>    PUBLIC: an item's picture
 *   GET  /shop/<id>          a verified player: the item sealed, its textures marked with that player's tag
 *   POST /catalogue/trace    staff (catalogue.publish): who a texture found elsewhere was given to
 *   POST /catalogue/players/<uuid>/block, GET /catalogue/blocked   staff (catalogue.publish): a player who leaked gets
 *                            nothing more (their launcher's kept copies stop opening when their 30-day access ends)
 * Original files never leave Herald this way: models are sent already read (no Blockbench project), textures marked.
 */
import { cleanSheet, seesCatalogue, toModelFiles, type CatalogueSheet, type CatalogueStatus } from '../../../src/shared/heraldCatalogue.ts'
import { readModel, type ModelData } from '../../../src/shared/models.ts'
import { decodePng, encodePng, PngError, type Pixels } from '../../../src/shared/png.ts'
import { seal } from '../../../src/shared/sealed.ts'
import { markPixels, readMark } from '../../../src/shared/watermark.ts'
import { shopKeyId, type PlayerSession, type ShopBundle, type ShopDelivery, type ShopItem } from '../../../src/shared/catalogueShop.ts'
import { HttpError, logActivity, type Actor } from './accounts'
import { fromB64, toB64 } from './crypto'
import { readFileBytes } from './catalogue'

export interface ShopEnv {
  DB: D1Database
  HERALD_ENV: string
  VAULT_MASTER: string
  /** local tests only: a stand-in for Mojang's session server */
  MOJANG_SESSION?: string
}

const MOJANG = 'https://sessionserver.mojang.com'
const TOKEN_DAYS = 30
const CHALLENGE_MS = 2 * 60_000
const PART = 1_500_000

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
const b64url = (b: Uint8Array) => toB64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fromB64url = (s: string) => fromB64(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4))

/** HMAC-SHA256 with a key made from the master secret for one use (label) */
async function hmac(env: ShopEnv, label: string, message: string): Promise<Uint8Array> {
  const master = await crypto.subtle.importKey('raw', fromB64(env.VAULT_MASTER) as Uint8Array<ArrayBuffer>, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const derived = new Uint8Array(await crypto.subtle.sign('HMAC', master, new TextEncoder().encode(`catalogue/${label}`)))
  const key = await crypto.subtle.importKey('raw', derived, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)))
}
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i])

// ------------------------------------------------------------------------------------------------ players

export async function challenge(env: ShopEnv) {
  // 40 hex digits like Minecraft's own server ids: when (12) and its signature (28), nothing to keep
  const at = Date.now().toString(16).padStart(12, '0')
  return { serverId: at + hex(await hmac(env, 'challenge', at)).slice(0, 28) }
}

export async function verifyPlayer(env: ShopEnv, body: Record<string, unknown>): Promise<PlayerSession> {
  const name = typeof body.name === 'string' && /^\w{1,16}$/.test(body.name) ? body.name : null
  const serverId = typeof body.serverId === 'string' && /^[0-9a-f]{40}$/.test(body.serverId) ? body.serverId : null
  if (!name || !serverId) throw new HttpError(400, 'Bad request.')
  const at = serverId.slice(0, 12)
  if (hex(await hmac(env, 'challenge', at)).slice(0, 28) !== serverId.slice(12) || Date.now() - parseInt(at, 16) > CHALLENGE_MS) throw new HttpError(403, 'This check has expired: try again.')
  const base = env.HERALD_ENV === 'local' && env.MOJANG_SESSION ? env.MOJANG_SESSION : MOJANG
  const res = await fetch(`${base}/session/minecraft/hasJoined?username=${encodeURIComponent(name)}&serverId=${serverId}`, { signal: AbortSignal.timeout(10_000) })
  if (res.status === 204 || res.status === 403 || res.status === 404) throw new HttpError(403, 'Mojang does not know this account here: sign in again in the launcher.')
  if (!res.ok) throw new HttpError(503, 'Mojang cannot be reached: try again later.')
  const profile = (await res.json()) as { id?: unknown; name?: unknown }
  const id = typeof profile.id === 'string' && /^[0-9a-f]{32}$/.test(profile.id) ? profile.id : null
  if (!id || typeof profile.name !== 'string') throw new HttpError(503, 'Mojang gave an unexpected answer.')
  const now = Date.now()
  const known = await env.DB.prepare('SELECT blocked_at FROM catalogue_players WHERE uuid = ?1').bind(id).first<{ blocked_at: number | null }>()
  if (known?.blocked_at) throw blocked()
  const tag = hex(await hmac(env, 'tag', id)).slice(0, 16)
  await env.DB.prepare('INSERT INTO catalogue_players (uuid, name, tag, first_at, last_at) VALUES (?1, ?2, ?3, ?4, ?4) ON CONFLICT (uuid) DO UPDATE SET name = ?2, last_at = ?4').bind(id, profile.name, tag, now).run()
  const expiresAt = now + TOKEN_DAYS * 86_400_000
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ u: id, n: profile.name, e: expiresAt })))
  return { token: `${payload}.${b64url(await hmac(env, 'token', payload))}`, expiresAt, id, name: profile.name }
}

/** A blocked player: the launcher removes what it kept for this account */
class Blocked extends HttpError {
  blocked = true
}
const blocked = () => new Blocked(403, 'This account cannot use the catalogue any more.')
export const isBlocked = (err: unknown) => err instanceof Blocked

/** The verified player of a request ("Authorization: Player <token>") */
async function player(env: ShopEnv, req: Request): Promise<{ id: string; name: string }> {
  const m = req.headers.get('authorization')?.match(/^Player ([\w-]{10,400})\.([\w-]{20,60})$/)
  if (!m) throw new HttpError(401, 'Verify your Minecraft account first.')
  if (!same(await hmac(env, 'token', m[1]), fromB64url(m[2]))) throw new HttpError(401, 'Verify your Minecraft account again.')
  const p = JSON.parse(new TextDecoder().decode(fromB64url(m[1]))) as { u: string; n: string; e: number }
  if (!(p.e > Date.now())) throw new HttpError(401, 'Verify your Minecraft account again.')
  return { id: p.u, name: p.n }
}

// ------------------------------------------------------------------------------------------------ shop

interface Row {
  id: string
  sheet: string
  status: CatalogueStatus
  version: number
  thumbnail: string | null
  published_at: number | null
}

const shopItem = (r: Row): ShopItem => {
  const s: CatalogueSheet = cleanSheet(JSON.parse(r.sheet) as Record<string, unknown>)
  return { id: r.id, kind: s.kind, name: s.name, description: s.description, patreonUrl: s.patreonUrl, tier: s.tier, category: s.category, slot: s.slot, slim: s.slim, adjust: s.adjust, newUntil: s.newUntil, version: r.version, thumbnail: r.thumbnail, publishedAt: r.published_at }
}

/** The list; with a player's token, also whether that player is blocked (the launcher then forgets what it kept) */
export async function listShop(env: ShopEnv, req: Request) {
  const rows = (await env.DB.prepare("SELECT id, sheet, status, version, thumbnail, published_at FROM catalogue_items WHERE status = 'published' AND version > 0 ORDER BY published_at DESC").all<Row>()).results
  const who = req.headers.has('authorization') ? await player(env, req).catch(() => null) : null
  const blocked = who ? !!(await env.DB.prepare('SELECT blocked_at FROM catalogue_players WHERE uuid = ?1').bind(who.id).first<{ blocked_at: number | null }>())?.blocked_at : false
  return { items: rows.map(shopItem), ...(blocked ? { blocked: true } : {}) }
}

async function shown(env: ShopEnv, id: string): Promise<Row> {
  const r = await env.DB.prepare("SELECT id, sheet, status, version, thumbnail, published_at FROM catalogue_items WHERE id = ?1 AND status = 'published' AND version > 0").bind(id).first<Row>()
  if (!r) throw new HttpError(404, 'This item is not in the catalogue any more.')
  return r
}

export async function thumbnail(env: ShopEnv, id: string): Promise<Response> {
  const r = await shown(env, id)
  const image = r.thumbnail ? await env.DB.prepare('SELECT bytes FROM images WHERE id = ?1').bind(r.thumbnail).first<{ bytes: ArrayBuffer }>() : null
  if (!image) throw new HttpError(404, 'No picture.')
  return new Response(new Uint8Array(image.bytes), { headers: { 'content-type': 'image/webp', 'cache-control': 'public, max-age=600' } })
}

/** An item version ready to mark: the model read once, its textures as pixels */
interface Base {
  kind: 'model' | 'skin'
  model?: ModelData
  textures: { width: number; height: number; rgba: string }[]
}

const dataUrlBytes = (src: string) => fromB64(src.slice(src.indexOf(',') + 1))

async function makeBase(env: ShopEnv, id: string, version: number, kind: 'model' | 'skin'): Promise<Base> {
  const files = await readFileBytes(env, id, version)
  const pixels = async (b: Uint8Array): Promise<Pixels> => {
    try {
      return await decodePng(b)
    } catch (err) {
      throw new HttpError(422, `A texture of this item cannot be read: ${err instanceof PngError ? err.message : 'unknown format'}.`)
    }
  }
  const out = (list: Pixels[]) => list.map((p) => ({ width: p.width, height: p.height, rgba: toB64(p.rgba) }))
  if (kind === 'skin') return { kind, textures: out([await pixels(files[0].bytes)]) }
  // flat items need each texture's transparency to get their sides
  const modelFiles = toModelFiles(files)
  for (const [i, f] of files.entries()) {
    if (!/\.png$/i.test(f.name)) continue
    const p = await pixels(f.bytes)
    modelFiles[i].alpha = Uint8Array.from({ length: p.width * p.height }, (_, k) => p.rgba[k * 4 + 3])
  }
  const model = readModel(modelFiles)
  const textures = await Promise.all(model.textures.map((t) => pixels(dataUrlBytes(t.src))))
  return { kind, model: { ...model, textures: model.textures.map((t) => ({ name: t.name, src: '' })) }, textures: out(textures) }
}

async function base(env: ShopEnv, id: string, version: number, kind: 'model' | 'skin'): Promise<Base> {
  const parts = (await env.DB.prepare('SELECT bytes FROM catalogue_bundles WHERE item_id = ?1 AND version = ?2 ORDER BY part').bind(id, version).all<{ bytes: ArrayBuffer }>()).results
  // D1 gives BLOBs back as arrays of numbers
  if (parts.length) {
    const decoder = new TextDecoder()
    return JSON.parse(parts.map((p, i) => decoder.decode(new Uint8Array(p.bytes), { stream: i < parts.length - 1 })).join('')) as Base
  }
  const made = await makeBase(env, id, version, kind)
  const bytes = new TextEncoder().encode(JSON.stringify(made))
  const statements: D1PreparedStatement[] = []
  for (let part = 0, at = 0; at < bytes.length; part++, at += PART)
    statements.push(env.DB.prepare('INSERT OR REPLACE INTO catalogue_bundles (item_id, version, part, bytes) VALUES (?1, ?2, ?3, ?4)').bind(id, version, part, bytes.slice(at, at + PART)))
  await env.DB.batch(statements)
  return made
}

const pngUrl = (p: Pixels) => `data:image/png;base64,${toB64(encodePng(p))}`

/** The item for this player: model and textures marked with the player's tag, sealed with a key of its own */
export async function deliver(env: ShopEnv, req: Request, id: string): Promise<ShopDelivery> {
  const who = await player(env, req)
  const row = await shown(env, id)
  const item = shopItem(row)
  const tag = await env.DB.prepare('SELECT tag, blocked_at FROM catalogue_players WHERE uuid = ?1').bind(who.id).first<{ tag: string; blocked_at: number | null }>()
  if (!tag) throw new HttpError(401, 'Verify your Minecraft account again.')
  if (tag.blocked_at) throw blocked()
  const b = await base(env, id, row.version, item.kind)
  const seed = await hmac(env, 'watermark', 'positions')
  const tagBytes = Uint8Array.from(tag.tag.match(/../g)!.map((h) => parseInt(h, 16)))
  const textures = b.textures.map((t) => {
    const p = { width: t.width, height: t.height, rgba: fromB64(t.rgba) }
    markPixels(p.rgba, p.width, p.height, tagBytes, seed)
    return pngUrl(p)
  })
  const bundle: ShopBundle = {
    format: 1,
    id,
    version: row.version,
    kind: item.kind,
    slot: item.slot,
    slim: item.slim,
    adjust: item.adjust,
    ...(b.model ? { model: { ...b.model, textures: b.model.textures.map((t, i) => ({ name: t.name, src: textures[i] })) } } : { skin: textures[0] }),
  }
  const key = crypto.getRandomValues(new Uint8Array(32))
  const sealed = await seal(new TextEncoder().encode(JSON.stringify(bundle)), key, shopKeyId(id, row.version), 16_384)
  const now = Date.now()
  await env.DB.batch([
    env.DB.prepare('INSERT INTO catalogue_deliveries (uuid, item_id, version, first_at, last_at) VALUES (?1, ?2, ?3, ?4, ?4) ON CONFLICT DO UPDATE SET last_at = ?4, count = count + 1').bind(who.id, id, row.version, now),
    env.DB.prepare('UPDATE catalogue_players SET last_at = ?2 WHERE uuid = ?1').bind(who.id, now),
  ])
  return { version: row.version, sealed: toB64(sealed), key: toB64(key) }
}

// ------------------------------------------------------------------------------------------------ trace

/** Who a texture found elsewhere was given to (a PNG, as found: not resized, not re-saved as JPEG) */
const canTrace = (actor: Actor) => actor.permissions.includes('catalogue.publish' as never) && seesCatalogue(actor.permissions)

export async function trace(env: ShopEnv, actor: Actor, body: Record<string, unknown>) {
  if (!canTrace(actor)) throw new HttpError(403, 'You cannot trace textures.')
  let p: Pixels
  try {
    p = await decodePng(fromB64(String(body.data ?? '')))
  } catch (err) {
    throw new HttpError(400, err instanceof PngError ? `This picture cannot be read: ${err.message}.` : 'This picture cannot be read.')
  }
  const tag = readMark(p.rgba, p.width, p.height, await hmac(env, 'watermark', 'positions'))
  const found = tag ? await env.DB.prepare('SELECT uuid, name, first_at, last_at, blocked_at FROM catalogue_players WHERE tag = ?1').bind(hex(tag)).first<{ uuid: string; name: string; first_at: number; last_at: number; blocked_at: number | null }>() : null
  await logActivity(env.DB, actor.profile.id, 'catalogue.trace', null, { found: found?.name ?? null })
  if (!found) return { found: false as const }
  const items = (
    await env.DB.prepare('SELECT d.item_id, d.version, d.first_at, d.last_at, d.count, i.sheet FROM catalogue_deliveries d LEFT JOIN catalogue_items i ON i.id = d.item_id WHERE d.uuid = ?1 ORDER BY d.last_at DESC LIMIT 200')
      .bind(found.uuid)
      .all<{ item_id: string; version: number; first_at: number; last_at: number; count: number; sheet: string | null }>()
  ).results
  return {
    found: true as const,
    player: { id: found.uuid, name: found.name, firstAt: found.first_at, lastAt: found.last_at, blockedAt: found.blocked_at },
    received: items.map((d) => ({ itemId: d.item_id, name: d.sheet ? cleanSheet(JSON.parse(d.sheet) as Record<string, unknown>).name : '(deleted)', version: d.version, firstAt: d.first_at, lastAt: d.last_at, count: d.count })),
  }
}

/** Blocks a player from the catalogue (a leak), or lets them back */
export async function blockPlayer(env: ShopEnv, actor: Actor, uuid: string, body: Record<string, unknown>) {
  if (!canTrace(actor)) throw new HttpError(403, 'You cannot block players.')
  const p = await env.DB.prepare('SELECT name FROM catalogue_players WHERE uuid = ?1').bind(uuid).first<{ name: string }>()
  if (!p) throw new HttpError(404, 'This player never received anything from the catalogue.')
  const block = body.blocked === true
  await env.DB.prepare('UPDATE catalogue_players SET blocked_at = ?2, blocked_by = ?3 WHERE uuid = ?1').bind(uuid, block ? Date.now() : null, block ? actor.profile.id : null).run()
  await logActivity(env.DB, actor.profile.id, block ? 'catalogue.block' : 'catalogue.unblock', null, { name: p.name, player: uuid })
  return blockedPlayers(env, actor)
}

export async function blockedPlayers(env: ShopEnv, actor: Actor) {
  if (!canTrace(actor)) throw new HttpError(403, 'You cannot see blocked players.')
  const rows = (await env.DB.prepare('SELECT uuid, name, blocked_at, blocked_by FROM catalogue_players WHERE blocked_at IS NOT NULL ORDER BY blocked_at DESC').all<{ uuid: string; name: string; blocked_at: number; blocked_by: string | null }>()).results
  return { players: rows.map((r) => ({ id: r.uuid, name: r.name, blockedAt: r.blocked_at, blockedBy: r.blocked_by })) }
}
