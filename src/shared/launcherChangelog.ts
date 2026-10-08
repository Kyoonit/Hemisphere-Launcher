import data from './launcherChangelog.json'

/**
 * "What's new in the launcher": one entry per GitHub release, newest first, in src/shared/launcherChangelog.json.
 * Changes waiting for the next release go in the "next" entry; `npm run release` turns it into the new version (and
 * refuses to publish a version without notes), so every update players get comes with its "What's new".
 */
export interface LauncherRelease {
  version: string
  date: string
  en: string[]
  fr: string[]
}

export const LAUNCHER_CHANGELOG = data as LauncherRelease[]

const parts = (v: string) => v.split('.').map((n) => Number(n) || 0)
/** <0 when a is older than b */
export function compareVersions(a: string, b: string): number {
  const [x, y] = [parts(a), parts(b)]
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0)
  return 0
}

/**
 * The releases a player hasn't seen yet: newer than `seen`, up to the running version, newest first. Nothing on a first
 * start (seen = null). "next" counts as the running version in development builds only (to preview it).
 */
export function launcherNotesSince(log: LauncherRelease[], seen: string | null, current: string, includeNext = false): LauncherRelease[] {
  if (seen === null) return []
  return log
    .map((r) => (r.version === 'next' ? (includeNext ? { ...r, version: current } : null) : r))
    .filter((r): r is LauncherRelease => !!r && compareVersions(r.version, seen) > 0 && compareVersions(r.version, current) <= 0)
    .filter((r) => r.en.length > 0)
}
