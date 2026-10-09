/**
 * Hemisphere feed, schema 2 (Herald). Published at content/v2/feed.json (+ .sig, same Ed25519 key as everything else)
 * and read by launchers 1.2+ only; launchers 1.1 keep reading the frozen schema 1 feed.json.
 *
 * Everything scheduled is published in advance, LOCKED in a vault (AES-256-GCM): the signed feed only lists the vault
 * (when it opens, its file, the hash of its content). The key comes from the Herald server at the opening time
 * (GET /vault-key/:id, by the server's clock), or later from `vaultKeys` in a newer feed (fallback).
 *
 * Contract rule, forever: fields are ADDED, never removed or renamed. Shared by the launcher, the Herald server and
 * the publisher: whatever Herald publishes is, by construction, what launchers accept.
 */
import { z } from 'zod'
import { LocalizedSchema } from './manifest.ts'
import { FeedSchema, NewsItemSchema } from './feed.ts'
import { ModPolicySchema } from './modBrowser.ts'
import { EventSchema } from './events.ts'

export const FEED_V2_PATH = 'v2/feed.json'
/** The feed as published (sealed: src/shared/sealed.ts); FEED_V2_PATH is now only the launcher's cached plaintext */
export const FEED_V2_SEALED_PATH = 'v2/feed.bin'

const instant = z.string().datetime({ offset: true })
const id = z.string().regex(/^[a-z0-9-]{1,64}$/)
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
const timeZone = z.string().min(1).max(64).refine((tz) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}, 'unknown time zone')
const sha512 = z.string().regex(/^[0-9a-f]{128}$/)
const sha256 = z.string().regex(/^[0-9a-f]{64}$/)
const LANGS = z.array(z.string().regex(/^[a-z]{2}$/)).min(1).max(20)

/** When something is on screen: from `showFrom` (default: always) until `showUntil` (default: until removed). */
const Window = { showFrom: instant.optional(), showUntil: instant.optional() }

/** How a file is stored when it is sealed: its key (base64), the SHA-512 and size of the bytes on GitHub */
export const SealInfoSchema = z.object({ key: z.string().regex(/^[A-Za-z0-9+/]{43}=$/), sha512, size: z.number().int().positive().max(16 * 1024 * 1024) })

/** A file next to the feed: `path` relative to the content folder, integrity by SHA-512 (the feed is signed).
 *  sha512 and size are the PLAIN file's; `seal`: stored sealed (a picture in clear in the feed), opened with its key */
export const ContentFileSchema = z.object({
  path: z.string().regex(/^v2\/(vaults|backgrounds|images)\/[a-z0-9-]{1,80}\.(bin|webp|avif|png|jpg)$/),
  sha512,
  size: z.number().int().positive().max(15 * 1024 * 1024),
  seal: SealInfoSchema.optional(),
})

export const NewsItemV2Schema = NewsItemSchema.extend({
  ...Window,
  /** Picture published next to the feed (Herald), instead of `image`: v2/images/… in clear, or locked with its vault
   *  (v2/vaults/…-img.bin, listed as the vault's `image`); sha512 and size are the PLAIN picture's */
  imageFile: ContentFileSchema.optional(),
  /** Big card at the top of News until then (overrides `featured`) */
  featuredUntil: instant.optional(),
  /** Only for players using one of these languages (default: everyone) */
  langs: LANGS.optional(),
})
export type NewsItemV2 = z.infer<typeof NewsItemV2Schema>

export const MaintenanceSchema = z.object({
  id,
  message: LocalizedSchema,
  /** Announced to players from then ("maintenance planned …"); default: only from `start` */
  announceFrom: instant.optional(),
  start: instant,
  /** Expected end; without one it lasts until the staff ends it (a new feed with `end` set) */
  end: instant.optional(),
})
export type Maintenance = z.infer<typeof MaintenanceSchema>

export const RestartRuleSchema = z.object({
  /** In force from this instant (the newest rule already in force wins) */
  from: instant,
  time: hhmm,
  timeZone,
  durationMin: z.number().int().min(1).max(120),
})
export const RestartExceptionSchema = z.object({
  /** Day, in `timeZone` */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timeZone,
  /** no restart that day */
  skip: z.boolean().optional(),
  /** an extra restart that day */
  extra: z.object({ time: hhmm, durationMin: z.number().int().min(1).max(120) }).optional(),
})
export type RestartRule = z.infer<typeof RestartRuleSchema>
export type RestartException = z.infer<typeof RestartExceptionSchema>

export const EventV2Schema = EventSchema.and(
  z.object({
    showFrom: instant.optional(),
    /** Repeats every week on these days (0 = Sunday) at `time` in `timeZone`; `start`/`end` give the first one */
    recurrence: z
      .object({
        weekly: z.object({ days: z.array(z.number().int().min(0).max(6)).min(1).max(7), time: hhmm, timeZone, durationMin: z.number().int().min(1).max(24 * 60), until: instant.optional() }),
      })
      .optional(),
  }),
)
export type EventV2 = z.infer<typeof EventV2Schema>

export const BannerSchema = z.object({ id, text: LocalizedSchema, level: z.enum(['info', 'important', 'critical']), ...Window })
/** `title` replaces Home's whole heading; `accent` is its second, green line ({player} = the player's name) */
export const WelcomeSchema = z.object({ id, title: LocalizedSchema.optional(), accent: LocalizedSchema.optional(), text: LocalizedSchema, ...Window })
export const BackgroundSchema = z.object({ id, name: LocalizedSchema, image: ContentFileSchema, mode: z.enum(['add', 'replace']), ...Window })
export type Banner = z.infer<typeof BannerSchema>
export type Welcome = z.infer<typeof WelcomeSchema>
export type Background = z.infer<typeof BackgroundSchema>

/** What a vault holds, once opened: one item, of `kind` */
export const VAULT_KINDS = ['news', 'event', 'banner', 'welcome', 'background', 'maintenance', 'restartRule', 'restartException'] as const
export type VaultKind = (typeof VAULT_KINDS)[number]
export const VaultItemSchemas = {
  news: NewsItemV2Schema,
  event: EventV2Schema,
  banner: BannerSchema,
  welcome: WelcomeSchema,
  background: BackgroundSchema,
  maintenance: MaintenanceSchema,
  restartRule: RestartRuleSchema,
  restartException: RestartExceptionSchema,
} as const

export const VaultSchema = z.object({
  id,
  kind: z.enum(VAULT_KINDS),
  /** When the key is given out (server clock) and the item may be shown */
  opensAt: instant,
  file: ContentFileSchema.refine((f) => f.path.startsWith('v2/vaults/') && f.path.endsWith('.bin'), 'vault files live in v2/vaults/*.bin'),
  /** SHA-256 of the decrypted content: only the right key gives it */
  plainSha256: sha256,
  /** The item's picture, locked with the same key (downloaded in advance like the vault) */
  image: ContentFileSchema.refine((f) => f.path.startsWith('v2/vaults/') && f.path.endsWith('.bin'), 'vault files live in v2/vaults/*.bin').optional(),
})
export type Vault = z.infer<typeof VaultSchema>

export const FeedV2Schema = z
  .object({
    schema: z.literal(2),
    sequence: z.number().int().positive(),
    updatedAt: z.string().datetime(),
    news: z.array(NewsItemV2Schema).max(100),
    maintenances: z.array(MaintenanceSchema).max(20),
    restart: z.object({ rules: z.array(RestartRuleSchema).min(1).max(20), exceptions: z.array(RestartExceptionSchema).max(60) }).nullable(),
    events: z.array(EventV2Schema).max(50),
    banners: z.array(BannerSchema).max(20),
    welcome: z.array(WelcomeSchema).max(20),
    backgrounds: z.array(BackgroundSchema).max(60),
    vaults: z.array(VaultSchema).max(200),
    /** Keys of vaults already open (fallback when the Herald server can't be reached) */
    vaultKeys: z.record(id, z.string().regex(/^[A-Za-z0-9+/]{43}=$/)),
    modPolicy: ModPolicySchema.optional(),
    // same rules as schema 1
    support: FeedSchema.shape.support,
    discordAppId: FeedSchema.shape.discordAppId,
    staffCode: FeedSchema.shape.staffCode,
    /** Signed move of the content (an official repository one day): launchers read from there next time */
    contentBase: z.string().regex(/^https:\/\/raw\.githubusercontent\.com\/[\w.-]+\/[\w.-]+\/[\w.-]+\/[\w./-]*\/$/).optional(),
  })
  .superRefine((f, ctx) => {
    const seen = new Set<string>()
    const unique = (kind: string, ids: string[]) => {
      for (const x of ids) {
        if (seen.has(`${kind}:${x}`)) ctx.addIssue({ code: 'custom', message: `duplicate ${kind} id ${x}` })
        seen.add(`${kind}:${x}`)
      }
    }
    unique('news', f.news.map((n) => n.id))
    unique('maintenance', f.maintenances.map((m) => m.id))
    unique('event', f.events.map((e) => e.id))
    unique('banner', f.banners.map((b) => b.id))
    unique('welcome', f.welcome.map((w) => w.id))
    unique('background', f.backgrounds.map((b) => b.id))
    unique('vault', f.vaults.map((v) => v.id))
    for (const k of Object.keys(f.vaultKeys)) if (!seen.has(`vault:${k}`)) ctx.addIssue({ code: 'custom', message: `key for unknown vault ${k}` })
  })
export type FeedV2 = z.infer<typeof FeedV2Schema>
