/**
 * The daily restart as it really happens (src/shared/restartObservations.ts): from 5 minutes before the scheduled time
 * to 20 minutes after it, each minute's cron checks the Minecraft server every 5 seconds (the game's status ping) and
 * notes when it went down and when it answered again. Only changes are written.
 */
import { observe, scheduleAt, suggestDailyTime, watchedRestart, WATCH_AFTER_MS, type RestartObservation } from '../../../src/shared/restartObservations.ts'
import { HttpError, type Actor } from './accounts'
import { feedBase } from './publications'
import { ping } from './stats'

const EVERY_MS = 5_000
/** each cron run watches until shortly before the next one */
const RUN_MS = 54_000

type Row = { scheduled_at: number; time: string; time_zone: string; down_at: number | null; up_at: number | null; checked_until: number }
const fromRow = (r: Row): RestartObservation => ({ scheduledAt: r.scheduled_at, time: r.time, timeZone: r.time_zone, downAt: r.down_at, upAt: r.up_at, checkedUntil: r.checked_until })

/** The cron, every minute: does nothing far from a restart */
export async function watchRestart(db: D1Database, now: number): Promise<void> {
  const base = await feedBase(db)
  const schedule = scheduleAt(base.restart, now)
  const target = schedule && watchedRestart(now, schedule)
  if (!schedule || target === null) return
  const row = await db.prepare('SELECT * FROM restart_observations WHERE scheduled_at = ?1').bind(target).first<Row>()
  let o: RestartObservation = row ? fromRow(row) : { scheduledAt: target, time: schedule.time, timeZone: schedule.timeZone, downAt: null, upAt: null, checkedUntil: now }
  if (o.upAt !== null) return
  if (!row) await db.prepare('INSERT OR IGNORE INTO restart_observations (scheduled_at, time, time_zone, checked_until) VALUES (?1, ?2, ?3, ?4)').bind(target, o.time, o.timeZone, now).run()
  const end = Math.min(now + RUN_MS, target + WATCH_AFTER_MS)
  while (Date.now() < end) {
    const started = Date.now()
    const up = (await ping()) !== null
    const changed = observe(o, up, started)
    if (changed) {
      o = changed
      await db.prepare('UPDATE restart_observations SET down_at = ?2, up_at = ?3, checked_until = ?4 WHERE scheduled_at = ?1').bind(target, o.downAt, o.upAt, o.checkedUntil).run()
      if (o.upAt !== null) break
    }
    await new Promise((r) => setTimeout(r, Math.max(0, EVERY_MS - (Date.now() - started))))
  }
  await db.prepare('UPDATE restart_observations SET checked_until = max(checked_until, ?2) WHERE scheduled_at = ?1').bind(target, Date.now()).run()
}

/** GET /server/restarts: the last real restarts, and a new daily time when they keep differing from the schedule */
export async function listRestarts(db: D1Database, actor: Actor) {
  if (!actor.permissions.some((p) => p === 'restart.write' || p === 'maintenance.write' || p === 'maintenance.emergency')) throw new HttpError(403, 'You cannot see the server tab.')
  const now = Date.now()
  const observations = (await db.prepare('SELECT * FROM restart_observations WHERE scheduled_at <= ?1 ORDER BY scheduled_at DESC LIMIT 10').bind(now + 10 * 60_000).all<Row>()).results.map(fromRow)
  const schedule = scheduleAt((await feedBase(db)).restart, now)
  // only the restarts that are over count for a suggestion
  const done = observations.filter((o) => o.checkedUntil >= o.scheduledAt + WATCH_AFTER_MS - 60_000 || o.upAt !== null)
  return { observations, suggestion: suggestDailyTime(done, schedule && { time: schedule.time, timeZone: schedule.timeZone }) }
}
