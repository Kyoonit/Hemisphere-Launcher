import { describe, expect, it } from 'vitest'
import { byArea, CHANGE_AREAS, compareVersions, LAUNCHER_CHANGELOG, launcherNotesSince, visibleHistory, type LauncherDay } from '../src/shared/launcherChangelog'

const day = (date: string, version: string): LauncherDay => ({ date, version, changes: [{ area: 'play', en: `en ${date}`, fr: `fr ${date}` }] })
const log = [day('2026-03-04', 'next'), day('2026-03-03', '1.2.0'), day('2026-03-02', '1.2.0'), day('2026-03-01', '1.1.0'), day('2026-02-01', '1.0.0')]

describe('launcher history', () => {
  it('compares versions by number', () => {
    expect(compareVersions('1.10.0', '1.9.3')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('0.9.9', '1.0.0')).toBeLessThan(0)
  })
  it('shows nothing new on a first start', () => {
    expect(launcherNotesSince(log, null, '1.2.0')).toEqual([])
  })
  it('the days released since the version last seen, newest first, up to the running version', () => {
    expect(launcherNotesSince(log, '1.0.0', '1.2.0').map((d) => d.date)).toEqual(['2026-03-03', '2026-03-02', '2026-03-01'])
    expect(launcherNotesSince(log, '1.1.0', '1.1.0')).toEqual([])
  })
  it('"next" days only in development builds', () => {
    expect(launcherNotesSince(log, '1.2.0', '1.3.0', true).map((d) => d.date)).toEqual(['2026-03-04'])
    expect(launcherNotesSince(log, '1.2.0', '1.3.0', false)).toEqual([])
    expect(visibleHistory(log, false).map((d) => d.date)).not.toContain('2026-03-04')
    expect(visibleHistory(log, true)).toHaveLength(5)
  })
  it('groups a day by area, in a fixed order', () => {
    const d: LauncherDay = { date: '2026-03-05', version: 'next', changes: [{ area: 'settings', en: 'a', fr: 'a' }, { area: 'play', en: 'b', fr: 'b' }, { area: 'settings', en: 'c', fr: 'c' }] }
    expect(byArea(d).map((g) => [g.area, g.changes.length])).toEqual([['play', 1], ['settings', 2]])
  })
  it('the bundled history: one entry per day, newest first, every change in English and French', () => {
    const dates = LAUNCHER_CHANGELOG.map((d) => d.date)
    expect(new Set(dates).size).toBe(dates.length)
    expect([...dates].sort().reverse()).toEqual(dates)
    for (const d of LAUNCHER_CHANGELOG)
      for (const c of d.changes) {
        expect(CHANGE_AREAS).toContain(c.area)
        expect(c.en.trim() && c.fr.trim(), d.date).toBeTruthy()
      }
  })
})
