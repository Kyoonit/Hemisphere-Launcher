import { describe, expect, it } from 'vitest'
import { emptyData, fromTemplate, PublicationTemplateSchema, toTemplateData, type PublicationData } from '../src/shared/heraldPublications'
import { ALL_YEAR, removedPeriods, type Backgrounds } from '../src/shared/heraldBackgrounds'

const DAY = 86_400_000

describe('Herald publication templates', () => {
  it('keeps texts and settings, never the dates', () => {
    const data: PublicationData = { ...emptyData('news', 'Europe/Paris'), texts: { en: { title: 'Build contest', body: 'Theme: castles' } }, schedule: { from: '2026-10-01T10:00:00.000Z', until: '2026-10-08T10:00:00.000Z', zone: 'Europe/Paris' } }
    const t = toTemplateData(data)
    expect(t.schedule).toEqual({ from: null, until: null, zone: 'Europe/Paris' })
    expect(t.texts.en.title).toBe('Build contest')
    expect(PublicationTemplateSchema.safeParse({ id: 't-abcdefgh', name: 'Build contest', kind: 'news', data: t }).success).toBe(true)
  })

  it('an event from a template keeps its weekday and time, on a date at least a day away', () => {
    const now = Date.parse('2026-10-09T12:00:00Z') // a Friday
    const ev = emptyData('event', 'UTC', now)
    const tpl = { id: 't-abcdefgh', name: 'Build night', kind: 'event' as const, data: toTemplateData({ ...ev, event: { start: '2026-09-04T19:00:00.000Z', durationMin: 120, repeat: { days: [5], until: '2026-09-30T00:00:00.000Z' } } }) }
    expect(tpl.data.event!.repeat!.until).toBeNull()
    const made = fromTemplate(tpl, 'UTC', now)
    const start = Date.parse(made.event!.start)
    expect(start).toBeGreaterThanOrEqual(now + DAY)
    expect(start - now).toBeLessThan(8 * DAY)
    expect(new Date(start).getUTCDay()).toBe(5)
    expect(new Date(start).getUTCHours()).toBe(19)
  })
})

describe('Herald trash: removed background periods', () => {
  const period = (id: string, name: string) => ({ id, name, from: '2026-10-25', until: '2026-11-02', zone: 'UTC', mode: 'replace' as const, pictures: [] })
  const all = { id: ALL_YEAR, name: 'All year', from: null, until: null, zone: 'UTC', mode: 'add' as const, pictures: [] }
  it('finds each removed period as it last was, with who removed it and when', () => {
    const v = (at: number, who: string, periods: Backgrounds['periods']) => ({ at, who, value: { periods } })
    const versions = [
      v(300, 'Kyonit', [all]), // removed Halloween
      v(200, 'Liable', [all, { ...period('p-aaaaaaaaaa', 'Halloween'), name: 'Halloween 2026' }]),
      v(100, 'Liable', [all, period('p-aaaaaaaaaa', 'Halloween'), period('p-bbbbbbbbbb', 'Christmas')]), // Christmas removed at 200
    ]
    const found = removedPeriods({ periods: [all] }, versions)
    expect(found.map((f) => [f.period.name, f.removedAt, f.by])).toEqual([
      ['Halloween 2026', 300, 'Kyonit'],
      ['Christmas', 200, 'Liable'],
    ])
    expect(removedPeriods({ periods: [all, period('p-aaaaaaaaaa', 'Halloween')] }, versions).map((f) => f.period.name)).toEqual(['Christmas'])
  })
})
