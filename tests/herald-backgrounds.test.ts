import { describe, expect, it } from 'vitest'
import { ALL_YEAR, backgroundItems, backgroundProblems, DEFAULT_BACKGROUNDS, periodWindow, type Backgrounds, type BackgroundPeriod } from '../src/shared/heraldBackgrounds'
import { clearFeed, DEFAULT_FEED_BASE, feedDraft } from '../src/shared/heraldPublications'
import { FeedV2Schema } from '../src/shared/feedV2'
import { resolveFeed } from '../src/shared/schedule'
import { listedFiles } from '../tools/herald/publisher'

const base = DEFAULT_FEED_BASE({ time: '17:00', timeZone: 'Europe/Paris', durationMin: 5 })
const NOW = Date.parse('2026-10-09T10:00:00Z')
const image = (c: string) => ({ id: c.repeat(64), sha512: c.repeat(128), size: 500_000, width: 2560, height: 1440 })
const period = (patch: Partial<BackgroundPeriod>): BackgroundPeriod => ({ id: 'p-halloween0', name: 'Halloween', from: '2026-10-20', until: '2026-11-02', zone: 'Europe/Paris', mode: 'replace', pictures: [{ image: image('b'), caption: 'Haunted spawn' }], ...patch })
const all = (extra: BackgroundPeriod[] = []): Backgrounds => ({ periods: [{ ...DEFAULT_BACKGROUNDS.periods[0], pictures: [{ image: image('a'), caption: 'New spawn' }] }, ...extra] })

describe('Herald backgrounds', () => {
  it('a period runs from its first day 00:00 to the day after its last one, in its zone (clock change included)', () => {
    const w = periodWindow(period({}))
    expect(new Date(w.from!).toISOString()).toBe('2026-10-19T22:00:00.000Z') // 20 Oct 00:00 Paris, summer time
    expect(new Date(w.until!).toISOString()).toBe('2026-11-02T23:00:00.000Z') // 3 Nov 00:00 Paris, winter time
    expect(periodWindow(all().periods[0])).toEqual({ from: null, until: null })
  })

  it('feed items: one per picture, all year added to the built-in ones, a period with its window and mode', () => {
    const items = backgroundItems(all([period({})]), NOW)
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ name: { en: 'New spawn' }, mode: 'add', image: { path: `v2/images/${'a'.repeat(64)}.webp` } })
    expect(items[0].showFrom).toBeUndefined()
    expect(items[1]).toMatchObject({ mode: 'replace', showFrom: '2026-10-19T22:00:00.000Z', showUntil: '2026-11-02T23:00:00.000Z' })
  })

  it('the launcher shows only Halloween pictures during Halloween, the all-year ones (with the built-in ones) otherwise', () => {
    const feed = clearFeed(feedDraft([], base, NOW, backgroundItems(all([period({})]), NOW)))
    expect(() => FeedV2Schema.parse(feed)).not.toThrow()
    const before = resolveFeed(feed, {}, NOW, 'en').backgrounds!
    expect(before.mode).toBe('add')
    expect(before.items.map((b) => b.name.en)).toEqual(['New spawn'])
    const during = resolveFeed(feed, {}, Date.parse('2026-10-25T12:00:00Z'), 'en').backgrounds!
    expect(during.mode).toBe('replace')
    expect(during.items.map((b) => b.name.en)).toEqual(['Haunted spawn'])
    // "add" periods join the all-year pictures
    const added = clearFeed(feedDraft([], base, NOW, backgroundItems(all([period({ mode: 'add' })]), NOW)))
    expect(resolveFeed(added, {}, Date.parse('2026-10-25T12:00:00Z'), 'en').backgrounds!.items).toHaveLength(2)
    // the period's start and end are changes of the view (the launcher switches exactly then)
    expect(resolveFeed(feed, {}, NOW, 'en').nextChangeAt).toBe(Date.parse('2026-10-19T22:00:00Z'))
  })

  it('ended periods leave the feed; checks before publishing', () => {
    expect(backgroundItems(all([period({ from: '2026-01-01', until: '2026-01-05' })]), NOW)).toHaveLength(1)
    expect(backgroundProblems(all([period({ until: '2026-10-01' })]), NOW)).toContain('Halloween: the last day is before the first one.')
    expect(backgroundProblems(all([period({ from: null })]), NOW)).toContain('Halloween: choose its first and last day.')
    expect(backgroundProblems({ periods: [period({})] }, NOW)).toContain('The “All year” period is missing.')
    expect(backgroundProblems(all([period({ pictures: [{ image: image('c'), caption: ' ' }] })]), NOW)).toContain('Halloween: every picture needs the place it shows.')
    expect(backgroundProblems(all([period({})]), NOW)).toEqual([])
  })

  it('the publisher lists background pictures as files to write next to the feed', () => {
    const feed = FeedV2Schema.parse({ ...clearFeed(feedDraft([], base, NOW, backgroundItems(all(), NOW))), schema: 2, sequence: 1, updatedAt: new Date(NOW).toISOString() })
    expect(listedFiles(feed).map((f) => f.path)).toEqual([`v2/images/${'a'.repeat(64)}.webp`])
    expect(ALL_YEAR).toBe('all-year')
  })
})
