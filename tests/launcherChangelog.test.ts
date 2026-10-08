import { describe, expect, it } from 'vitest'
import { compareVersions, LAUNCHER_CHANGELOG, launcherNotesSince, type LauncherRelease } from '../src/shared/launcherChangelog'

const r = (version: string): LauncherRelease => ({ version, date: '', en: [`en ${version}`], fr: [`fr ${version}`] })
const log = [r('next'), r('1.2.0'), r('1.1.0'), r('1.0.0')]

describe('launcher "What\'s new"', () => {
  it('compares versions by number', () => {
    expect(compareVersions('1.10.0', '1.9.3')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('0.9.9', '1.0.0')).toBeLessThan(0)
  })
  it('shows nothing on a first start', () => {
    expect(launcherNotesSince(log, null, '1.2.0')).toEqual([])
  })
  it('shows every release since the one last seen, newest first, up to the running version', () => {
    expect(launcherNotesSince(log, '1.0.0', '1.2.0').map((x) => x.version)).toEqual(['1.2.0', '1.1.0'])
    expect(launcherNotesSince(log, '1.0.0', '1.1.0').map((x) => x.version)).toEqual(['1.1.0'])
    expect(launcherNotesSince(log, '1.2.0', '1.2.0')).toEqual([])
  })
  it('previews "next" only in development builds', () => {
    // a development build runs the version after the last release; Developer tab > Reset seen shows it
    const dev = [r('next'), r('1.0.0')]
    expect(launcherNotesSince(dev, '1.0.0', '1.1.0', true).map((x) => x.en[0])).toEqual(['en next'])
    expect(launcherNotesSince(dev, '1.0.0', '1.1.0', false)).toEqual([])
  })
  it('every bundled release has as many French lines as English ones', () => {
    for (const rel of LAUNCHER_CHANGELOG) {
      expect(rel.en.length, rel.version).toBe(rel.fr.length)
      if (rel.version !== 'next') expect(rel.version).toMatch(/^\d+\.\d+\.\d+$/)
    }
  })
})
