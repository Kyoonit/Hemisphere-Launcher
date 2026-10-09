/**
 * Daily restart schedule, expressed in the server's time zone and converted to absolute instants.
 * Uses the IANA time-zone database built into the runtime, so daylight saving is handled.
 * Exceptions (Herald, schema 2 feed): no restart on a given day, or an extra one.
 */

export interface RestartException {
  /** Day (YYYY-MM-DD) in `timeZone` */
  date: string
  timeZone: string
  /** no daily restart that day */
  skip?: boolean
  /** an extra restart that day */
  extra?: { time: string; durationMin: number }
}

export interface RestartSchedule {
  time: string // "HH:mm" in timeZone
  timeZone: string
  durationMin: number
  exceptions?: RestartException[]
}

export type RestartPhase = 'normal' | 'soon' | 'restarting'

export interface RestartState {
  phase: RestartPhase
  next: number // epoch ms of the next restart
  msLeft: number // until next restart (or until back online when restarting)
  /** the usual daily restart, or an extra one (exception) */
  kind?: 'daily' | 'extra'
}

const SOON_MS = 15 * 60_000

function parts(ts: number, timeZone: string, withTime: boolean): Record<string, number> {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    ...(withTime ? { hour: 'numeric', minute: 'numeric', second: 'numeric' } : {}),
  })
  return Object.fromEntries(fmt.formatToParts(ts).filter((p) => p.type !== 'literal').map((p) => [p.type, Number(p.value)]))
}

/** Offset (ms) of timeZone from UTC at instant ts. */
function offsetMs(ts: number, timeZone: string): number {
  const p = parts(ts, timeZone, true)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ts / 1000) * 1000
}

/** Epoch ms of the restart on the given day offset relative to `now`'s date in the schedule's zone. */
function restartAt(now: number, s: RestartSchedule, dayOffset: number): number {
  const d = parts(now, s.timeZone, false)
  const [h, m] = s.time.split(':').map(Number)
  const guess = Date.UTC(d.year, d.month - 1, d.day + dayOffset, h, m)
  return guess - offsetMs(guess, s.timeZone)
}

const ymd = (ts: number, timeZone: string) => {
  const p = parts(ts, timeZone, false)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

/** Wall time (YYYY-MM-DD + HH:mm) in a zone → epoch ms */
function wallTime(date: string, hhmm: string, timeZone: string): number {
  const [y, mo, d] = date.split('-').map(Number)
  const [h, m] = hhmm.split(':').map(Number)
  const guess = Date.UTC(y, mo - 1, d, h, m)
  return guess - offsetMs(guess, timeZone)
}

/** Every restart from a few days back to a few days ahead: the daily one unless that day is skipped, plus the extra ones. */
function restartsAround(now: number, s: RestartSchedule): { at: number; duration: number; kind: 'daily' | 'extra' }[] {
  const out: { at: number; duration: number; kind: 'daily' | 'extra' }[] = []
  const ex = s.exceptions ?? []
  for (let day = -3; day <= 4; day++) {
    const at = restartAt(now, s, day)
    if (!ex.some((e) => e.skip && e.date === ymd(at, e.timeZone))) out.push({ at, duration: s.durationMin * 60_000, kind: 'daily' })
  }
  for (const e of ex) {
    if (!e.extra) continue
    const at = wallTime(e.date, e.extra.time, e.timeZone)
    if (Math.abs(at - now) < 5 * 86_400_000) out.push({ at, duration: e.extra.durationMin * 60_000, kind: 'extra' })
  }
  return out.sort((a, b) => a.at - b.at)
}

/** Every restart (daily and extra) between two instants: the calendar's restart lane and its overlap warnings. */
export function restartsBetween(from: number, to: number, s: RestartSchedule): { at: number; duration: number; kind: 'daily' | 'extra' }[] {
  const seen = new Map<number, { at: number; duration: number; kind: 'daily' | 'extra' }>()
  for (let t = from; t < to + 4 * 86_400_000; t += 3 * 86_400_000) for (const r of restartsAround(t, s)) if (r.at + r.duration > from && r.at < to) seen.set(r.at, r)
  return [...seen.values()].sort((a, b) => a.at - b.at)
}

export function restartState(now: number, s: RestartSchedule): RestartState {
  for (const r of restartsAround(now, s)) {
    if (now >= r.at && now < r.at + r.duration) return { phase: 'restarting', next: r.at, msLeft: r.at + r.duration - now, kind: r.kind }
    if (r.at > now) {
      const msLeft = r.at - now
      return { phase: msLeft <= SOON_MS ? 'soon' : 'normal', next: r.at, msLeft, kind: r.kind }
    }
  }
  /* only if every coming day is skipped */
  return { phase: 'normal', next: now, msLeft: 0 }
}

/** The next restart (always in the future), with "soon" in its last 15 minutes. */
export function nextRestart(now: number, s: RestartSchedule): RestartState {
  const r = restartsAround(now, s).find((x) => x.at > now)
  return r ? { phase: r.at - now <= SOON_MS ? 'soon' : 'normal', next: r.at, msLeft: r.at - now, kind: r.kind } : { phase: 'normal', next: now, msLeft: 0 }
}

/** The last scheduled restart at or before `now`. */
export function previousRestart(now: number, s: RestartSchedule): number {
  const past = restartsAround(now, s).filter((x) => x.at <= now)
  return past.length ? past[past.length - 1].at : restartAt(now, s, -1)
}

/**
 * The restart as the launcher sees it live, from the server itself (checked every few seconds around the restart):
 * restarting = from the scheduled time until the server answers again; back = it just did (shown a little while).
 */
export type LiveRestart = { phase: 'restarting'; since: number; checkedAt: number } | { phase: 'back'; at: number } | null

/** Restart alerts (each one opt-in). */
export interface RestartAlerts {
  before15: boolean
  before1: boolean
  start: boolean
  back: boolean
}
