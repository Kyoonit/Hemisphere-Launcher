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

// ------------------------------------------------------------------ what the Herald app shows (GET /stats)

export type StatsRange = 'day' | 'week' | 'month'
export const STATS_RANGES: StatsRange[] = ['day', 'week', 'month']
/** each range: how far back, and one point of the curve every… */
export const RANGE_SPAN: Record<StatsRange, { ms: number; bucket: number }> = {
  day: { ms: 86_400_000, bucket: 15 * MINUTE },
  week: { ms: 7 * 86_400_000, bucket: 60 * MINUTE },
  month: { ms: 30 * 86_400_000, bucket: 6 * 60 * MINUTE },
}
/** days and hours are counted in the viewer's time zone; this one when none (or an unknown one) is given */
export const STATS_TIME_ZONE = 'Europe/Paris'

/** A time zone this runtime knows (else the default) */
export function statsZone(zone: string | null | undefined): string {
  if (!zone || zone.length > 64) return STATS_TIME_ZONE
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: zone })
    return zone
  } catch {
    return STATS_TIME_ZONE
  }
}

export interface StatsPlayer {
  uuid: string
  name: string
  minutes: number
  sessions: number
}

export interface ServerStatsView {
  range: StatsRange
  from: number
  to: number
  /** the first minute ever collected (null: nothing yet) */
  collectingSince: number | null
  /** the last minute collected */
  last: { at: number; online: boolean; players: number | null; max: number | null; latencyMs: number | null; version: string | null } | null
  /** who is online now (bots left out), since when */
  online: { uuid: string; name: string; since: number; minutes: number }[]
  /** players over the range: the most at once in each slice, and the share of minutes the server answered */
  curve: { at: number; players: number | null; up: number }[]
  peak: { players: number; at: number } | null
  /** share of the collected minutes the server answered (null: none collected) */
  uptime: number | null
  /** different players, new ones (first time ever seen), every player ever seen */
  unique: number
  newPlayers: number
  allPlayers: number
  sessions: { count: number; minutes: number; averageMinutes: number | null }
  dimensions: Record<Dimension, number>
  /** the time zone days and hours are counted in */
  zone: string
  /** each day of the range: different players and minutes played */
  days: { day: string; players: number; minutes: number }[]
  /** average players online by weekday (0 = Monday) and hour, over the last 4 weeks */
  heat: (number | null)[][]
  /** who played the most in the last 24 hours, 7 days and 30 days (whatever the range shown) */
  tops: Record<StatsRange, StatsPlayer[]>
  /** who played the most since the statistics began */
  topAllTime: StatsPlayer[]
  /** catalogue items tried in the range: how many different players */
  catalogue: { itemId: string; name: string; players: number }[]
}

const formats = new Map<string, Intl.DateTimeFormat>()
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
/** The day (YYYY-MM-DD), weekday (0 = Monday) and hour of a moment, in a time zone */
export function localTime(ms: number, zone = STATS_TIME_ZONE): { day: string; weekday: number; hour: number } {
  let f = formats.get(zone)
  if (!f) formats.set(zone, (f = new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', hourCycle: 'h23' })))
  const p = Object.fromEntries(f.formatToParts(ms).map((x) => [x.type, x.value]))
  return { day: `${p.year}-${p.month}-${p.day}`, weekday: WEEKDAYS.indexOf(p.weekday), hour: Number(p.hour) % 24 }
}

/** What the server's database gave (bots already left out of the players' rows) */
export interface StatsRows {
  collectingSince: number | null
  last: { at: number; online: number; players: number | null; max_players: number | null; latency_ms: number | null; version: string | null } | null
  presence: Presence | null
  /** samples of the range by slice: most players, minutes answered, minutes collected */
  buckets: { t: number; mx: number | null; up: number; n: number }[]
  /** samples of the last 4 weeks by hour (hour start, average players while answering) */
  hours: { h: number; av: number | null }[]
  /** the sessions that ended in the last 30 days (the longest range) */
  sessions: { uuid: string; name: string; started_at: number; ended_at: number; minutes: number; overworld: number; nether: number; end_minutes: number }[]
  newPlayers: number
  allPlayers: number
  /** totals of the ended sessions of the players who played the most ever */
  allTime: { uuid: string; name: string; minutes: number; sessions: number }[]
  catalogue: { itemId: string; name: string; players: number }[]
}

/** The 10 who played the most: totals (or sessions) plus the sessions going on now */
function rank(done: { uuid: string; name: string; minutes: number; sessions?: number }[], live: [string, PresenceEntry][]): StatsPlayer[] {
  const by = new Map<string, StatsPlayer>()
  const add = (uuid: string, name: string, minutes: number, sessions: number) => {
    const p = by.get(uuid) ?? { uuid, name, minutes: 0, sessions: 0 }
    by.set(uuid, { uuid, name, minutes: p.minutes + minutes, sessions: p.sessions + sessions })
  }
  for (const x of done) add(x.uuid, x.name, x.minutes, x.sessions ?? 1)
  for (const [uuid, e] of live) add(uuid, e.name, e.minutes, 1)
  return [...by.values()].sort((a, b) => b.minutes - a.minutes).slice(0, 10)
}

/** The statistics of a range, from the rows (sessions still going count with what they have so far) */
export function buildStatsView(range: StatsRange, now: number, rows: StatsRows, zone = STATS_TIME_ZONE): ServerStatsView {
  const { ms, bucket } = RANGE_SPAN[range]
  const from = now - ms
  const live = Object.entries(rows.presence?.players ?? {}).filter(([uuid]) => !isBot(uuid))
  const all = [
    ...rows.sessions.filter((x) => x.ended_at >= from).map((x) => ({ uuid: x.uuid, name: x.name, start: x.started_at, minutes: x.minutes, overworld: x.overworld, nether: x.nether, end: x.end_minutes })),
    ...live.map(([uuid, e]) => ({ uuid, name: e.name, start: e.since, minutes: e.minutes, overworld: e.overworld, nether: e.nether, end: e.end })),
  ]

  // the curve: every slice of the range, empty where nothing was collected
  const byT = new Map(rows.buckets.map((b) => [b.t, b]))
  const curve: ServerStatsView['curve'] = []
  for (let t = Math.floor(from / bucket) * bucket; t <= now; t += bucket) {
    const b = byT.get(t)
    curve.push({ at: t, players: b?.mx ?? null, up: b && b.n ? b.up / b.n : 0 })
  }
  let peak: ServerStatsView['peak'] = null
  for (const b of rows.buckets) if (b.mx !== null && (!peak || b.mx >= peak.players)) peak = { players: b.mx, at: b.t }
  const collected = rows.buckets.reduce((n, b) => n + b.n, 0)
  const answered = rows.buckets.reduce((n, b) => n + b.up, 0)

  // each day of the range: different players and minutes (a session counts on the day it started)
  const days = new Map<string, { players: Set<string>; minutes: number }>()
  for (let t = from; t <= now + 86_400_000; t += 86_400_000) {
    const d = localTime(Math.min(t, now), zone).day
    if (!days.has(d)) days.set(d, { players: new Set(), minutes: 0 })
  }
  const players = new Set<string>()
  const dimensions: Record<Dimension, number> = { overworld: 0, nether: 0, end: 0 }
  for (const x of all) {
    const day = days.get(localTime(Math.max(x.start, from), zone).day)
    day?.players.add(x.uuid)
    if (day) day.minutes += x.minutes
    players.add(x.uuid)
    dimensions.overworld += x.overworld
    dimensions.nether += x.nether
    dimensions.end += x.end
  }
  const minutes = all.reduce((n, x) => n + x.minutes, 0)

  // the week's rhythm: average players by weekday and hour
  const sum = Array.from({ length: 7 }, () => Array<number>(24).fill(0))
  const count = Array.from({ length: 7 }, () => Array<number>(24).fill(0))
  for (const h of rows.hours) {
    if (h.av === null) continue
    const { weekday, hour } = localTime(h.h, zone)
    if (weekday < 0) continue
    sum[weekday][hour] += h.av
    count[weekday][hour] += 1
  }

  return {
    range,
    from,
    to: now,
    collectingSince: rows.collectingSince,
    last: rows.last && { at: rows.last.at, online: rows.last.online === 1, players: rows.last.players, max: rows.last.max_players, latencyMs: rows.last.latency_ms, version: rows.last.version },
    online: live.map(([uuid, e]) => ({ uuid, name: e.name, since: e.since, minutes: e.minutes })).sort((a, b) => a.since - b.since),
    curve,
    peak,
    uptime: collected ? answered / collected : null,
    unique: players.size,
    newPlayers: rows.newPlayers,
    allPlayers: rows.allPlayers,
    sessions: { count: all.length, minutes, averageMinutes: all.length ? Math.round(minutes / all.length) : null },
    dimensions,
    days: [...days].map(([day, d]) => ({ day, players: d.players.size, minutes: d.minutes })),
    heat: sum.map((row, w) => row.map((v, h) => (count[w][h] ? Math.round((v / count[w][h]) * 10) / 10 : null))),
    zone,
    tops: Object.fromEntries(STATS_RANGES.map((r) => [r, rank(rows.sessions.filter((x) => x.ended_at >= now - RANGE_SPAN[r].ms), live)])) as Record<StatsRange, StatsPlayer[]>,
    // ended sessions, plus the ones going on now
    topAllTime: rank(rows.allTime, live),
    catalogue: rows.catalogue,
  }
}
