import { connect } from 'node:net'
import { SERVER } from '@shared/server'
import { nextRestart, previousRestart, type LiveRestart, type RestartSchedule } from '@shared/restart'

/**
 * The daily restart, live: from 90 s before the scheduled time the server itself is checked every 5 s (a direct
 * connection: the public status service caches its answer for minutes). "Restarting" lasts from the scheduled time
 * until the server is seen down and then answering again — no guessed duration.
 *
 * Moments, each sent once per restart: warn15 (15 min before), warn1 (1 min before), start (server seen down),
 * back (answering again).
 */
export type RestartMoment = 'warn15' | 'warn1' | 'start' | 'back'

const FAST_MS = 5_000
const PREWARN_MS = 90_000
/** never seen down this long after the scheduled time: it restarted between two checks, or not at all */
const NO_SHOW_MS = 5 * 60_000
/** down longer than this: not a restart any more, an outage (the normal status says offline) */
const OUTAGE_MS = 30 * 60_000
const BACK_SHOWN_MS = 2 * 60_000

/** Is the server accepting connections right now? */
export function serverAnswers(timeoutMs = 3_000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: SERVER.host, port: SERVER.port, timeout: timeoutMs })
    const done = (ok: boolean) => {
      socket.destroy()
      resolve(ok)
    }
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

export interface RestartWatchHooks {
  schedule(): RestartSchedule | null
  /** live state changed (for the page) */
  onChange(live: LiveRestart): void
  onMoment(moment: RestartMoment, at: number): void
  /** checking now, for tests */
  check?: () => Promise<boolean>
  now?: () => number
}

/** Pure step: what to do at `now` given the tracked restart (exported for tests). */
export class RestartTracker {
  live: LiveRestart = null
  private sent = new Set<string>()
  private seenDownAt: number | null = null
  private trackedAt: number | null = null

  constructor(private readonly hooks: RestartWatchHooks) {}

  private emit(moment: RestartMoment, at: number, occurrence: number) {
    const key = `${occurrence}:${moment}`
    if (this.sent.has(key)) return
    this.sent.add(key)
    this.hooks.onMoment(moment, at)
  }

  private set(live: LiveRestart) {
    if (JSON.stringify(live) === JSON.stringify(this.live)) return
    this.live = live
    this.hooks.onChange(live)
  }

  /** true = keep checking fast */
  async step(): Promise<boolean> {
    const s = this.hooks.schedule()
    const now = (this.hooks.now ?? Date.now)()
    if (!s) {
      this.set(null)
      return false
    }
    const next = nextRestart(now, s)
    // warnings before the next one
    if (next.msLeft <= 15 * 60_000 && next.msLeft > 14 * 60_000) this.emit('warn15', now, next.next)
    if (next.msLeft <= 60_000 && next.msLeft > 0) this.emit('warn1', now, next.next)

    const last = previousRestart(now, s)
    const since = now - last
    // the restart that just started (or is still going)
    if (since < OUTAGE_MS && (this.trackedAt === last || since < NO_SHOW_MS)) {
      if (this.trackedAt !== last) {
        this.trackedAt = last
        this.seenDownAt = null
      }
      const up = await (this.hooks.check ?? serverAnswers)()
      const t = (this.hooks.now ?? Date.now)()
      if (!up) {
        if (this.seenDownAt === null) {
          this.seenDownAt = t
          this.emit('start', t, last)
        }
        this.set({ phase: 'restarting', since: last, checkedAt: t })
        return true
      }
      if (this.seenDownAt !== null) {
        // down, then answering again: it's back
        if (this.live?.phase === 'restarting') {
          this.emit('back', t, last)
          this.set({ phase: 'back', at: t })
        }
        if (this.live?.phase === 'back' && t - this.live.at > BACK_SHOWN_MS) this.set(null)
        return this.live !== null
      }
      // scheduled time passed, not seen down yet: restarting soon/now
      if (since < NO_SHOW_MS) {
        this.set({ phase: 'restarting', since: last, checkedAt: t })
        return true
      }
      this.set(null)
      return false
    }
    if (this.live?.phase === 'back' && now - this.live.at <= BACK_SHOWN_MS) return false
    this.set(null)
    // fast checks shortly before the scheduled time (to catch the start)
    return next.msLeft <= PREWARN_MS
  }
}

/** Runs the tracker: every 5 s near a restart, every 30 s otherwise (only the clock, no network then). */
export function startRestartWatch(hooks: RestartWatchHooks): RestartTracker {
  const tracker = new RestartTracker(hooks)
  const loop = async () => {
    let fast = false
    try {
      fast = await tracker.step()
    } catch (err) {
      console.warn('[restart] check failed:', err)
    }
    setTimeout(() => void loop(), fast ? FAST_MS : 30_000).unref()
  }
  void loop()
  return tracker
}
