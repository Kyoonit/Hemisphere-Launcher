/**
 * The daily restart as it really happens: around the scheduled time, the Herald server checks the Minecraft server
 * every few seconds (herald/server/src/restartWatch.ts) and notes when it went down and when it answered again. Herald's
 * Server tab shows the last ones, and suggests a new daily time when the real one keeps being different. Pure code:
 * the server, the app and the tests share it.
 */
import { nextRestart, previousRestart, type RestartSchedule } from './restart'
import type { RestartException, RestartRule } from './feedV2'

/** watched from this long before the scheduled time… */
export const WATCH_BEFORE_MS = 5 * 60_000
/** …until this long after it (a late restart is still seen) */
export const WATCH_AFTER_MS = 20 * 60_000

export interface RestartObservation {
  /** the scheduled restart */
  scheduledAt: number
  /** the daily time then ("HH:mm" in timeZone) */
  time: string
  timeZone: string
  /** first moment seen not answering, and answering again after it (null: not seen) */
  downAt: number | null
  upAt: number | null
  /** watched until then (the window ends WATCH_AFTER_MS after the scheduled time) */
  checkedUntil: number
}

/** The schedule in force at `now` (rule + exceptions), as the launchers compute it; null without any rule */
export function scheduleAt(restart: { rules: RestartRule[]; exceptions: RestartException[] } | null | undefined, now: number): RestartSchedule | null {
  const rule = (restart?.rules ?? []).filter((r) => Date.parse(r.from) <= now).sort((a, b) => Date.parse(b.from) - Date.parse(a.from))[0]
  return rule ? { time: rule.time, timeZone: rule.timeZone, durationMin: rule.durationMin, exceptions: restart?.exceptions ?? [] } : null
}

/** The scheduled restart being watched at `now` (null: none near) */
export function watchedRestart(now: number, s: RestartSchedule): number | null {
  const last = previousRestart(now, s)
  if (now - last <= WATCH_AFTER_MS) return last
  const next = nextRestart(now, s).next
  return next - now <= WATCH_BEFORE_MS ? next : null
}

/** One check: what changes (null: nothing to write) */
export function observe(o: RestartObservation, up: boolean, at: number): RestartObservation | null {
  if (o.upAt !== null) return null
  if (!up && o.downAt === null) return { ...o, downAt: at, checkedUntil: at }
  if (up && o.downAt !== null) return { ...o, upAt: at, checkedUntil: at }
  return null
}

const MINUTE = 60_000
/** a difference smaller than this is not worth a change */
export const SUGGEST_MIN_MS = 2 * MINUTE
/** the last restarts must agree within this */
const SUGGEST_SPREAD_MS = 3 * MINUTE
const SUGGEST_COUNT = 3

/** "HH:mm" of an instant in a time zone */
function hhmm(at: number, timeZone: string): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at).map((x) => [x.type, x.value]))
  return `${p.hour}:${p.minute}`
}

/**
 * A new daily time, when the last 3 restarts (newest first in `list`) were all seen going down at least 2 minutes
 * from the scheduled time, on the same side, within 3 minutes of each other: the time they went down (their middle
 * one), to the minute. Null otherwise (one late day does not move the schedule).
 */
export function suggestDailyTime(list: RestartObservation[], current: { time: string; timeZone: string } | null): { time: string; offsetMin: number } | null {
  const last = list.slice(0, SUGGEST_COUNT)
  if (!current || last.length < SUGGEST_COUNT || last.some((o) => o.downAt === null || o.time !== current.time || o.timeZone !== current.timeZone)) return null
  const offsets = last.map((o) => o.downAt! - o.scheduledAt).sort((a, b) => a - b)
  if (offsets.some((d) => Math.abs(d) < SUGGEST_MIN_MS) || Math.sign(offsets[0]) !== Math.sign(offsets[offsets.length - 1])) return null
  if (offsets[offsets.length - 1] - offsets[0] > SUGGEST_SPREAD_MS) return null
  const middle = last.find((o) => o.downAt! - o.scheduledAt === offsets[1])!
  const time = hhmm(Math.floor(middle.downAt! / MINUTE) * MINUTE, current.timeZone)
  return time === current.time ? null : { time, offsetMin: Math.round(offsets[1] / MINUTE) }
}
