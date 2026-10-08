// Phase 23: events calendar (feed, upcoming/live, calendar file).
import { describe, expect, test } from 'vitest'
import { eventIcs, eventPhase, upcomingEvents, type HemisphereEvent } from '../src/shared/events'
import { FeedSchema } from '../src/shared/feed'

const now = Date.parse('2026-10-08T12:00:00Z')
const ev = (id: string, start: string, end?: string): HemisphereEvent => ({ id, title: { en: `Event ${id}`, fr: `Événement ${id}` }, start, ...(end ? { end } : {}) })

describe('upcoming events', () => {
  test('over ones go, soonest first, live ones stay until they end (2 h when no end)', () => {
    const list = upcomingEvents(
      [
        ev('later', '2026-10-20T18:00:00+02:00'),
        ev('over', '2026-10-01T18:00:00+02:00', '2026-10-01T20:00:00+02:00'),
        ev('live', '2026-10-08T13:30:00+02:00'), // 11:30Z, no end: on until 13:30Z
        ev('soon', '2026-10-09T10:00:00Z'),
      ],
      now,
    )
    expect(list.map((e) => e.id)).toEqual(['live', 'soon', 'later'])
    expect(list.map((e) => eventPhase(e, now))).toEqual(['live', 'soon', 'later'])
  })
})

describe('calendar file', () => {
  test('a valid .ics: UTC times, escaped text, 15-minute alarm, folded lines', () => {
    const e: HemisphereEvent = {
      ...ev('build-contest', '2026-10-17T20:00:00+02:00', '2026-10-17T22:00:00+02:00'),
      title: { en: 'Build contest; theme: castles, towers', fr: 'Concours de construction' },
      body: { en: 'Bring your best build.\nPrizes for the top 3!' },
      where: { en: '/warp contest' },
      link: { label: { en: 'Rules' }, url: 'https://hemispheresurvival.club/contest' },
    }
    const ics = eventIcs(e, 'en', now)
    expect(ics).toContain('BEGIN:VCALENDAR\r\n')
    expect(ics).toContain('UID:build-contest@hemispheresurvival.club')
    expect(ics).toContain('DTSTART:20261017T180000Z')
    expect(ics).toContain('DTEND:20261017T200000Z')
    expect(ics).toContain('SUMMARY:Build contest\\; theme: castles\\, towers · Hemisphere SMP')
    expect(ics).toContain('TRIGGER:-PT15M')
    expect(ics).toContain('LOCATION:Hemisphere SMP · /warp contest')
    for (const line of ics.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75)
    expect(eventIcs(e, 'fr', now)).toContain('SUMMARY:Concours de construction')
  })
})

describe('feed', () => {
  const base = { schema: 1, sequence: 9, updatedAt: '2026-10-08T10:00:00.000Z', maintenance: { active: false, message: { en: 'x' } }, restart: null, news: [] }
  test('events and the Discord app id are optional and checked', () => {
    expect(FeedSchema.safeParse(base).success).toBe(true)
    expect(FeedSchema.safeParse({ ...base, events: [ev('a', '2026-10-17T20:00:00+02:00')], discordAppId: '1291234567890123456' }).success).toBe(true)
    expect(FeedSchema.safeParse({ ...base, discordAppId: 'abc' }).success).toBe(false)
    expect(FeedSchema.safeParse({ ...base, events: [ev('a', '2026-10-17T20:00:00')] }).success).toBe(false) // no time zone
    expect(FeedSchema.safeParse({ ...base, events: [ev('a', '2026-10-17T20:00:00Z', '2026-10-17T19:00:00Z')] }).success).toBe(false) // ends before it starts
    expect(FeedSchema.safeParse({ ...base, events: [ev('a', '2026-10-17T20:00:00Z'), ev('a', '2026-10-18T20:00:00Z')] }).success).toBe(false) // same id twice
  })
})
