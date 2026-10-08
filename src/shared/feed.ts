/**
 * Hemisphere feed (schema 1): news, maintenance and restart schedule, edited by staff in content-src/feed.json and
 * published signed (content/feed.json + feed.json.sig, same Ed25519 key as the client). Shared by launcher + tool.
 */
import { z } from 'zod'
import { CONTENT_BASE, LocalizedSchema } from './manifest.ts'
import { ModPolicySchema } from './modBrowser.ts'
import { EventSchema } from './events.ts'

/** News images: our own content folder or the Hemisphere website. */
export function isAllowedImageUrl(url: string, contentBase = CONTENT_BASE): boolean {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return false
    return url.startsWith(contentBase) || u.hostname === 'hemispheresurvival.club'
  } catch {
    return false
  }
}

/** News buttons open the player's browser: https only. */
const httpsUrl = z.string().refine((s) => {
  try {
    return new URL(s).protocol === 'https:'
  } catch {
    return false
  }
}, 'must be an https:// link')

export const NEWS_CATEGORIES = ['update', 'event', 'server', 'community'] as const

export const NewsItemSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,64}$/),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  category: z.enum(NEWS_CATEGORIES),
  title: LocalizedSchema,
  /** Plain text; blank lines separate paragraphs */
  body: LocalizedSchema,
  image: z.string().refine((u) => isAllowedImageUrl(u), 'image host not allowed').optional(),
  link: z.object({ label: LocalizedSchema, url: httpsUrl }).optional(),
  /** Shown big at the top of the News page */
  featured: z.boolean().optional(),
})
export type NewsItem = z.infer<typeof NewsItemSchema>

export const FeedSchema = z
  .object({
    schema: z.literal(1),
    /** Increases on every publish; older feeds are refused (replay protection) */
    sequence: z.number().int().positive(),
    updatedAt: z.string().datetime(),
    maintenance: z.object({
      active: z.boolean(),
      message: LocalizedSchema,
      /** optional end time shown to players (ISO with timezone) */
      until: z.string().datetime({ offset: true }).optional(),
    }),
    restart: z
      .object({
        time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        timeZone: z.string().min(1),
        durationMin: z.number().int().min(1).max(120),
      })
      .nullable(),
    news: z.array(NewsItemSchema).max(100),
    /** Staff mod policy for the mod browser and players' own mods (optional; older launchers ignore it) */
    modPolicy: ModPolicySchema.optional(),
    /** Where players send problem reports: the Discord ticket channel (optional; else the Discord invite) */
    support: z
      .object({
        url: z.string().refine((u) => {
          try {
            const x = new URL(u)
            return x.protocol === 'https:' && ['discord.com', 'discord.gg', 'www.discord.com', 'ptb.discord.com', 'canary.discord.com'].includes(x.hostname)
          } catch {
            return false
          }
        }, 'must be a Discord link'),
        /** e.g. "#support → Create ticket" */
        howTo: LocalizedSchema.optional(),
      })
      .optional(),
    /** Events calendar (optional): shown in News and on Home, each player in their own time */
    events: z.array(EventSchema).max(50).optional(),
    /** Discord application id for "Playing on Hemisphere SMP" in players' Discord status (optional) */
    discordAppId: z.string().regex(/^\d{17,20}$/).optional(),
    /** Another staff code for the Developer tab (its scrypt fingerprint, from npm run staff-code), optional */
    staffCode: z.object({ salt: z.string().regex(/^[0-9a-f]{32}$/), hash: z.string().regex(/^[0-9a-f]{128}$/) }).optional(),
  })
  .superRefine((f, ctx) => {
    if (f.restart) {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: f.restart.timeZone })
      } catch {
        ctx.addIssue({ code: 'custom', message: `unknown time zone ${f.restart.timeZone}` })
      }
    }
    const ids = new Set<string>()
    for (const n of f.news) {
      if (ids.has(n.id)) ctx.addIssue({ code: 'custom', message: `duplicate news id ${n.id}` })
      ids.add(n.id)
    }
    const eventIds = new Set<string>()
    for (const e of f.events ?? []) {
      if (eventIds.has(e.id)) ctx.addIssue({ code: 'custom', message: `duplicate event id ${e.id}` })
      eventIds.add(e.id)
    }
  })
export type Feed = z.infer<typeof FeedSchema>

/** How many news items the player hasn't seen yet. */
export function unseenNewsCount(news: { id: string }[], seen: readonly string[]): number {
  const s = new Set(seen)
  return news.filter((n) => !s.has(n.id)).length
}

/** Text of the red badge on News: nothing at 0, "9+" above 9. */
export const newsBadgeLabel = (count: number): string | null => (count <= 0 ? null : count > 9 ? '9+' : String(count))

/** Seen ids after opening News: the current ones first, older remembered ones after, capped (settings limit). */
export function markNewsSeen(news: { id: string }[], seen: readonly string[], max = 500): string[] {
  return [...new Set([...news.map((n) => n.id), ...seen])].slice(0, max)
}
