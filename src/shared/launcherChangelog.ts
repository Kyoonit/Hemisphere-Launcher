import data from './launcherChangelog.json'

/**
 * The launcher's history in src/shared/launcherChangelog.json: one entry per DAY (newest first). Each change carries
 * the release that brought it (1.0.19, then 1.1.0, 1.2.0… shown as 1.1, 1.2), or "next" until `npm run release`
 * publishes it (players never see "next"; development builds show it as the running version).
 * Shown in News > Launcher updates (everything) and in Home's "What's new" card (the last 2 days).
 */
export const CHANGE_AREAS = ['play', 'home', 'content', 'screenshots', 'community', 'settings', 'performance', 'launcher'] as const
export type ChangeArea = (typeof CHANGE_AREAS)[number]

export interface LauncherChange {
  /** x.y.z, or "next" (not released yet) */
  version: string
  area: ChangeArea
  en: string
  fr: string
}
export interface LauncherDay {
  /** YYYY-MM-DD */
  date: string
  changes: LauncherChange[]
}

export const LAUNCHER_CHANGELOG = data as LauncherDay[]

const parts = (v: string) => v.split('.').map((n) => Number(n) || 0)
/** <0 when a is older than b */
export function compareVersions(a: string, b: string): number {
  const [x, y] = [parts(a), parts(b)]
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0)
  return 0
}

/** How players see a version: 1.1.0 -> "1.1", 1.0.19 -> "1.0.19". */
export const displayVersion = (v: string) => v.replace(/^(\d+\.\d+)\.0$/, '$1')

/**
 * The changes up to the running version (newer than `after` when given), days left empty dropped. "next" changes
 * count as the running version in development builds only.
 */
export function launcherHistory(log: LauncherDay[], current: string, after: string | null = null, includeNext = false): LauncherDay[] {
  return log
    .map((d) => ({
      ...d,
      changes: d.changes
        .map((c) => (c.version === 'next' ? (includeNext ? { ...c, version: current } : null) : c))
        .filter((c): c is LauncherChange => !!c && compareVersions(c.version, current) <= 0 && (after === null || compareVersions(c.version, after) > 0)),
    }))
    .filter((d) => d.changes.length > 0)
}

/** A day's versions, newest first, each with its changes. */
export function byVersion(day: LauncherDay): { version: string; changes: LauncherChange[] }[] {
  const versions = [...new Set(day.changes.map((c) => c.version))].sort((a, b) => compareVersions(b, a))
  return versions.map((version) => ({ version, changes: day.changes.filter((c) => c.version === version) }))
}

/** Changes by area, in the CHANGE_AREAS order. */
export function byArea(changes: LauncherChange[]): { area: ChangeArea; changes: LauncherChange[] }[] {
  return CHANGE_AREAS.map((area) => ({ area, changes: changes.filter((c) => c.area === area) })).filter((g) => g.changes.length > 0)
}

/** "1.1" or "1.1 – 1.2" */
export function versionRange(day: LauncherDay): string {
  const v = byVersion(day).map((g) => displayVersion(g.version))
  return v.length === 1 ? v[0] : `${v[v.length - 1]} – ${v[0]}`
}
