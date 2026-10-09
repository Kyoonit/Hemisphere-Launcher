/** The Herald server players' launchers talk to (pulse every 2 minutes, vault keys at their opening time). */
export const HERALD_URL = 'https://herald.hemisphere-launcher.workers.dev'

/**
 * Where Herald publishes (schema 2 feed, vaults, backgrounds): a PUBLIC repository dedicated to content (owner's
 * decision, S3), so the launcher repository can become private. Created at go-live (S12); a signed contentBase in the
 * feed can still move it later without a launcher update.
 */
export const HERALD_CONTENT_BASE = 'https://raw.githubusercontent.com/Kyoonit/hemisphere-content/main/content/'

/** How often the launcher asks the Herald server whether something was published. */
export const PULSE_MS = 2 * 60_000

/**
 * The content folder at one exact commit: raw.githubusercontent.com caches branch URLs up to 5 minutes, a commit URL
 * is fresh at once (measured in Herald phase S2). null when the base is not a GitHub raw branch URL.
 */
export function contentAtCommit(base: string, commit: string): string | null {
  if (!/^[0-9a-f]{40}$/.test(commit)) return null
  let u: URL
  try {
    u = new URL(base)
  } catch {
    return null
  }
  const parts = u.pathname.split('/')
  // ['', owner, repo, branch, ...folders, '']
  if (u.protocol !== 'https:' || u.hostname !== 'raw.githubusercontent.com' || parts.length < 5 || !parts[3]) return null
  parts[3] = commit
  return `https://raw.githubusercontent.com${parts.join('/')}`
}

/** Server clock − this PC's clock (ms), from one answer: half the round trip is the usual estimate. */
export const clockOffset = (serverNow: number, sentAt: number, receivedAt: number) => serverNow - Math.round((sentAt + receivedAt) / 2)
