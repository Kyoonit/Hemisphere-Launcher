import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { byArea, byVersion, CHANGE_AREAS, compareVersions, LAUNCHER_CHANGELOG, launcherHistory, launcherNotesSince, versionRange, type LauncherDay } from '../src/shared/launcherChangelog'

const c = (version: string, area: 'play' | 'settings' = 'play') => ({ version, area, en: `en ${version}`, fr: `fr ${version}` })
const log: LauncherDay[] = [
  { date: '2026-03-03', changes: [c('1.0.5'), c('1.0.4'), c('1.0.4', 'settings')] },
  { date: '2026-03-02', changes: [c('1.0.3')] },
  { date: '2026-03-01', changes: [c('1.0.2'), c('1.0.1')] },
]

describe('launcher history', () => {
  it('compares versions by number', () => {
    expect(compareVersions('1.10.0', '1.9.3')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('0.9.9', '1.0.0')).toBeLessThan(0)
  })
  it('shows nothing new on a first start', () => {
    expect(launcherNotesSince(log, null, '1.0.5')).toEqual([])
  })
  it('the changes newer than the version last seen, up to the running one, still grouped by day', () => {
    const days = launcherNotesSince(log, '1.0.2', '1.0.4')
    expect(days.map((d) => d.date)).toEqual(['2026-03-03', '2026-03-02'])
    expect(days[0].changes.map((x) => x.version)).toEqual(['1.0.4', '1.0.4'])
    expect(launcherNotesSince(log, '1.0.5', '1.0.5')).toEqual([])
  })
  it('never shows changes from a version newer than the running launcher', () => {
    expect(launcherHistory(log, '1.0.3').map((d) => d.date)).toEqual(['2026-03-02', '2026-03-01'])
  })
  it('a day lists its versions newest first, and its changes by area', () => {
    expect(byVersion(log[0]).map((g) => [g.version, g.changes.length])).toEqual([['1.0.5', 1], ['1.0.4', 2]])
    expect(byArea(log[0].changes).map((g) => g.area)).toEqual(['play', 'settings'])
    expect(versionRange(log[0])).toBe('1.0.4 – 1.0.5')
    expect(versionRange(log[1])).toBe('1.0.3')
  })
  it('the bundled history: one entry per day, newest first, every change complete', () => {
    const dates = LAUNCHER_CHANGELOG.map((d) => d.date)
    expect(new Set(dates).size).toBe(dates.length)
    expect([...dates].sort().reverse()).toEqual(dates)
    for (const d of LAUNCHER_CHANGELOG)
      for (const x of d.changes) {
        expect(CHANGE_AREAS).toContain(x.area)
        expect(x.version).toMatch(/^\d+\.\d+\.\d+$/)
        expect(x.en.trim() && x.fr.trim(), d.date).toBeTruthy()
      }
  })
  it('every push raises the version: the newest change is the launcher version in package.json', () => {
    const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
    const newest = LAUNCHER_CHANGELOG.flatMap((d) => d.changes.map((x) => x.version)).sort(compareVersions).pop()
    expect(newest).toBe(version)
  })
})
