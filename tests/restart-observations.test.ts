import { describe, expect, it } from 'vitest'
import { observe, scheduleAt, suggestDailyTime, watchedRestart, type RestartObservation } from '../src/shared/restartObservations'

const M = 60_000
const S = 1_000
// 17:05 in Paris on 2026-10-08 (summer time: UTC+2)
const day = (d: number) => Date.UTC(2026, 9, d, 15, 5)
const restart = { rules: [{ from: '2026-01-01T00:00:00Z', time: '17:05', timeZone: 'Europe/Paris', durationMin: 5 }], exceptions: [] }
const schedule = scheduleAt(restart, day(8))!

describe('watching the real restart', () => {
  it('uses the rule in force, with the exceptions', () => {
    const later = { ...restart, rules: [...restart.rules, { from: '2026-12-01T00:00:00Z', time: '06:00', timeZone: 'Europe/Paris', durationMin: 5 }] }
    expect(scheduleAt(later, day(8))?.time).toBe('17:05')
    expect(scheduleAt(later, Date.UTC(2026, 11, 2))?.time).toBe('06:00')
    expect(scheduleAt({ rules: [], exceptions: [] }, day(8))).toBeNull()
  })

  it('watches from 5 minutes before to 20 minutes after, not the rest of the day', () => {
    expect(watchedRestart(day(8) - 4 * M, schedule)).toBe(day(8))
    expect(watchedRestart(day(8) + 19 * M, schedule)).toBe(day(8))
    expect(watchedRestart(day(8) - 6 * M, schedule)).toBeNull()
    expect(watchedRestart(day(8) + 21 * M, schedule)).toBeNull()
    expect(watchedRestart(day(8) + 6 * 3_600_000, schedule)).toBeNull()
  })

  it('notes when it went down, then when it answered again, and nothing else', () => {
    let o: RestartObservation = { scheduledAt: day(8), time: '17:05', timeZone: 'Europe/Paris', downAt: null, upAt: null, checkedUntil: day(8) }
    expect(observe(o, true, day(8) + 5 * S)).toBeNull()
    o = observe(o, false, day(8) + 20 * S)!
    expect(o.downAt).toBe(day(8) + 20 * S)
    expect(observe(o, false, day(8) + 25 * S)).toBeNull()
    o = observe(o, true, day(8) + 65 * S)!
    expect(o).toMatchObject({ downAt: day(8) + 20 * S, upAt: day(8) + 65 * S })
    expect(observe(o, false, day(8) + 90 * S)).toBeNull()
  })
})

describe('a new daily time', () => {
  const seen = (d: number, offset: number, time = '17:05'): RestartObservation => ({ scheduledAt: day(d), time, timeZone: 'Europe/Paris', downAt: day(d) + offset, upAt: day(d) + offset + 50 * S, checkedUntil: day(d) + offset + 50 * S })
  const current = { time: '17:05', timeZone: 'Europe/Paris' }

  it('suggests the real time when the last 3 days agree', () => {
    expect(suggestDailyTime([seen(10, 5 * M + 12 * S), seen(9, 5 * M + 40 * S), seen(8, 4 * M + 50 * S)], current)).toEqual({ time: '17:10', offsetMin: 5 })
    // earlier than planned too
    expect(suggestDailyTime([seen(10, -3 * M), seen(9, -3 * M - 20 * S), seen(8, -2 * M - 30 * S)], current)).toEqual({ time: '17:02', offsetMin: -3 })
  })

  it('suggests nothing for a close time, one late day, mixed days or too few', () => {
    expect(suggestDailyTime([seen(10, 40 * S), seen(9, 30 * S), seen(8, 50 * S)], current)).toBeNull()
    expect(suggestDailyTime([seen(10, 6 * M), seen(9, 20 * S), seen(8, 30 * S)], current)).toBeNull()
    expect(suggestDailyTime([seen(10, 3 * M), seen(9, -3 * M), seen(8, 3 * M)], current)).toBeNull()
    expect(suggestDailyTime([seen(10, 3 * M), seen(9, 9 * M), seen(8, 3 * M)], current)).toBeNull()
    expect(suggestDailyTime([seen(10, 5 * M), seen(9, 5 * M)], current)).toBeNull()
    // a day not seen going down, or watched with another daily time
    expect(suggestDailyTime([seen(10, 5 * M), { ...seen(9, 5 * M), downAt: null }, seen(8, 5 * M)], current)).toBeNull()
    expect(suggestDailyTime([seen(10, 5 * M), seen(9, 5 * M, '17:00'), seen(8, 5 * M)], current)).toBeNull()
  })
})
