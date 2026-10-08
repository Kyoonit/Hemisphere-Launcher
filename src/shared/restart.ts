/**
 * Daily restart schedule, expressed in the server's time zone and converted to absolute instants.
 * Uses the IANA time-zone database built into the runtime, so daylight saving is handled.
 */

export interface RestartSchedule {
  time: string // "HH:mm" in timeZone
  timeZone: string
  durationMin: number
}

export type RestartPhase = 'normal' | 'soon' | 'restarting'

export interface RestartState {
  phase: RestartPhase
  next: number // epoch ms of the next restart
  msLeft: number // until next restart (or until back online when restarting)
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

export function restartState(now: number, s: RestartSchedule): RestartState {
  const duration = s.durationMin * 60_000
  for (let day = -1; day <= 2; day++) {
    const at = restartAt(now, s, day)
    if (now >= at && now < at + duration) return { phase: 'restarting', next: at, msLeft: at + duration - now }
    if (at > now) {
      const msLeft = at - now
      return { phase: msLeft <= SOON_MS ? 'soon' : 'normal', next: at, msLeft }
    }
  }
  /* unreachable: a restart exists within the next two days */
  return { phase: 'normal', next: now, msLeft: 0 }
}

/** The next restart (always in the future), with "soon" in its last 15 minutes. */
export function nextRestart(now: number, s: RestartSchedule): RestartState {
  for (let day = -1; day <= 2; day++) {
    const at = restartAt(now, s, day)
    if (at > now) return { phase: at - now <= SOON_MS ? 'soon' : 'normal', next: at, msLeft: at - now }
  }
  return { phase: 'normal', next: now, msLeft: 0 }
}

/** The last scheduled restart at or before `now`. */
export function previousRestart(now: number, s: RestartSchedule): number {
  for (let day = 1; day >= -2; day--) {
    const at = restartAt(now, s, day)
    if (at <= now) return at
  }
  return restartAt(now, s, -1)
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
