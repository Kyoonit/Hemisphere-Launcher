/**
 * Herald publications (phase S5): news, announcement banners, welcome messages. Shared by the Herald server (which
 * stores and publishes them) and the Herald app (editor, preview, time travel).
 *
 * A publication is edited as DATA (texts per language, schedule, options) and turned into a schema 2 feed item by
 * `feedItem`. Its life: draft → in review → ready (locked) → published (its data at that moment goes in the feed).
 * Reopening a published one edits a new draft; the published version stays online until it is published again.
 */
import { z } from 'zod'
import { NEWS_CATEGORIES } from './feed.ts'
import type { FeedV2 } from './feedV2.ts'
import type { Localized } from './manifest.ts'

export const PUBLICATION_KINDS = ['news', 'banner', 'welcome'] as const
export type PublicationKind = (typeof PUBLICATION_KINDS)[number]
export const KIND_LABEL: Record<PublicationKind, string> = { news: 'News', banner: 'Banner', welcome: 'Welcome message' }

export const STATUSES = ['draft', 'review', 'ready'] as const
export type Status = (typeof STATUSES)[number]
export const STATUS_LABEL: Record<Status, string> = { draft: 'Draft', review: 'In review', ready: 'Ready' }

/** Languages a text can be written in. English is required; the others are added by hand (no automatic translation). */
export const TEXT_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'es', name: 'Spanish' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'nl', name: 'Dutch' },
  { code: 'pl', name: 'Polish' },
] as const
export const languageName = (code: string) => TEXT_LANGUAGES.find((l) => l.code === code)?.name ?? code

/** Text fields of each kind (per language) */
export const FIELDS: Record<PublicationKind, readonly string[]> = {
  news: ['title', 'body', 'linkLabel'],
  banner: ['text'],
  welcome: ['title', 'accent', 'text'],
}
export const LIMITS: Record<string, number> = { title: 120, accent: 60, body: 4000, linkLabel: 40, text: 200 }
/** Feed ids of the items in the feed (and in the vault list) */
export const PUBLICATION_ID = /^(n|b|w)-[a-z0-9]{12}$/
export const ID_PREFIX: Record<PublicationKind, string> = { news: 'n', banner: 'b', welcome: 'w' }

const lang = z.string().regex(/^[a-z]{2}$/)
const instant = z.string().datetime({ offset: true })

/** Largest image a publication can carry (the Herald app compresses to WebP first) */
export const MAX_IMAGE_BYTES = 1_500_000

/** An uploaded image (WebP, made by the Herald app): its id is the SHA-256 of the file */
export const ImageRefSchema = z.object({
  id: z.string().regex(/^[0-9a-f]{64}$/),
  sha512: z.string().regex(/^[0-9a-f]{128}$/),
  size: z.number().int().positive().max(MAX_IMAGE_BYTES),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
})
export type ImageRef = z.infer<typeof ImageRefSchema>

export const ScheduleSchema = z.object({
  /** First shown at (null = as soon as it is published) */
  from: instant.nullable(),
  /** Taken down at (null = stays until removed) */
  until: instant.nullable(),
  /** The zone the times were entered in (news date, display in Herald) */
  zone: z.string().min(1).max(64),
})
export type Schedule = z.infer<typeof ScheduleSchema>

export const PublicationDataSchema = z.object({
  texts: z.record(lang, z.record(z.string(), z.string().max(4000))),
  /** Language → translation finished (English always counts as written) */
  done: z.record(lang, z.boolean()),
  schedule: ScheduleSchema,
  /** news */
  category: z.enum(NEWS_CATEGORIES).optional(),
  image: ImageRefSchema.nullable().optional(),
  linkUrl: z.string().max(500).nullable().optional(),
  /** news: big card at the top of News for this many days (0 = no) */
  featuredDays: z.number().int().min(0).max(60).optional(),
  /** banner */
  level: z.enum(['info', 'important', 'critical']).optional(),
  /** Only some roles see this draft in Herald (empty = everyone) */
  visibleTo: z.array(z.string()).max(5).optional(),
})
export type PublicationData = z.infer<typeof PublicationDataSchema>

export function emptyData(kind: PublicationKind, zone: string): PublicationData {
  return {
    texts: { en: {} },
    done: {},
    schedule: { from: null, until: null, zone },
    ...(kind === 'news' ? { category: 'update' as const, image: null, linkUrl: null, featuredDays: 3 } : {}),
    ...(kind === 'banner' ? { level: 'info' as const } : {}),
  }
}

/** What a publication looks like on the server and in the app */
export interface Publication {
  id: string
  kind: PublicationKind
  status: Status
  data: PublicationData
  /** The version in the feed (null = never published, or unpublished) */
  published: PublicationData | null
  publishedAt: number | null
  publishedBy: string | null
  version: number
  createdBy: string | null
  createdAt: number
  updatedBy: string | null
  updatedAt: number
  deletedAt: number | null
  /** Soft lock: who is editing it right now */
  editing: { by: string; name: string; until: number } | null
}

// ------------------------------------------------------------------------------------------------ checks

const httpsLink = (url: string) => {
  try {
    return new URL(url).protocol === 'https:'
  } catch {
    return false
  }
}

/** Languages that go to players: English, plus each one marked done that has its required texts. */
export function languagesOut(kind: PublicationKind, data: PublicationData): string[] {
  const required = kind === 'news' ? ['title', 'body'] : ['text']
  return Object.keys(data.texts).filter((l) => (l === 'en' || data.done[l]) && required.every((f) => data.texts[l]?.[f]?.trim()))
}

/** Why this cannot be marked Ready or published yet (empty = fine). */
export function problems(kind: PublicationKind, data: PublicationData, now = Date.now()): string[] {
  const out: string[] = []
  const en = data.texts.en ?? {}
  if (kind === 'news' && !en.title?.trim()) out.push('The English title is missing.')
  if (kind === 'news' && !en.body?.trim()) out.push('The English text is missing.')
  if (kind !== 'news' && !en.text?.trim()) out.push('The English text is missing.')
  for (const [l, fields] of Object.entries(data.texts))
    for (const [f, v] of Object.entries(fields)) if (v.length > (LIMITS[f] ?? 4000)) out.push(`${languageName(l)} ${f}: ${v.length}/${LIMITS[f]} characters.`)
  for (const l of Object.keys(data.texts)) if (l !== 'en' && data.done[l] && !languagesOut(kind, data).includes(l)) out.push(`${languageName(l)} is marked done but a text is missing.`)
  if (kind === 'news' && data.linkUrl && !httpsLink(data.linkUrl)) out.push('The link must start with https://.')
  if (kind === 'news' && data.linkUrl && !en.linkLabel?.trim()) out.push('The link needs a button text.')
  const { from, until } = data.schedule
  if (from && until && Date.parse(until) <= Date.parse(from)) out.push('The end is before the start.')
  if (until && Date.parse(until) <= now) out.push('The end is already past.')
  return out
}

// ------------------------------------------------------------------------------------------------ to the feed

const localized = (kind: PublicationKind, data: PublicationData, field: string): Localized | undefined => {
  const out: Record<string, string> = {}
  for (const l of languagesOut(kind, data)) {
    const v = data.texts[l]?.[field]?.trim()
    if (v) out[l] = v
  }
  return out.en ? (out as Localized) : undefined
}

/** YYYY-MM-DD of an instant in a zone */
export function dayIn(at: number, zone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
  } catch {
    return new Date(at).toISOString().slice(0, 10)
  }
}

export const imagePath = (image: ImageRef) => `v2/images/${image.id}.webp`

/** The schema 2 feed item of a publication, as published at `publishedAt` (the time "as soon as published" means). */
export function feedItem(id: string, kind: PublicationKind, data: PublicationData, publishedAt: number): Record<string, unknown> {
  const from = data.schedule.from ?? new Date(publishedAt).toISOString()
  const until = data.schedule.until ? { showUntil: data.schedule.until } : {}
  if (kind === 'banner') return { id, text: localized(kind, data, 'text'), level: data.level ?? 'info', showFrom: from, ...until }
  if (kind === 'welcome') {
    const title = localized(kind, data, 'title')
    const accent = localized(kind, data, 'accent')
    return { id, ...(title ? { title } : {}), ...(title && accent ? { accent } : {}), text: localized(kind, data, 'text'), showFrom: from, ...until }
  }
  const label = localized(kind, data, 'linkLabel')
  const days = data.featuredDays ?? 0
  return {
    id,
    date: dayIn(Date.parse(from), data.schedule.zone),
    category: data.category ?? 'update',
    title: localized(kind, data, 'title'),
    body: localized(kind, data, 'body'),
    ...(data.linkUrl && label ? { link: { label, url: data.linkUrl } } : {}),
    ...(data.image ? { imageFile: { path: imagePath(data.image), sha512: data.image.sha512, size: data.image.size } } : {}),
    ...(days > 0 ? { featuredUntil: new Date(Date.parse(from) + days * 86_400_000).toISOString() } : {}),
    showFrom: from,
    ...until,
  }
}

/** Feed parts Herald does not edit yet (maintenance, restart, events, backgrounds, public settings: later phases) */
export type FeedBase = Omit<FeedV2, 'schema' | 'sequence' | 'updatedAt' | 'news' | 'banners' | 'welcome' | 'vaults' | 'vaultKeys'>

/** Items ended more than this long ago leave the feed (they stay in Herald's history) */
export const ENDED_KEEP_MS = 7 * 86_400_000

export interface PublishedPublication {
  id: string
  kind: PublicationKind
  data: PublicationData
  publishedAt: number
}

/** The feed content (before vaults) made of the published publications and the other parts. */
export function feedDraft(pubs: PublishedPublication[], base: FeedBase, now: number) {
  const items = { news: [] as Record<string, unknown>[], banners: [] as Record<string, unknown>[], welcome: [] as Record<string, unknown>[] }
  const list = { news: items.news, banner: items.banners, welcome: items.welcome }
  for (const p of [...pubs].sort((a, b) => b.publishedAt - a.publishedAt)) {
    if (p.data.schedule.until && Date.parse(p.data.schedule.until) < now - ENDED_KEEP_MS) continue
    list[p.kind].push(feedItem(p.id, p.kind, p.data, p.publishedAt))
  }
  return { ...base, news: items.news.slice(0, 100), banners: items.banners.slice(0, 20), welcome: items.welcome.slice(0, 20) }
}

/** A feed with everything in clear (no vaults), for Herald's preview and time travel: resolveFeed shows it as a player would. */
export function clearFeed(draft: ReturnType<typeof feedDraft>, sequence = 1): FeedV2 {
  return { schema: 2, sequence, updatedAt: new Date(0).toISOString(), ...draft, vaults: [], vaultKeys: {} } as unknown as FeedV2
}

export const DEFAULT_FEED_BASE = (restart: { time: string; timeZone: string; durationMin: number }): FeedBase => ({
  maintenances: [],
  restart: { rules: [{ from: '2026-01-01T00:00:00Z', ...restart }], exceptions: [] },
  events: [],
  backgrounds: [],
})

/** Ready-made maintenance messages (Server tab); the staff can change them (permission templates.write) */
export interface MessageTemplate {
  id: string
  name: string
  text: string
}
export const DEFAULT_MAINTENANCE_TEMPLATES: MessageTemplate[] = [
  { id: 't-quick', name: 'Quick maintenance', text: 'Quick maintenance: back in about 30 minutes.' },
  { id: 't-crash', name: 'Crash', text: 'The server crashed, we are on it. Back as soon as possible.' },
  { id: 't-update', name: 'Server update', text: 'Server update in progress: back soon with new content!' },
  { id: 't-planned', name: 'Planned maintenance', text: 'Planned maintenance: the server will be closed for a while.' },
]
