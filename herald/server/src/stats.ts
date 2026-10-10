/**
 * Server statistics, collected by the cron every minute (src/shared/serverStats.ts): the game's status ping straight to
 * the Minecraft server (TCP) and BlueMap's live lists (every player, their dimension). A failure of one source only
 * makes that minute less precise; it never stops the rest of the cron.
 */
import { connect } from 'cloudflare:sockets'
import { SERVER } from '../../../src/shared/server.ts'
import { blueMapPlayers, blueMapPlayersUrl, buildStatsView, DIMENSIONS, statsZone, emptyPresence, isBot, RANGE_SPAN, readStatusAnswer, STATS_RANGES, statusRequest, stepPresence, type Dimension, type PingAnswer, type Presence, type SeenPlayer, type StatsRange, type StatsRows } from '../../../src/shared/serverStats.ts'
import { cleanSheet } from '../../../src/shared/heraldCatalogue.ts'
import { HttpError, type Actor } from './accounts'

const TIMEOUT_MS = 6_000

const timeout = <T>(ms: number, value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms))

/** The game's status ping (null: the server did not answer) and the connection time */
async function ping(): Promise<{ answer: PingAnswer; latencyMs: number } | null> {
  const socket = connect({ hostname: SERVER.host, port: SERVER.port })
  const work = (async () => {
    const start = Date.now()
    await socket.opened
    const latencyMs = Date.now() - start
    const writer = socket.writable.getWriter()
    await writer.write(statusRequest(SERVER.host, SERVER.port))
    const reader = socket.readable.getReader()
    let buf = new Uint8Array(0)
    for (;;) {
      const { value, done } = await reader.read()
      if (done) return null
      const next = new Uint8Array(buf.length + value.length)
      next.set(buf)
      next.set(value, buf.length)
      buf = next
      if (buf.length > 256_000) return null
      const answer = readStatusAnswer(buf)
      if (answer) return { answer, latencyMs }
    }
  })()
  try {
    return await Promise.race([work.catch(() => null), timeout(TIMEOUT_MS, null)])
  } finally {
    socket.close().catch(() => {})
  }
}

/** Everyone online and where, from BlueMap (null: the map did not answer) */
async function blueMap(): Promise<SeenPlayer[] | null> {
  const lists = await Promise.all(
    DIMENSIONS.map(async (d) => {
      try {
        const res = await fetch(blueMapPlayersUrl(d), { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'application/json' } })
        return [d, res.ok ? await res.json() : null] as const
      } catch {
        return [d, null] as const
      }
    }),
  )
  return blueMapPlayers(Object.fromEntries(lists) as Record<Dimension, never>)
}

/** One collection (the cron, every minute; a minute already collected is skipped) */
export async function collectServerStats(db: D1Database, now: number): Promise<void> {
  const minute = Math.floor(now / 60_000) * 60_000
  const row = await db.prepare('SELECT value, at FROM stats_presence WHERE id = 1').first<{ value: string; at: number }>()
  if (row && row.at >= minute) return
  const prev: Presence = row ? (JSON.parse(row.value) as Presence) : emptyPresence()
  const [pinged, mapped] = await Promise.all([ping(), blueMap()])

  // names: BlueMap has everyone; else the server's sample, complete only when it holds every player
  const names = mapped ? 'bluemap' : pinged && pinged.answer.sample.length ? 'ping' : null
  const seen: SeenPlayer[] | null = mapped ?? (pinged ? pinged.answer.sample.map((p) => ({ ...p, dimension: null })) : null)
  const complete = Boolean(mapped) || (pinged !== null && pinged.answer.sample.length >= pinged.answer.online)
  // neither answered: the server counts as down, its players leave (after the grace minutes, like any departure)
  const answered = Boolean(pinged || mapped)
  const { next, ended, started } = stepPresence(prev, answered ? (seen ?? []) : [], answered ? complete : true, minute)

  const online = answered ? 1 : 0
  const statements = [
    db
      .prepare('INSERT OR IGNORE INTO server_samples (at, online, players, max_players, latency_ms, version, names) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
      .bind(minute, online, pinged?.answer.online ?? mapped?.filter((p) => !isBot(p.uuid)).length ?? null, pinged?.answer.max ?? null, pinged?.latencyMs ?? null, pinged?.answer.version ?? null, names),
    db.prepare('INSERT INTO stats_presence (id, value, at) VALUES (1, ?1, ?2) ON CONFLICT(id) DO UPDATE SET value = ?1, at = ?2').bind(JSON.stringify(next), minute),
    ...started.map((p) =>
      db.prepare('INSERT INTO stats_players (uuid, name, first_seen, last_seen) VALUES (?1, ?2, ?3, ?3) ON CONFLICT(uuid) DO UPDATE SET name = ?2, last_seen = ?3').bind(p.uuid, p.name, minute),
    ),
    ...ended.flatMap((s) => [
      db
        .prepare('INSERT INTO player_sessions (uuid, name, started_at, ended_at, minutes, overworld, nether, end_minutes) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)')
        .bind(s.uuid, s.name, s.startedAt, s.endedAt, s.minutes, s.overworld, s.nether, s.end),
      db
        .prepare(
          'INSERT INTO stats_players (uuid, name, first_seen, last_seen, sessions, minutes) VALUES (?1, ?2, ?3, ?4, 1, ?5) ON CONFLICT(uuid) DO UPDATE SET name = ?2, last_seen = max(last_seen, ?4), sessions = sessions + 1, minutes = minutes + ?5',
        )
        .bind(s.uuid, s.name, s.startedAt, s.endedAt, s.minutes),
    ]),
  ]
  await db.batch(statements)
  if (started.length || ended.length) console.log(`[stats] ${Object.keys(next.players).length} online, +${started.length} -${ended.length} (names: ${names ?? 'none'})`)
}

/** Real accounts only: offline-mode ids (carpet bots, chunk loaders) are left out */
const NOT_BOT = "substr(uuid, 13, 1) <> '3'"
const FOUR_WEEKS = 28 * 86_400_000

/** GET /stats?range=day|week|month&zone=<time zone> (permission stats.view) */
export async function statsView(db: D1Database, actor: Actor, url: URL) {
  if (!actor.permissions.includes('stats.view')) throw new HttpError(403, 'You cannot see the server statistics.')
  const asked = url.searchParams.get('range') ?? 'day'
  const range: StatsRange = (STATS_RANGES as string[]).includes(asked) ? (asked as StatsRange) : 'day'
  const now = Date.now()
  const { ms, bucket } = RANGE_SPAN[range]
  const from = now - ms
  const zone = statsZone(url.searchParams.get('zone'))
  const [since, last, presence, buckets, hours, sessions, counts, catalogue, allTime] = await db.batch<unknown>([
    db.prepare('SELECT min(at) AS at FROM server_samples'),
    db.prepare('SELECT at, online, players, max_players, latency_ms, version FROM server_samples ORDER BY at DESC LIMIT 1'),
    db.prepare('SELECT value FROM stats_presence WHERE id = 1'),
    db.prepare('SELECT (at / ?2) * ?2 AS t, max(players) AS mx, sum(online) AS up, count(*) AS n FROM server_samples WHERE at >= ?1 GROUP BY t ORDER BY t').bind(from, bucket),
    db.prepare('SELECT (at / 3600000) * 3600000 AS h, avg(players) AS av FROM server_samples WHERE at >= ?1 AND online = 1 GROUP BY h').bind(now - FOUR_WEEKS),
    db.prepare(`SELECT uuid, name, started_at, minutes, overworld, nether, end_minutes FROM player_sessions WHERE ended_at >= ?1 AND ${NOT_BOT} ORDER BY started_at LIMIT 20000`).bind(from),
    db.prepare(`SELECT count(*) AS everyone, sum(first_seen >= ?1) AS fresh FROM stats_players WHERE ${NOT_BOT}`).bind(from),
    db.prepare('SELECT d.item_id, i.sheet, count(DISTINCT d.uuid) AS players FROM catalogue_deliveries d LEFT JOIN catalogue_items i ON i.id = d.item_id WHERE d.last_at >= ?1 GROUP BY d.item_id ORDER BY players DESC LIMIT 8').bind(from),
    // enough to stay right once the sessions going on now are added
    db.prepare(`SELECT uuid, name, minutes, sessions FROM stats_players WHERE ${NOT_BOT} ORDER BY minutes DESC LIMIT 40`),
  ])
  const first = <T>(r: D1Result<unknown>) => (r.results[0] as T | undefined) ?? null
  const presenceRow = first<{ value: string }>(presence)
  const count = first<{ everyone: number; fresh: number | null }>(counts)
  const rows: StatsRows = {
    collectingSince: first<{ at: number | null }>(since)?.at ?? null,
    last: first<StatsRows['last']>(last),
    presence: presenceRow ? (JSON.parse(presenceRow.value) as Presence) : null,
    buckets: buckets.results as StatsRows['buckets'],
    hours: hours.results as StatsRows['hours'],
    sessions: sessions.results as StatsRows['sessions'],
    newPlayers: count?.fresh ?? 0,
    allPlayers: count?.everyone ?? 0,
    allTime: allTime.results as StatsRows['allTime'],
    catalogue: (catalogue.results as { item_id: string; sheet: string | null; players: number }[]).map((c) => ({
      itemId: c.item_id,
      name: c.sheet ? cleanSheet(JSON.parse(c.sheet) as Record<string, unknown>).name : '(deleted)',
      players: c.players,
    })),
  }
  return buildStatsView(range, now, rows, zone)
}
