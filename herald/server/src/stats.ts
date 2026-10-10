/**
 * Server statistics, collected by the cron every minute (src/shared/serverStats.ts): the game's status ping straight to
 * the Minecraft server (TCP) and BlueMap's live lists (every player, their dimension). A failure of one source only
 * makes that minute less precise; it never stops the rest of the cron.
 */
import { connect } from 'cloudflare:sockets'
import { SERVER } from '../../../src/shared/server.ts'
import { blueMapPlayers, blueMapPlayersUrl, DIMENSIONS, emptyPresence, readStatusAnswer, statusRequest, stepPresence, type Dimension, type PingAnswer, type Presence, type SeenPlayer } from '../../../src/shared/serverStats.ts'

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
      .bind(minute, online, pinged?.answer.online ?? mapped?.length ?? null, pinged?.answer.max ?? null, pinged?.latencyMs ?? null, pinged?.answer.version ?? null, names),
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
