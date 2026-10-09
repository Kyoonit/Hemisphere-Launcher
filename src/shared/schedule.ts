/**
 * What a player sees at a given instant, from a schema 2 feed and the vaults already opened. ONE function for the
 * launcher (with the server-corrected clock), Herald's preview and "time travel", and the tests: they cannot disagree.
 *
 * The result has the schema 1 shape the launcher screens already use (FeedView extends Feed), plus the new parts.
 * Times are instants; each screen formats them in the player's own time zone.
 */
import type { Feed, NewsItem } from './feed.ts'
import type { HemisphereEvent } from './events.ts'
import type { Background, Banner, EventV2, FeedV2, Maintenance, NewsItemV2, RestartException, RestartRule, VaultKind, Welcome } from './feedV2.ts'
import type { Localized } from './manifest.ts'

export interface FeedView extends Feed {
  /** Where this view comes from: the frozen schema 1 feed, or schema 2 (Herald) */
  source: 'v1' | 'v2'
  /** A maintenance announced in advance, not started yet */
  maintenancePlanned?: { message: Localized; start: string; end?: string }
  banner?: { text: Localized; level: Banner['level'] }
  welcome?: { title?: Localized; accent?: Localized; text: Localized }
  /** Remote Home backgrounds in force: `replace` = only these, otherwise added to the built-in ones */
  backgrounds?: { mode: 'add' | 'replace'; items: Pick<Background, 'id' | 'name' | 'image'>[] }
  restartExceptions?: RestartException[]
  /** The daily restart in force, with its exceptions (days without restart, extra restarts) */
  restart: (NonNullable<Feed['restart']> & { exceptions?: RestartException[] }) | null
  /** Next instant this view changes by itself (ms), to recompute exactly then; null = nothing scheduled */
  nextChangeAt: number | null
}

/** Opened vault contents, by kind (already validated against their schema). */
export type OpenedItems = Partial<{ [K in VaultKind]: unknown[] }>

const at = (iso: string | undefined) => (iso ? Date.parse(iso) : undefined)
const inWindow = (x: { showFrom?: string; showUntil?: string }, now: number) => (at(x.showFrom) ?? -Infinity) <= now && now < (at(x.showUntil) ?? Infinity)

// ------------------------------------------------------------------------------------------------ weekly events

function zoneParts(ts: number, timeZone: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short' })
      .formatToParts(ts)
      .filter((x) => x.type !== 'literal')
      .map((x) => [x.type, x.value]),
  )
  return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour, minute: +p.minute, second: +p.second, weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) }
}

/** Wall time (date + HH:mm) in a zone → epoch ms (daylight saving included). */
export function zonedTime(year: number, month: number, day: number, hhmm: string, timeZone: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  const wanted = Date.UTC(year, month - 1, day, h, m)
  let t = wanted
  for (let i = 0; i < 3; i++) {
    const p = zoneParts(t, timeZone)
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute)
    if (shown === wanted) break
    t += wanted - shown
  }
  return t
}

const DAY = 86_400_000
const ymd = (ts: number, timeZone: string) => {
  const p = zoneParts(ts, timeZone)
  return `${p.year}${String(p.month).padStart(2, '0')}${String(p.day).padStart(2, '0')}`
}

/** The occurrences of a weekly event between `from` and `to` (the first one is the event's own start). */
export function weeklyOccurrences(e: EventV2, from: number, to: number): HemisphereEvent[] {
  const w = e.recurrence?.weekly
  const { showFrom: _s, recurrence: _r, ...base } = e
  if (!w) return [base as HemisphereEvent]
  const first = Date.parse(e.start)
  const until = Math.min(to, at(w.until) ?? Infinity)
  const out: HemisphereEvent[] = []
  for (let day = Math.max(from, first) - DAY; day <= until + DAY && out.length < 20; day += DAY) {
    const p = zoneParts(day, w.timeZone)
    if (!w.days.includes(p.weekday)) continue
    const start = zonedTime(p.year, p.month, p.day, w.time, w.timeZone)
    const end = start + w.durationMin * 60_000
    if (start < first || end <= from || start > until || out.some((o) => Date.parse(o.start) === start)) continue
    out.push({ ...base, id: `${e.id}-${ymd(start, w.timeZone)}`.slice(0, 64), start: new Date(start).toISOString(), end: new Date(end).toISOString() } as HemisphereEvent)
  }
  return out
}

// ------------------------------------------------------------------------------------------------ the view

export function resolveFeed(feed: FeedV2, opened: OpenedItems, now: number, lang: string): FeedView {
  const all = <T>(clear: T[], kind: VaultKind) => [...clear, ...((opened[kind] ?? []) as T[])]
  const news = all<NewsItemV2>(feed.news, 'news')
  const maintenances = all<Maintenance>(feed.maintenances, 'maintenance')
  const rules = all<RestartRule>(feed.restart?.rules ?? [], 'restartRule')
  const exceptions = all<RestartException>(feed.restart?.exceptions ?? [], 'restartException')
  const events = all<EventV2>(feed.events, 'event')
  const banners = all<Banner>(feed.banners, 'banner')
  const welcomes = all<Welcome>(feed.welcome, 'welcome')
  const backgrounds = all<Background>(feed.backgrounds, 'background')

  // Every instant at which the view changes by itself
  const changes: number[] = []
  const mark = (...iso: (string | undefined)[]) => iso.forEach((s) => s && changes.push(Date.parse(s)))
  for (const x of [...news, ...banners, ...welcomes, ...backgrounds]) mark(x.showFrom, x.showUntil)
  for (const n of news) mark(n.featuredUntil)
  for (const m of maintenances) mark(m.announceFrom, m.start, m.end)
  for (const r of rules) mark(r.from)
  for (const e of events) mark(e.showFrom)
  for (const v of feed.vaults) mark(v.opensAt)

  const visibleNews: NewsItem[] = news
    .filter((n) => inWindow(n, now) && (!n.langs || n.langs.includes(lang)))
    .map((n) => ({ ...n, featured: n.featuredUntil ? now < Date.parse(n.featuredUntil) : n.featured }))
    .sort((a, b) => (at((b as NewsItemV2).showFrom) ?? Date.parse(b.date)) - (at((a as NewsItemV2).showFrom) ?? Date.parse(a.date)))

  const running = maintenances.find((m) => Date.parse(m.start) <= now && now < (at(m.end) ?? Infinity))
  const planned = running ? undefined : maintenances.filter((m) => (at(m.announceFrom) ?? Infinity) <= now && now < Date.parse(m.start)).sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0]

  const rule = rules.filter((r) => Date.parse(r.from) <= now).sort((a, b) => Date.parse(b.from) - Date.parse(a.from))[0]

  const visibleEvents = events.filter((e) => (at(e.showFrom) ?? -Infinity) <= now).flatMap((e) => weeklyOccurrences(e, now - DAY, now + 28 * DAY))

  const LEVEL = { critical: 3, important: 2, info: 1 }
  const banner = banners.filter((b) => inWindow(b, now)).sort((a, b) => LEVEL[b.level] - LEVEL[a.level] || (at(b.showFrom) ?? 0) - (at(a.showFrom) ?? 0))[0]
  const welcome = welcomes.filter((w) => inWindow(w, now)).sort((a, b) => (at(b.showFrom) ?? 0) - (at(a.showFrom) ?? 0))[0]
  const bgs = backgrounds.filter((b) => inWindow(b, now))
  const replacing = bgs.filter((b) => b.mode === 'replace')

  const next = changes.filter((t) => t > now)
  return {
    source: 'v2',
    schema: 1,
    sequence: feed.sequence,
    updatedAt: feed.updatedAt,
    maintenance: running ? { active: true, message: running.message, ...(running.end ? { until: running.end } : {}) } : { active: false, message: { en: '' } },
    ...(planned ? { maintenancePlanned: { message: planned.message, start: planned.start, ...(planned.end ? { end: planned.end } : {}) } } : {}),
    restart: rule ? { time: rule.time, timeZone: rule.timeZone, durationMin: rule.durationMin, ...(exceptions.length ? { exceptions } : {}) } : null,
    restartExceptions: exceptions,
    news: visibleNews,
    events: visibleEvents.slice(0, 50),
    ...(banner ? { banner: { text: banner.text, level: banner.level } } : {}),
    ...(welcome ? { welcome: { ...(welcome.title ? { title: welcome.title } : {}), ...(welcome.accent ? { accent: welcome.accent } : {}), text: welcome.text } } : {}),
    ...(bgs.length ? { backgrounds: { mode: replacing.length ? 'replace' : 'add', items: (replacing.length ? replacing : bgs).map(({ id, name, image }) => ({ id, name, image })) } } : {}),
    ...(feed.modPolicy ? { modPolicy: feed.modPolicy } : {}),
    ...(feed.support ? { support: feed.support } : {}),
    ...(feed.discordAppId ? { discordAppId: feed.discordAppId } : {}),
    ...(feed.staffCode ? { staffCode: feed.staffCode } : {}),
    nextChangeAt: next.length ? Math.min(...next) : null,
  }
}

/** A schema 1 feed as a view (launchers keep working on the old feed until schema 2 is published). */
export const viewOfV1 = (feed: Feed): FeedView => ({ ...feed, source: 'v1', nextChangeAt: null })
