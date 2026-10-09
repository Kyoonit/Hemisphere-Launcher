/**
 * Herald publisher (plan A, phase S2). Runs in GitHub Actions ("Herald publish" workflow of the content repository),
 * where the content signing key is a repository secret. It asks the Herald server for the newest queued job,
 * validates it with the SAME schema as the launcher, signs the exact file bytes (like tools/content), commits, and
 * reports the commit back (the server's /pulse then points launchers at it).
 *
 * This file is the logic (tested in tests/herald-publisher.test.ts); publish-run.ts is the program (bundled into the
 * content repository by `npm run herald:publisher:build`).
 */
import { sign, type KeyObject } from 'node:crypto'
import { FeedSchema } from '../../src/shared/feed.ts'

export interface PublishJob {
  id: string
  sequence: number
  feed: Record<string, unknown>
}

/** Files to write (paths relative to the repository root) for one job. Throws if the content is invalid. */
export function buildRelease(job: PublishJob, contentDir: string, key: KeyObject, now = new Date()): { path: string; bytes: Buffer }[] {
  if (!/^[a-z0-9-]+$/.test(contentDir)) throw new Error(`bad content folder: ${contentDir}`)
  const feed = FeedSchema.parse({ ...job.feed, schema: 1, sequence: job.sequence, updatedAt: now.toISOString() })
  const bytes = Buffer.from(JSON.stringify(feed, null, 2) + '\n')
  return [
    { path: `${contentDir}/feed.json`, bytes },
    { path: `${contentDir}/feed.json.sig`, bytes: Buffer.from(sign(null, bytes, key).toString('base64') + '\n') },
  ]
}

/** One line a human can read in the job's error (zod lists every problem). */
export const errorText = (err: unknown): string =>
  err && typeof err === 'object' && 'issues' in err && Array.isArray(err.issues)
    ? err.issues.map((i: { path: unknown[]; message: string }) => `${i.path.join('.') || '(root)'}: ${i.message}`).join(' · ')
    : err instanceof Error ? err.message : String(err)
