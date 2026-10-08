import data from './launcherChangelog.json'

/**
 * The launcher's history, one entry per DAY (not per push), newest first, in src/shared/launcherChangelog.json.
 * Shown in News > Launcher (everything) and in Home's "What's new" card (the last 2 days a player hasn't seen yet).
 *
 * - Changes are added to today's entry as they're pushed (a new day = a new entry at the top).
 * - Entries not released yet have version "next"; `npm run release` gives them the new version number (and refuses
 *   to publish when there's nothing new), so every update players get comes with its notes.
 */
export const CHANGE_AREAS = ['play', 'home', 'content', 'screenshots', 'community', 'settings', 'performance', 'launcher'] as const
export type ChangeArea = (typeof CHANGE_AREAS)[number]

export interface LauncherChange {
  area: ChangeArea
  en: string
  fr: string
}
export interface LauncherDay {
  /** YYYY-MM-DD */
  date: string
  /** the release that brought these changes to players; "next" = not released yet */
  version: string
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

/**
 * The days a player hasn't seen yet: released after `seen`, up to the running version, newest first. Nothing on a first
 * start (seen = null). "next" counts as the running version in development builds only (to preview it).
 */
export function launcherNotesSince(log: LauncherDay[], seen: string | null, current: string, includeNext = false): LauncherDay[] {
  if (seen === null) return []
  return log
    .map((d) => (d.version === 'next' ? (includeNext ? { ...d, version: current } : null) : d))
    .filter((d): d is LauncherDay => !!d && d.changes.length > 0 && compareVersions(d.version, seen) > 0 && compareVersions(d.version, current) <= 0)
}

/** The history players can see: released days (and "next" in development builds), newest first. */
export const visibleHistory = (log: LauncherDay[], includeNext: boolean) => log.filter((d) => d.changes.length > 0 && (includeNext || d.version !== 'next'))

/** A day's changes by area, in the CHANGE_AREAS order. */
export function byArea(day: LauncherDay): { area: ChangeArea; changes: LauncherChange[] }[] {
  return CHANGE_AREAS.map((area) => ({ area, changes: day.changes.filter((c) => c.area === area) })).filter((g) => g.changes.length > 0)
}
