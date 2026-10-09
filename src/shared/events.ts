/**
 * Phase 23: the events calendar (staff publish events in the signed feed; each player sees them in their own time,
 * can ask for one reminder and add them to their calendar).
 */
import { z } from 'zod'
import { LocalizedSchema, localize, type Localized } from './manifest.ts'

const httpsUrl = z.string().refine((s) => {
  try {
    return new URL(s).protocol === 'https:'
  } catch {
    return false
  }
}, 'must be an https:// link')

export const EventSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{1,64}$/),
    title: LocalizedSchema,
    /** Plain text; blank lines separate paragraphs */
    body: LocalizedSchema.optional(),
    /** ISO date-time with its time zone, e.g. 2026-10-17T20:00:00+02:00 */
    start: z.string().datetime({ offset: true }),
    end: z.string().datetime({ offset: true }).optional(),
    /** Where in the world: "Spawn", "/warp contest"… */
    where: LocalizedSchema.optional(),
    link: z.object({ label: LocalizedSchema, url: httpsUrl }).optional(),
  })
  .refine((e) => !e.end || Date.parse(e.end) > Date.parse(e.start), 'end must be after start')
export type HemisphereEvent = z.infer<typeof EventSchema>

/** An event without an end is considered "on" for 2 hours. */
export const eventEnd = (e: HemisphereEvent) => (e.end ? Date.parse(e.end) : Date.parse(e.start) + 2 * 3600_000)

/** Events not over yet, soonest first. */
export function upcomingEvents(events: HemisphereEvent[] | undefined, now = Date.now()): HemisphereEvent[] {
  return (events ?? []).filter((e) => eventEnd(e) > now).sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
}

export type EventPhase = 'later' | 'soon' | 'live'
/** live = happening now; soon = starts within 24 h. */
export function eventPhase(e: HemisphereEvent, now = Date.now()): EventPhase {
  const start = Date.parse(e.start)
  if (start <= now) return 'live'
  return start - now <= 24 * 3600_000 ? 'soon' : 'later'
}

/** Minutes before the start when a reminder fires. */
export const REMINDER_MINUTES = 15

// ------------------------------------------------------------------------------ calendar file (.ics)

const icsDate = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
/** Lines longer than 75 bytes are folded (RFC 5545). TextEncoder, not Buffer: shared with the Herald server. */
const byteLength = (s: string) => new TextEncoder().encode(s).length
const fold = (line: string) => {
  const out: string[] = []
  let rest = line
  while (byteLength(rest) > 75) {
    let cut = 74
    while (byteLength(rest.slice(0, cut)) > 74) cut--
    out.push(rest.slice(0, cut))
    rest = ` ${rest.slice(cut)}`
  }
  out.push(rest)
  return out.join('\r\n')
}

/** A calendar file for one event (opens in Outlook, Windows Calendar, Google Calendar…), with a 15-minute alarm. */
export function eventIcs(e: HemisphereEvent, lang: string, now = Date.now()): string {
  const text = (l: Localized | undefined) => (l ? localize(l, lang) : '')
  const description = [text(e.body), e.link ? `${text(e.link.label)}: ${e.link.url}` : ''].filter(Boolean).join('\n\n')
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Hemisphere SMP//Launcher//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${e.id}@hemispheresurvival.club`,
    `DTSTAMP:${icsDate(now)}`,
    `DTSTART:${icsDate(Date.parse(e.start))}`,
    `DTEND:${icsDate(eventEnd(e))}`,
    `SUMMARY:${icsText(`${text(e.title)} · Hemisphere SMP`)}`,
    ...(description ? [`DESCRIPTION:${icsText(description)}`] : []),
    `LOCATION:${icsText(['Hemisphere SMP', text(e.where)].filter(Boolean).join(' · '))}`,
    ...(e.link ? [`URL:${e.link.url}`] : []),
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${icsText(text(e.title))}`,
    `TRIGGER:-PT${REMINDER_MINUTES}M`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
    .map(fold)
    .join('\r\n')
    .concat('\r\n')
}
