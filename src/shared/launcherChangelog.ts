import data from './launcherChangelog.json'

/**
 * The launcher's history in src/shared/launcherChangelog.json: one entry per DAY (newest first), each change tagged
 * with the launcher version that brought it. Every push raises the version (1.0.2, 1.0.3…), so a day can hold several
 * versions; they're shown newest first.
 * Shown in News > Launcher updates (everything) and in Home's "What's new" card (the last 2 days not seen yet).
 */
export const CHANGE_AREAS = ['play', 'home', 'content', 'screenshots', 'community', 'settings', 'performance', 'launcher'] as const
export type ChangeArea = (typeof CHANGE_AREAS)[number]

export interface LauncherChange {
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

/** Only the changes up to the running version (and, with `after`, newer than it); days left empty are dropped. */
export function launcherHistory(log: LauncherDay[], current: string, after: string | null = null): LauncherDay[] {
  return log
    .map((d) => ({ ...d, changes: d.changes.filter((c) => compareVersions(c.version, current) <= 0 && (after === null || compareVersions(c.version, after) > 0)) }))
    .filter((d) => d.changes.length > 0)
}

/** The days with changes a player hasn't seen yet (newer than `seen`). Nothing on a first start (seen = null). */
export function launcherNotesSince(log: LauncherDay[], seen: string | null, current: string): LauncherDay[] {
  return seen === null ? [] : launcherHistory(log, current, seen)
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

/** "1.0.2" or "1.0.1 – 1.0.2" */
export function versionRange(day: LauncherDay): string {
  const v = byVersion(day).map((g) => g.version)
  return v.length === 1 ? v[0] : `${v[v.length - 1]} – ${v[0]}`
}
