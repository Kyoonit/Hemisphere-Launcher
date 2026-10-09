/**
 * Home backgrounds managed from Herald (phase S8), by PERIOD: "All year" (added to the launcher's built-in pictures)
 * and dated periods (Halloween, Christmas…) that either show only their pictures or add them to the others.
 * Kept by the Herald server in its settings, turned into the feed's `backgrounds[]` by `backgroundItems`; a period
 * still to come is locked in vaults like every scheduled item (its pictures too).
 */
import { z } from 'zod'
import { ImageRefSchema, type ImageRef } from './heraldPublications.ts'
import { zonedTime } from './schedule.ts'

export const ALL_YEAR = 'all-year'
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const BackgroundPictureSchema = z.object({
  image: ImageRefSchema,
  /** Shown at the bottom left of Home, like the built-in ones ("Spawn", "Halloween village"…) */
  caption: z.string().trim().min(1).max(60),
})
export type BackgroundPicture = z.infer<typeof BackgroundPictureSchema>

export const BackgroundPeriodSchema = z.object({
  id: z.string().regex(/^(all-year|p-[a-z0-9]{10})$/),
  name: z.string().trim().min(1).max(40),
  /** First and last day, both included, in `zone` (all year: none) */
  from: day.nullable(),
  until: day.nullable(),
  zone: z.string().min(1).max(64),
  /** replace = during the period, Home shows only its pictures; add = with the all-year and built-in ones */
  mode: z.enum(['replace', 'add']),
  pictures: z.array(BackgroundPictureSchema).max(12),
})
export type BackgroundPeriod = z.infer<typeof BackgroundPeriodSchema>

export const BackgroundsSchema = z.object({ periods: z.array(BackgroundPeriodSchema).max(20) })
export type Backgrounds = z.infer<typeof BackgroundsSchema>

export const DEFAULT_BACKGROUNDS: Backgrounds = { periods: [{ id: ALL_YEAR, name: 'All year', from: null, until: null, zone: 'Europe/Paris', mode: 'add', pictures: [] }] }

/** Midnight starting a day (YYYY-MM-DD) in a zone */
export function dayStart(date: string, zone: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return zonedTime(y, m, d, '00:00', zone)
}
/** The instants a period covers: [first day 00:00, the day after the last one 00:00) in its zone */
export function periodWindow(p: BackgroundPeriod): { from: number | null; until: number | null } {
  if (p.id === ALL_YEAR) return { from: null, until: null }
  const next = p.until ? new Date(Date.parse(`${p.until}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10) : null
  return { from: p.from ? dayStart(p.from, p.zone) : null, until: next ? dayStart(next, p.zone) : null }
}

export const backgroundPath = (image: ImageRef) => `v2/images/${image.id}.webp`

/** Why these periods cannot be published (empty = fine) */
export function backgroundProblems(b: Backgrounds, now = Date.now()): string[] {
  const out: string[] = []
  if (!b.periods.some((p) => p.id === ALL_YEAR)) out.push('The “All year” period is missing.')
  for (const p of b.periods) {
    if (p.pictures.some((x) => !x.caption.trim())) out.push(`${p.name}: every picture needs the place it shows.`)
    if (p.id === ALL_YEAR) continue
    if (!p.from || !p.until) out.push(`${p.name}: choose its first and last day.`)
    else if (p.until < p.from) out.push(`${p.name}: the last day is before the first one.`)
    else if ((periodWindow(p).until ?? Infinity) <= now && p.pictures.length) out.push(`${p.name}: this period is over (move its dates to next year, or delete it).`)
  }
  return out
}

/** The feed's backgrounds: one item per picture, shown during its period. Ended periods are left out. */
export function backgroundItems(b: Backgrounds, now: number): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  for (const p of b.periods) {
    const w = periodWindow(p)
    if (w.until !== null && w.until <= now) continue
    p.pictures.forEach((pic, i) => {
      out.push({
        id: `${p.id}-${i}-${pic.image.id.slice(0, 8)}`,
        name: { en: pic.caption },
        image: { path: backgroundPath(pic.image), sha512: pic.image.sha512, size: pic.image.size },
        mode: p.id === ALL_YEAR ? 'add' : p.mode,
        ...(w.from !== null ? { showFrom: new Date(w.from).toISOString() } : {}),
        ...(w.until !== null ? { showUntil: new Date(w.until).toISOString() } : {}),
      })
    })
  }
  return out.slice(0, 60)
}
