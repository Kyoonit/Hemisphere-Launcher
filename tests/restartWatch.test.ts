// The daily restart, live: warnings, "restarting" until the server answers again, then "back".
import { describe, expect, test } from 'vitest'
import { RestartTracker } from '../src/main/core/status/restartWatch'
import type { LiveRestart } from '../src/shared/restart'

const schedule = { time: '17:00', timeZone: 'UTC', durationMin: 5 }
const at = (hhmmss: string) => Date.parse(`2026-10-08T${hhmmss}Z`)

function run() {
  let now = at('16:45:20')
  let up = true
  const moments: string[] = []
  const lives: LiveRestart[] = []
  const tracker = new RestartTracker({
    schedule: () => schedule,
    onChange: (l) => lives.push(l),
    onMoment: (m) => moments.push(m),
    check: async () => up,
    now: () => now,
  })
  return { tracker, moments, lives, set: (t: string, u = up) => ((now = at(t)), (up = u)) }
}

describe('restart, live', () => {
  test('15 min and 1 min warnings, then restarting until the server is down and back', async () => {
    const r = run()
    expect(await r.tracker.step()).toBe(false) // 14:40 before: slow checks
    expect(r.moments).toEqual(['warn15'])
    r.set('16:58:45')
    expect(await r.tracker.step()).toBe(true) // within 90 s: fast checks
    r.set('16:59:10')
    await r.tracker.step()
    expect(r.moments).toEqual(['warn15', 'warn1'])
    r.set('17:00:05') // scheduled time, still up: "restarting" already
    expect(await r.tracker.step()).toBe(true)
    expect(r.tracker.live).toMatchObject({ phase: 'restarting' })
    r.set('17:00:30', false) // down
    await r.tracker.step()
    expect(r.moments).toEqual(['warn15', 'warn1', 'start'])
    r.set('17:07:00', false) // longer than the old 5 min guess: still restarting
    await r.tracker.step()
    expect(r.tracker.live).toMatchObject({ phase: 'restarting' })
    r.set('17:07:05', true) // answering again
    await r.tracker.step()
    expect(r.tracker.live).toMatchObject({ phase: 'back' })
    expect(r.moments).toEqual(['warn15', 'warn1', 'start', 'back'])
    r.set('17:10:00', true) // "back" shown a little while, then normal
    await r.tracker.step()
    expect(r.tracker.live).toBeNull()
    expect(r.moments.filter((m) => m === 'back')).toHaveLength(1) // each moment once
  })

  test('never seen down (restarted between two checks, or skipped): back to normal after 90 seconds', async () => {
    const r = run()
    r.set('17:00:10', true)
    await r.tracker.step()
    expect(r.tracker.live).toMatchObject({ phase: 'restarting' })
    r.set('17:01:35', true)
    // answering normally: nothing shown any more, still checked often
    expect(await r.tracker.step()).toBe(true)
    expect(r.tracker.live).toBeNull()
    expect(r.moments).not.toContain('back')
  })

  test('a late restart is still caught after the banner went away', async () => {
    const r = run()
    r.set('17:00:10', true)
    await r.tracker.step()
    r.set('17:02:00', true)
    await r.tracker.step()
    expect(r.tracker.live).toBeNull()
    r.set('17:03:00', false) // down three minutes late
    await r.tracker.step()
    expect(r.tracker.live).toMatchObject({ phase: 'restarting' })
    r.set('17:03:40', true)
    await r.tracker.step()
    expect(r.tracker.live).toMatchObject({ phase: 'back' })
    expect(r.moments).toEqual(['start', 'back'])
  })

  test('down for more than 30 minutes: an outage, not a restart any more', async () => {
    const r = run()
    r.set('17:00:30', false)
    await r.tracker.step()
    r.set('17:31:00', false)
    await r.tracker.step()
    expect(r.tracker.live).toBeNull()
  })
})
