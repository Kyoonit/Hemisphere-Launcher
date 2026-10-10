/**
 * Server statistics without installing anything on the Minecraft server: every minute Herald pings it like the game's
 * server list does (players online, version, a sample of names) and reads BlueMap's public live data (every player and
 * the dimension they are in). Sessions come from who is there minute after minute. Pure code: the Herald server
 * collects (herald/server/src/stats.ts), the Herald app shows, tests check.
 */
import { BLUEMAP } from './server'

export type Dimension = 'overworld' | 'nether' | 'end'
export const DIMENSIONS: Dimension[] = ['overworld', 'nether', 'end']

// ------------------------------------------------------------------ the game's server list ping

function varint(n: number): number[] {
  const out: number[] = []
  let v = n >>> 0
  do {
    let b = v & 0x7f
    v >>>= 7
    if (v) b |= 0x80
    out.push(b)
  } while (v)
  return out
}

/** (value, bytes read), null when the buffer stops before the end of the number */
function readVarint(buf: Uint8Array, at: number): [number, number] | null {
  let value = 0
  for (let i = 0; i < 5; i++) {
    if (at + i >= buf.length) return null
    const b = buf[at + i]
    value |= (b & 0x7f) << (7 * i)
    if (!(b & 0x80)) return [value >>> 0, i + 1]
  }
  throw new Error('bad varint')
}

const packet = (body: number[]) => [...varint(body.length), ...body]

/** Handshake (next state: status) then the status request, as one write */
export function statusRequest(host: string, port: number): Uint8Array {
  const name = [...new TextEncoder().encode(host)]
  // protocol -1: "I only want the status", every server version answers it
  const handshake = packet([0x00, ...varint(-1), ...varint(name.length), ...name, (port >> 8) & 0xff, port & 0xff, 0x01])
  return new Uint8Array([...handshake, ...packet([0x00])])
}

export interface PingAnswer {
  version: string | null
  online: number
  max: number
  /** some servers send no sample, or only some names */
  sample: { uuid: string; name: string }[]
}

/** The status answer once all of it arrived (null: wait for more bytes) */
export function readStatusAnswer(buf: Uint8Array): PingAnswer | null {
  const length = readVarint(buf, 0)
  if (!length || buf.length < length[1] + length[0]) return null
  let at = length[1]
  const id = readVarint(buf, at)
  if (!id || id[0] !== 0) throw new Error('not a status answer')
  at += id[1]
  const size = readVarint(buf, at)
  if (!size) return null
  at += size[1]
  const doc = JSON.parse(new TextDecoder().decode(buf.subarray(at, at + size[0]))) as {
    version?: { name?: unknown }
    players?: { online?: unknown; max?: unknown; sample?: { id?: unknown; name?: unknown }[] }
  }
  const sample = Array.isArray(doc.players?.sample) ? doc.players.sample : []
  return {
    version: typeof doc.version?.name === 'string' ? doc.version.name.slice(0, 80) : null,
    online: Number(doc.players?.online) || 0,
    max: Number(doc.players?.max) || 0,
    sample: sample.flatMap((p) => {
      const uuid = typeof p.id === 'string' ? plainUuid(p.id) : null
      return uuid && typeof p.name === 'string' && /^\w{1,16}$/.test(p.name) ? [{ uuid, name: p.name }] : []
    }),
  }
}

// ------------------------------------------------------------------ BlueMap

/** 32 hex digits, no dashes (null: not a uuid) */
export function plainUuid(id: string): string | null {
  const plain = id.replace(/-/g, '').toLowerCase()
  return /^[0-9a-f]{32}$/.test(plain) ? plain : null
}

/** Offline-mode ids (version 3: carpet bots, chunk loaders) are not real accounts: left out of the statistics */
export const isBot = (uuid: string) => uuid[12] === '3'

/** Where BlueMap's live player list of a map is */
export const blueMapPlayersUrl = (dimension: Dimension) => `${BLUEMAP.url}/maps/${BLUEMAP.maps[dimension]}/live/players.json`

export interface SeenPlayer {
  uuid: string
  name: string
  dimension: Dimension | null
}

type BlueMapPlayers = { players?: { uuid?: unknown; name?: unknown; foreign?: unknown }[] }

/**
 * Everyone online, from the live lists of the dimensions' maps: each map lists every player, `foreign` false on the
 * map of the world they are in. Null without the overworld's list (the others only say where).
 */
export function blueMapPlayers(lists: Partial<Record<Dimension, BlueMapPlayers | null>>): SeenPlayer[] | null {
  const all = lists.overworld?.players
  if (!Array.isArray(all)) return null
  const here = (d: Dimension, uuid: string) => lists[d]?.players?.some((p) => typeof p.uuid === 'string' && plainUuid(p.uuid) === uuid && p.foreign === false) ?? false
  return all.flatMap((p) => {
    const uuid = typeof p.uuid === 'string' ? plainUuid(p.uuid) : null
    if (!uuid || typeof p.name !== 'string' || !/^\w{1,16}$/.test(p.name)) return []
    return [{ uuid, name: p.name, dimension: DIMENSIONS.find((d) => here(d, uuid)) ?? null }]
  })
}

// ------------------------------------------------------------------ sessions

export interface PresenceEntry {
  name: string
  /** session start, last minute seen (ms) */
  since: number
  seen: number
  minutes: number
  overworld: number
  nether: number
  end: number
}

/** Who is online now, as Herald last saw them (kept between two collections) */
export interface Presence {
  /** the last minute collected */
  at: number
  players: Record<string, PresenceEntry>
}

export interface FinishedSession {
  uuid: string
  name: string
  startedAt: number
  endedAt: number
  minutes: number
  overworld: number
  nether: number
  end: number
}

const MINUTE = 60_000
/** someone missing for less than this is still in the same session (a missed collection, a short reconnection) */
export const GRACE_MINUTES = 3
/** with no list at all for this long, the sessions end where they were last seen */
export const UNKNOWN_MAX_MINUTES = 10

export const emptyPresence = (): Presence => ({ at: 0, players: {} })

/**
 * One collection: `seen` is who is online at `minute` (null: nobody knows; `complete` false: only some names are known,
 * the missing ones are not ended). Returns the new presence, the sessions that ended and the players that arrived.
 */
export function stepPresence(prev: Presence, seen: SeenPlayer[] | null, complete: boolean, minute: number): { next: Presence; ended: FinishedSession[]; started: SeenPlayer[] } {
  if (minute <= prev.at) return { next: prev, ended: [], started: [] }
  const players: Record<string, PresenceEntry> = {}
  const ended: FinishedSession[] = []
  const started: SeenPlayer[] = []
  const now = new Set<string>()
  for (const p of seen ?? []) {
    if (now.has(p.uuid)) continue
    now.add(p.uuid)
    const was = prev.players[p.uuid]
    // the minutes since the last collection (several when some were missed), never more than the grace
    const add = was ? Math.max(1, Math.min(Math.round((minute - was.seen) / MINUTE), GRACE_MINUTES)) : 1
    const entry: PresenceEntry = was ? { ...was, name: p.name, seen: minute, minutes: was.minutes + add } : { name: p.name, since: minute, seen: minute, minutes: 1, overworld: 0, nether: 0, end: 0 }
    if (p.dimension) entry[p.dimension] += add
    players[p.uuid] = entry
    if (!was) started.push(p)
  }
  const limit = (seen && complete ? GRACE_MINUTES : UNKNOWN_MAX_MINUTES) * MINUTE
  for (const [uuid, e] of Object.entries(prev.players)) {
    if (now.has(uuid)) continue
    if (minute - e.seen < limit) players[uuid] = e
    else ended.push({ uuid, name: e.name, startedAt: e.since, endedAt: e.seen + MINUTE, minutes: e.minutes, overworld: e.overworld, nether: e.nether, end: e.end })
  }
  return { next: { at: minute, players }, ended, started }
}
