import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { byArea, byVersion, CHANGE_AREAS, compareVersions, displayVersion, LAUNCHER_CHANGELOG, launcherHistory, versionRange, type LauncherDay } from '../src/shared/launcherChangelog'

const c = (version: string, area: 'play' | 'settings' = 'play') => ({ version, area, en: `en ${version}`, fr: `fr ${version}` })
const log: LauncherDay[] = [
  { date: '2026-03-03', changes: [c('next'), c('1.2.0'), c('1.2.0', 'settings')] },
  { date: '2026-03-02', changes: [c('1.1.0')] },
  { date: '2026-03-01', changes: [c('1.0.19')] },
]

describe('launcher history', () => {
  it('compares versions by number and shows releases as 1.1, 1.2…', () => {
    expect(compareVersions('1.10.0', '1.9.3')).toBeGreaterThan(0)
    expect(compareVersions('1.1', '1.1.0')).toBe(0)
    expect(displayVersion('1.1.0')).toBe('1.1')
    expect(displayVersion('1.0.19')).toBe('1.0.19')
  })
  it('players see the released changes up to their version, never "next"', () => {
    expect(launcherHistory(log, '1.2.0').flatMap((d) => d.changes.map((x) => x.version))).toEqual(['1.2.0', '1.2.0', '1.1.0', '1.0.19'])
    expect(launcherHistory(log, '1.1.0').map((d) => d.date)).toEqual(['2026-03-02', '2026-03-01'])
    expect(launcherHistory(log, '1.2.0', '1.1.0').map((d) => d.date)).toEqual(['2026-03-03'])
  })
  it('development builds also show "next", as the running version', () => {
    expect(launcherHistory(log, '1.2.0', null, true)[0].changes.map((x) => x.version)).toEqual(['1.2.0', '1.2.0', '1.2.0'])
  })
  it('a day lists its versions newest first, and its changes by area', () => {
    const day: LauncherDay = { date: '2026-03-04', changes: [c('1.1.0'), c('1.2.0'), c('1.2.0', 'settings')] }
    expect(byVersion(day).map((g) => [g.version, g.changes.length])).toEqual([['1.2.0', 2], ['1.1.0', 1]])
    expect(versionRange(day)).toBe('1.1 – 1.2')
    expect(byArea(log[0].changes).map((g) => g.area)).toEqual(['play', 'settings'])
    expect(versionRange(log[1])).toBe('1.1')
  })
  it('the bundled history: one entry per day, newest first, every change complete', () => {
    const dates = LAUNCHER_CHANGELOG.map((d) => d.date)
    expect(new Set(dates).size).toBe(dates.length)
    expect([...dates].sort().reverse()).toEqual(dates)
    for (const d of LAUNCHER_CHANGELOG)
      for (const x of d.changes) {
        expect(CHANGE_AREAS).toContain(x.area)
        expect(x.version).toMatch(/^(\d+\.\d+\.\d+|next)$/)
        expect(x.en.trim() && x.fr.trim(), d.date).toBeTruthy()
      }
  })
  it('versions only change with a release: nothing newer than package.json except "next"', () => {
    const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
    for (const d of LAUNCHER_CHANGELOG) for (const x of d.changes) if (x.version !== 'next') expect(compareVersions(x.version, version), x.en).toBeLessThanOrEqual(0)
  })
})
