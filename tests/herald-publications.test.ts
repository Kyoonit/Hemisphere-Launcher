import { describe, expect, it } from 'vitest'
import { clearFeed, DEFAULT_FEED_BASE, emptyData, feedDraft, feedItem, languagesOut, problems, type PublicationData } from '../src/shared/heraldPublications'
import { FeedV2Schema, NewsItemV2Schema, BannerSchema, WelcomeSchema } from '../src/shared/feedV2'
import { resolveFeed } from '../src/shared/schedule'

const base = DEFAULT_FEED_BASE({ time: '17:00', timeZone: 'Europe/Paris', durationMin: 5 })
const image = { id: 'a'.repeat(64), sha512: 'b'.repeat(128), size: 1234, width: 1600, height: 900 }
const news = (patch: Partial<PublicationData> = {}): PublicationData => ({
  ...emptyData('news', 'Europe/Paris'),
  texts: { en: { title: 'Hello', body: 'Body' }, fr: { title: 'Bonjour', body: 'Texte' } },
  done: { fr: true },
  ...patch,
})
const NOW = Date.parse('2026-10-24T10:00:00Z')

describe('Herald publications → feed items', () => {
  it('a news becomes a schema 2 item the launcher accepts', () => {
    const item = feedItem('n-aaaaaaaaaaaa', 'news', news({ image, linkUrl: 'https://hemispheresurvival.club/x', texts: { en: { title: 'Hello', body: 'Body', linkLabel: 'Open' } }, featuredDays: 3 }), NOW)
    const parsed = NewsItemV2Schema.parse(item)
    expect(parsed.showFrom).toBe('2026-10-24T10:00:00.000Z')
    expect(parsed.featuredUntil).toBe('2026-10-27T10:00:00.000Z')
    expect(parsed.imageFile).toEqual({ path: `v2/images/${'a'.repeat(64)}.webp`, sha512: 'b'.repeat(128), size: 1234 })
    expect(parsed.link).toEqual({ label: { en: 'Open' }, url: 'https://hemispheresurvival.club/x' })
  })

  it('the news date is the day in the zone it was scheduled in', () => {
    const late = news({ schedule: { from: '2026-12-24T23:30:00Z', until: null, zone: 'Europe/Paris' } })
    expect(feedItem('n-aaaaaaaaaaaa', 'news', late, NOW).date).toBe('2026-12-25')
    expect(feedItem('n-aaaaaaaaaaaa', 'news', { ...late, schedule: { ...late.schedule, zone: 'America/New_York' } }, NOW).date).toBe('2026-12-24')
  })

  it('only finished translations go to players (English always)', () => {
    const d = news({ texts: { en: { title: 'Hello', body: 'Body' }, fr: { title: 'Bonjour', body: 'Texte' }, de: { title: 'Hallo', body: '' } }, done: { fr: false, de: true } })
    expect(languagesOut('news', d)).toEqual(['en'])
    expect(feedItem('n-aaaaaaaaaaaa', 'news', d, NOW).title).toEqual({ en: 'Hello' })
    expect(languagesOut('news', { ...d, done: { fr: true } })).toEqual(['en', 'fr'])
  })

  it('banners and welcome messages', () => {
    const banner = { ...emptyData('banner', 'UTC'), texts: { en: { text: 'Maintenance tonight' } }, level: 'critical' as const }
    expect(BannerSchema.parse(feedItem('b-aaaaaaaaaaaa', 'banner', banner, NOW))).toMatchObject({ level: 'critical', text: { en: 'Maintenance tonight' } })
    const welcome = { ...emptyData('welcome', 'UTC'), texts: { en: { title: 'Happy Halloween', text: 'Spooky week!' } } }
    expect(WelcomeSchema.parse(feedItem('w-aaaaaaaaaaaa', 'welcome', welcome, NOW))).toMatchObject({ title: { en: 'Happy Halloween' }, text: { en: 'Spooky week!' } })
    expect(feedItem('w-aaaaaaaaaaaa', 'welcome', welcome, NOW).accent).toBeUndefined()
    const accent = { ...welcome, texts: { en: { ...welcome.texts.en, accent: '{player}!' } } }
    expect(WelcomeSchema.parse(feedItem('w-aaaaaaaaaaaa', 'welcome', accent, NOW)).accent).toEqual({ en: '{player}!' })
  })

  it('says what is missing before Ready', () => {
    expect(problems('news', emptyData('news', 'UTC'), NOW)).toEqual(['The English title is missing.', 'The English text is missing.'])
    expect(problems('news', news({ linkUrl: 'http://x' }), NOW)).toContain('The link must start with https://.')
    expect(problems('news', news({ schedule: { from: '2026-10-25T00:00:00Z', until: '2026-10-24T12:00:00Z', zone: 'UTC' } }), NOW)).toContain('The end is before the start.')
    expect(problems('news', news({ texts: { en: { title: 'x'.repeat(121), body: 'b' } } }), NOW)[0]).toMatch(/121\/120/)
    expect(problems('banner', { ...emptyData('banner', 'UTC'), texts: { en: { text: 'ok' } } }, NOW)).toEqual([])
  })
})

describe('Herald publications → the whole feed, as players see it', () => {
  const pubs = [
    { id: 'n-old000000000', kind: 'news' as const, data: news({ texts: { en: { title: 'Old', body: 'b' } }, schedule: { from: null, until: '2026-10-01T00:00:00Z', zone: 'UTC' } }), publishedAt: NOW - 30 * 86_400_000 },
    { id: 'n-now000000000', kind: 'news' as const, data: news(), publishedAt: NOW - 3_600_000 },
    { id: 'n-later0000000', kind: 'news' as const, data: news({ texts: { en: { title: 'Later', body: 'b' } }, schedule: { from: '2026-10-31T18:00:00Z', until: null, zone: 'UTC' } }), publishedAt: NOW },
    { id: 'b-now000000000', kind: 'banner' as const, data: { ...emptyData('banner', 'UTC'), texts: { en: { text: 'Hi' } } }, publishedAt: NOW },
  ]
  const draft = feedDraft(pubs, base, NOW)

  it('items ended more than a week ago leave the feed', () => {
    expect(draft.news.map((n) => n.id)).toEqual(['n-later0000000', 'n-now000000000'])
  })

  it('is a valid schema 2 feed', () => {
    expect(() => FeedV2Schema.parse(clearFeed(draft))).not.toThrow()
  })

  it('time travel: the scheduled news appears at its time, in every zone', () => {
    const feed = clearFeed(draft)
    expect(resolveFeed(feed, {}, Date.parse('2026-10-31T17:59:59Z'), 'en').news.map((n) => n.id)).toEqual(['n-now000000000'])
    const after = resolveFeed(feed, {}, Date.parse('2026-10-31T18:00:00Z'), 'fr')
    expect(after.news.map((n) => n.id)).toEqual(['n-later0000000', 'n-now000000000'])
    expect(after.banner?.text.en).toBe('Hi')
  })
})
