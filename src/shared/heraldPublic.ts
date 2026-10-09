/**
 * Herald's public settings (phase S9): the support link, the Discord application id, and the staff code that unlocks
 * the launcher's Developer tab. Kept by the Herald server in its settings and published in the feed (same fields and
 * rules as schema 1). The staff code is generated in the Herald app: only its scrypt fingerprint leaves the PC.
 */
import { z } from 'zod'
import { FeedSchema } from './feed.ts'

export const PublicSettingsSchema = z.object({
  support: FeedSchema.shape.support,
  discordAppId: FeedSchema.shape.discordAppId,
  staffCode: FeedSchema.shape.staffCode,
})
export type PublicSettings = z.infer<typeof PublicSettingsSchema>

/** What the launcher has today (content-src/feed.json): Herald starts from the same values */
export const DEFAULT_PUBLIC: PublicSettings = { discordAppId: '1557889951620931644' }

/** Same alphabet and shape as `npm run staff-code` (no 0/O/1/I/L) */
export const STAFF_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const staffCodeFrom = (random: Uint8Array) => {
  const part = (i: number) => [...random.subarray(i * 4, i * 4 + 4)].map((b) => STAFF_CODE_ALPHABET[b % STAFF_CODE_ALPHABET.length]).join('')
  return `HEMI-${part(0)}-${part(1)}-${part(2)}`
}
