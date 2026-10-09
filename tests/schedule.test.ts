import { describe, expect, it } from 'vitest'
import { FeedV2Schema, type FeedV2 } from '../src/shared/feedV2'
import { resolveFeed, weeklyOccurrences, zonedTime } from '../src/shared/schedule'
import { restartState } from '../src/shared/restart'

const base = (over: Partial<FeedV2> = {}): FeedV2 =>
  FeedV2Schema.parse({
    schema: 2,
    sequence: 1,
    updatedAt: '2026-10-09T10:00:00.000Z',
    news: [],
    maintenances: [],
    restart: { rules: [{ from: '2026-01-01T00:00:00Z', time: '17:00', timeZone: 'Europe/Paris', durationMin: 5 }], exceptions: [] },
    events: [],
    banners: [],
    welcome: [],
    backgrounds: [],
    vaults: [],
    vaultKeys: {},
    ...over,
  })
const T = (iso: string) => Date.parse(iso)
const news = (id: string, extra: object = {}) => ({ id, date: '2026-10-20', category: 'event', title: { en: id }, body: { en: 'b' }, ...extra })

describe('feed schema 2', () => {
  it('accepts a full feed and refuses duplicates, bad vault paths and keys of unknown vaults', () => {
    expect(() => base({ news: [news('a'), news('a')] as never })).toThrow(/duplicate news id a/)
    const vault = { id: 'v1', kind: 'news', opensAt: '2026-10-20T16:00:00Z', file: { path: 'v2/vaults/v1.bin', sha512: 'a'.repeat(128), size: 10 }, plainSha256: 'b'.repeat(64) }
    expect(base({ vaults: [vault] as never }).vaults).toHaveLength(1)
    expect(() => base({ vaults: [{ ...vault, file: { ...vault.file, path: '../x.bin' } }] as never })).toThrow()
    expect(() => base({ vaultKeys: { nope: 'A'.repeat(43) + '=' } })).toThrow(/unknown vault/)
  })

  it('keeps the schema 1 rules for support links', () => {
    expect(() => base({ support: { url: 'https://evil.example/ticket' } })).toThrow()
    expect(base({ support: { url: 'https://discord.com/channels/1/2' } }).support?.url).toContain('discord.com')
  })
})

describe('what a player sees (resolveFeed)', () => {
  it('shows a news between showFrom and showUntil, big card until featuredUntil', () => {
    const feed = base({ news: [news('h', { showFrom: '2026-10-20T16:00:00Z', featuredUntil: '2026-10-23T16:00:00Z', showUntil: '2026-11-01T00:00:00Z' })] as never })
    expect(resolveFeed(feed, {}, T('2026-10-20T15:59:59Z'), 'en').news).toHaveLength(0)
    const shown = resolveFeed(feed, {}, T('2026-10-20T16:00:00Z'), 'en')
    expect(shown.news[0]).toMatchObject({ id: 'h', featured: true })
    expect(resolveFeed(feed, {}, T('2026-10-24T00:00:00Z'), 'en').news[0].featured).toBe(false)
    expect(resolveFeed(feed, {}, T('2026-11-01T00:00:00Z'), 'en').news).toHaveLength(0)
    expect(resolveFeed(feed, {}, T('2026-10-20T10:00:00Z'), 'en').nextChangeAt).toBe(T('2026-10-20T16:00:00Z'))
  })

  it('a news can target some languages only', () => {
    const feed = base({ news: [news('fr-only', { langs: ['fr'] }), news('all')] as never })
    expect(resolveFeed(feed, {}, T('2026-10-21T00:00:00Z'), 'en').news.map((n) => n.id)).toEqual(['all'])
    expect(resolveFeed(feed, {}, T('2026-10-21T00:00:00Z'), 'fr').news.map((n) => n.id).sort()).toEqual(['all', 'fr-only'])
  })

  it('maintenance: announced, then running until its end, then gone', () => {
    const feed = base({ maintenances: [{ id: 'm', message: { en: 'Migration' }, announceFrom: '2026-10-19T10:00:00Z', start: '2026-10-28T13:00:00Z', end: '2026-10-28T15:00:00Z' }] })
    expect(resolveFeed(feed, {}, T('2026-10-18T00:00:00Z'), 'en')).toMatchObject({ maintenance: { active: false } })
    expect(resolveFeed(feed, {}, T('2026-10-18T00:00:00Z'), 'en').maintenancePlanned).toBeUndefined()
    expect(resolveFeed(feed, {}, T('2026-10-20T00:00:00Z'), 'en').maintenancePlanned).toMatchObject({ start: '2026-10-28T13:00:00Z', end: '2026-10-28T15:00:00Z' })
    expect(resolveFeed(feed, {}, T('2026-10-28T13:00:00Z'), 'en').maintenance).toEqual({ active: true, message: { en: 'Migration' }, until: '2026-10-28T15:00:00Z' })
    expect(resolveFeed(feed, {}, T('2026-10-28T15:00:00Z'), 'en').maintenance.active).toBe(false)
  })

  it('a maintenance without an end runs until the staff ends it', () => {
    const feed = base({ maintenances: [{ id: 'm', message: { en: 'Crash' }, start: '2026-10-09T19:00:00Z' }] })
    expect(resolveFeed(feed, {}, T('2026-12-31T00:00:00Z'), 'en').maintenance).toEqual({ active: true, message: { en: 'Crash' } })
  })

  it('restart: a new rule takes over at its date, and every player sees the right local time', () => {
    const feed = base({
      restart: {
        rules: [
          { from: '2026-01-01T00:00:00Z', time: '17:00', timeZone: 'Europe/Paris', durationMin: 5 },
          { from: '2026-10-25T00:00:00Z', time: '15:00', timeZone: 'UTC', durationMin: 5 },
        ],
        exceptions: [{ date: '2026-12-24', timeZone: 'Europe/Paris', skip: true }],
      },
    })
    const before = resolveFeed(feed, {}, T('2026-10-24T12:00:00Z'), 'en')
    expect(before.restart).toEqual({ time: '17:00', timeZone: 'Europe/Paris', durationMin: 5 })
    expect(new Date(restartState(T('2026-10-24T12:00:00Z'), before.restart!).next).toISOString()).toBe('2026-10-24T15:00:00.000Z')
    const after = resolveFeed(feed, {}, T('2026-10-26T12:00:00Z'), 'en')
    expect(after.restart).toEqual({ time: '15:00', timeZone: 'UTC', durationMin: 5 })
    // Paris is UTC+1 after 25 October: 15:00 UTC = 16:00 in Paris
    expect(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }).format(restartState(T('2026-10-26T12:00:00Z'), after.restart!).next)).toBe('16:00')
    expect(after.restartExceptions).toHaveLength(1)
    expect(before.nextChangeAt).toBe(T('2026-10-25T00:00:00Z'))
  })

  it('banner, welcome message and seasonal backgrounds follow their windows', () => {
    const img = { path: 'v2/backgrounds/pumpkins.webp', sha512: 'c'.repeat(128), size: 100 }
    const feed = base({
      banners: [{ id: 'xp', text: { en: 'Double XP' }, level: 'info', showFrom: '2026-10-09T16:00:00Z', showUntil: '2026-10-11T22:00:00Z' }, { id: 'down', text: { en: 'Down soon' }, level: 'critical', showFrom: '2026-10-10T00:00:00Z', showUntil: '2026-10-10T01:00:00Z' }],
      welcome: [{ id: 'hw', title: { en: 'Happy Halloween' }, text: { en: 'Hunt on' }, showFrom: '2026-10-31T00:00:00Z', showUntil: '2026-11-02T00:00:00Z' }],
      backgrounds: [{ id: 'pumpkins', name: { en: 'Pumpkins' }, image: img, mode: 'replace', showFrom: '2026-10-20T00:00:00Z', showUntil: '2026-11-02T00:00:00Z' }],
    })
    expect(resolveFeed(feed, {}, T('2026-10-09T20:00:00Z'), 'en').banner?.text.en).toBe('Double XP')
    expect(resolveFeed(feed, {}, T('2026-10-10T00:30:00Z'), 'en').banner?.level).toBe('critical')
    expect(resolveFeed(feed, {}, T('2026-10-31T12:00:00Z'), 'en').welcome?.title?.en).toBe('Happy Halloween')
    expect(resolveFeed(feed, {}, T('2026-10-25T12:00:00Z'), 'en').backgrounds).toEqual({ mode: 'replace', items: [{ id: 'pumpkins', name: { en: 'Pumpkins' }, image: img }] })
    expect(resolveFeed(feed, {}, T('2026-11-03T12:00:00Z'), 'en').backgrounds).toBeUndefined()
  })

  it('opened vault items count like the others; unopened ones do not exist yet', () => {
    const vault = { id: 'v1', kind: 'news', opensAt: '2026-10-20T16:00:00Z', file: { path: 'v2/vaults/v1.bin', sha512: 'a'.repeat(128), size: 10 }, plainSha256: 'b'.repeat(64) }
    const feed = base({ vaults: [vault] as never })
    expect(resolveFeed(feed, {}, T('2026-10-20T16:00:01Z'), 'en').news).toHaveLength(0)
    expect(resolveFeed(feed, { news: [news('secret', { showFrom: '2026-10-20T16:00:00Z' })] }, T('2026-10-20T16:00:01Z'), 'en').news[0].id).toBe('secret')
    expect(resolveFeed(feed, {}, T('2026-10-20T10:00:00Z'), 'en').nextChangeAt).toBe(T('2026-10-20T16:00:00Z'))
  })
})

describe('weekly events', () => {
  const event = {
    id: 'build-night',
    title: { en: 'Build night' },
    start: '2026-10-17T18:00:00Z', // Saturday 20:00 in Paris (summer time)
    end: '2026-10-17T20:00:00Z',
    recurrence: { weekly: { days: [6], time: '20:00', timeZone: 'Europe/Paris', durationMin: 120 } },
  }
  it('repeats at the same Paris time across the change to winter time', () => {
    const list = weeklyOccurrences(event as never, T('2026-10-16T00:00:00Z'), T('2026-11-08T00:00:00Z'))
    expect(list.map((e) => e.start)).toEqual(['2026-10-17T18:00:00.000Z', '2026-10-24T18:00:00.000Z', '2026-10-31T19:00:00.000Z', '2026-11-07T19:00:00.000Z'])
    expect(list[2].id).toBe('build-night-20261031')
    expect(list[2].end).toBe('2026-10-31T21:00:00.000Z')
  })
  it('stops at `until` and never starts before the first one', () => {
    const limited = { ...event, recurrence: { weekly: { ...event.recurrence.weekly, until: '2026-10-25T00:00:00Z' } } }
    expect(weeklyOccurrences(limited as never, T('2026-10-01T00:00:00Z'), T('2026-12-01T00:00:00Z')).map((e) => e.start)).toEqual(['2026-10-17T18:00:00.000Z', '2026-10-24T18:00:00.000Z'])
  })
  it('wall times are converted with daylight saving (zonedTime)', () => {
    expect(new Date(zonedTime(2026, 10, 24, '20:00', 'Europe/Paris')).toISOString()).toBe('2026-10-24T18:00:00.000Z')
    expect(new Date(zonedTime(2026, 10, 26, '20:00', 'Europe/Paris')).toISOString()).toBe('2026-10-26T19:00:00.000Z')
    expect(new Date(zonedTime(2026, 10, 21, '03:00', 'Australia/Sydney')).toISOString()).toBe('2026-10-20T16:00:00.000Z')
  })
})
