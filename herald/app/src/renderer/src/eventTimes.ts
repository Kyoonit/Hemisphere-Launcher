/** An event publication's times, computed like the launcher does (feedItem → weeklyOccurrences). */
import { feedItem, WEEKDAYS, type PublicationData } from '@shared/heraldPublications'
import { weeklyOccurrences } from '@shared/schedule'
import type { EventV2 } from '@shared/feedV2'
import { formatTime } from './time'

/** Its occurrences [start, end] between two instants (a weekly event: every repeat; at most 20) */
export function occurrences(id: string, data: PublicationData, from: number, to: number): { start: number; end: number }[] {
  if (!data.event) return []
  const item = { ...feedItem(id, 'event', data, 0), title: { en: 'x' } } as unknown as EventV2
  return weeklyOccurrences(item, from, to)
    .map((o) => ({ start: Date.parse(o.start), end: Date.parse(o.end!) }))
    .filter((o) => o.end > from && o.start < to)
}

/** The next (or current) occurrence after `now` */
export function nextOccurrence(id: string, data: PublicationData, now: number): { start: number; end: number } | null {
  return occurrences(id, data, now, now + 400 * 86_400_000)[0] ?? null
}

/** "every Saturday 20:00", "every Mon, Wed 18:30" in a zone */
export function repeatLabel(data: PublicationData, zone: string): string | null {
  const r = data.event?.repeat
  if (!r) return null
  const days = [...r.days].sort().map((d) => (r.days.length === 1 ? WEEKDAYS[d] : WEEKDAYS[d].slice(0, 3)))
  return `every ${r.days.length === 7 ? 'day' : days.join(', ')} ${formatTime(Date.parse(data.event!.start), zone)}`
}
