import { describe, expect, it } from 'vitest'
import { clearFeed, DEFAULT_FEED_BASE, emptyData, feedDraft, feedItem, problems, publicationEnd, type PublicationData } from '../src/shared/heraldPublications'
import { EventV2Schema, FeedV2Schema } from '../src/shared/feedV2'
import { resolveFeed } from '../src/shared/schedule'
import { restartsBetween } from '../src/shared/restart'
import { upcomingEvents } from '../src/shared/events'

const base = DEFAULT_FEED_BASE({ time: '17:00', timeZone: 'Europe/Paris', durationMin: 5 })
const NOW = Date.parse('2026-10-20T10:00:00Z')
const event = (patch: Partial<PublicationData> = {}, ev: Partial<NonNullable<PublicationData['event']>> = {}): PublicationData => {
  const d = emptyData('event', 'Europe/Paris', NOW)
  return { ...d, texts: { en: { title: 'Build night', where: 'Spawn', body: 'Bring blocks' }, fr: { title: 'Soirée build', where: 'Spawn' } }, done: { fr: true }, ...patch, event: { ...d.event!, start: '2026-10-24T18:00:00Z', durationMin: 120, ...ev } }
}

describe('Herald events → feed', () => {
  it('a one-off event is a schema 2 event the launcher accepts', () => {
    const item = EventV2Schema.parse(feedItem('e-aaaaaaaaaaaa', 'event', event({ linkUrl: 'https://hemispheresurvival.club/rules', texts: { en: { title: 'Build night', linkLabel: 'Rules' } } }), NOW))
    expect(item.start).toBe('2026-10-24T18:00:00.000Z')
    expect(item.end).toBe('2026-10-24T20:00:00.000Z')
    expect(item.showFrom).toBe('2026-10-20T10:00:00.000Z')
    expect(item.link).toEqual({ label: { en: 'Rules' }, url: 'https://hemispheresurvival.club/rules' })
    expect(item.recurrence).toBeUndefined()
  })

  it('texts per language: where and title translated, an empty description left out', () => {
    const item = EventV2Schema.parse(feedItem('e-aaaaaaaaaaaa', 'event', event(), NOW))
    expect(item.title).toEqual({ en: 'Build night', fr: 'Soirée build' })
    expect(item.where).toEqual({ en: 'Spawn', fr: 'Spawn' })
    expect(item.body).toEqual({ en: 'Bring blocks' })
  })

  it('announced later: hidden until then, never after it starts', () => {
    const later = feedItem('e-aaaaaaaaaaaa', 'event', event({ schedule: { from: '2026-10-22T08:00:00Z', until: null, zone: 'Europe/Paris' } }), NOW)
    expect(later.showFrom).toBe('2026-10-22T08:00:00.000Z')
    const tooLate = event({ schedule: { from: '2026-10-25T08:00:00Z', until: null, zone: 'Europe/Paris' } })
    expect(feedItem('e-aaaaaaaaaaaa', 'event', tooLate, NOW).showFrom).toBe('2026-10-24T18:00:00.000Z')
    expect(problems('event', tooLate, NOW)).toContain('It is announced after it starts: players would never see it coming.')
  })

  it('a weekly event keeps its wall time in its zone across the clock change (Paris, 25 October)', () => {
    // Saturday 24 Oct 20:00 Paris (UTC+2), then Saturday 31 Oct 20:00 Paris (UTC+1)
    const weekly = event({}, { repeat: { days: [6], until: null } })
    const item = EventV2Schema.parse(feedItem('e-aaaaaaaaaaaa', 'event', weekly, NOW))
    expect(item.recurrence?.weekly).toEqual({ days: [6], time: '20:00', timeZone: 'Europe/Paris', durationMin: 120 })
    const view = resolveFeed(clearFeed(feedDraft([{ id: 'e-aaaaaaaaaaaa', kind: 'event', data: weekly, publishedAt: NOW }], base, NOW)), {}, NOW, 'en')
    expect(view.events!.slice(0, 2).map((e) => e.start)).toEqual(['2026-10-24T18:00:00.000Z', '2026-10-31T19:00:00.000Z'])
  })

  it('checks: the first date must be one of the repeat days; the end must not be past', () => {
    expect(problems('event', event({}, { repeat: { days: [0], until: null } }), NOW)).toContain('The first date is a Saturday: add it to the days it repeats on, or move it.')
    expect(problems('event', event({}, { start: '2026-10-01T18:00:00Z' }), NOW)).toContain('The event is already over.')
    expect(problems('event', event({ texts: { en: { title: '' } } }), NOW)).toContain('The English title is missing.')
    expect(problems('event', event(), NOW)).toEqual([])
  })

  it('ends: a one-off at its end, a weekly one after its last date, never when it repeats without end', () => {
    expect(publicationEnd('event', event())).toBe(Date.parse('2026-10-24T20:00:00Z'))
    expect(publicationEnd('event', event({}, { repeat: { days: [6], until: '2026-11-30T22:59:00Z' } }))).toBe(Date.parse('2026-12-01T00:59:00Z'))
    expect(publicationEnd('event', event({}, { repeat: { days: [6], until: null } }))).toBeNull()
  })

  it('the feed: events soonest first, ended ones gone after a week, still valid', () => {
    const pubs = [
      { id: 'e-later0000000', kind: 'event' as const, data: event({}, { start: '2026-11-10T18:00:00Z' }), publishedAt: NOW },
      { id: 'e-soon00000000', kind: 'event' as const, data: event(), publishedAt: NOW },
      { id: 'e-old000000000', kind: 'event' as const, data: event({}, { start: '2026-10-01T18:00:00Z' }), publishedAt: NOW },
    ]
    const draft = feedDraft(pubs, base, NOW)
    expect(draft.events.map((e) => e.id)).toEqual(['e-soon00000000', 'e-later0000000'])
    expect(() => FeedV2Schema.parse(clearFeed(draft))).not.toThrow()
    const view = resolveFeed(clearFeed(draft), {}, Date.parse('2026-10-24T19:00:00Z'), 'en')
    expect(upcomingEvents(view.events, Date.parse('2026-10-24T19:00:00Z'))[0].id).toBe('e-soon00000000')
    // an event starting or ending is a change of the view (Herald's time travel lists it)
    expect(resolveFeed(clearFeed(draft), {}, NOW, 'en').nextChangeAt).toBe(Date.parse('2026-10-24T18:00:00Z'))
  })
})

describe('restarts over a period (calendar)', () => {
  it('lists each daily restart once, with skipped days and extra restarts', () => {
    const s = { time: '17:00', timeZone: 'Europe/Paris', durationMin: 5, exceptions: [{ date: '2026-10-22', timeZone: 'Europe/Paris', skip: true }, { date: '2026-10-23', timeZone: 'Europe/Paris', extra: { time: '10:00', durationMin: 10 } }] }
    const list = restartsBetween(Date.parse('2026-10-19T00:00:00Z'), Date.parse('2026-11-02T00:00:00Z'), s)
    expect(list.filter((r) => r.kind === 'daily')).toHaveLength(13)
    expect(list.filter((r) => r.kind === 'extra').map((r) => r.at)).toEqual([Date.parse('2026-10-23T08:00:00Z')])
    expect(new Set(list.map((r) => r.at)).size).toBe(list.length)
    // the clock change: 17:00 Paris is 15:00 UTC before, 16:00 UTC after
    expect(list.some((r) => r.at === Date.parse('2026-10-24T15:00:00Z'))).toBe(true)
    expect(list.some((r) => r.at === Date.parse('2026-10-26T16:00:00Z'))).toBe(true)
  })
})
