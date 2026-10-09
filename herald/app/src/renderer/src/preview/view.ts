/** What a player sees at an instant, computed like the launcher does (feedDraft → resolveFeed), for Herald's previews. */
import type { PublicationsState } from '@herald/api'
import { clearFeed, feedDraft, type PublicationData, type PublicationKind, type PublishedPublication } from '@shared/heraldPublications'
import { backgroundItems, type Backgrounds } from '@shared/heraldBackgrounds'
import { resolveFeed, type FeedView } from '@shared/schedule'
import type { NewsItemV2 } from '@shared/feedV2'
import { eventPhase, upcomingEvents } from '@shared/events'

export interface ViewOptions {
  /** A publication shown as if it were published with this data (the editor's preview) */
  override?: { id: string; kind: PublicationKind; data: PublicationData; publishedAt: number }
  /** Also show the Ready publications that are not published yet */
  includeReady?: boolean
  /** Backgrounds as if they were published (the Backgrounds tab's changes not published yet) */
  backgrounds?: Backgrounds
}

/** The draft feed at an instant: published publications, the server parts, the backgrounds by period */
const draftAt = (state: PublicationsState, at: number, opts: ViewOptions) => feedDraft(publishedSet(state, at, opts), state.base, at, backgroundItems(opts.backgrounds ?? state.backgrounds, at))

/** A draft still missing its English texts, shown with placeholders (the launcher never receives such a draft) */
export function withPlaceholders(kind: PublicationKind, data: PublicationData): PublicationData {
  const en = { ...data.texts.en }
  if (kind === 'news') {
    en.title = en.title?.trim() || '(No title yet)'
    en.body = en.body?.trim() || '(No text yet)'
  } else if (kind === 'event') en.title = en.title?.trim() || '(No title yet)'
  else en.text = en.text?.trim() || '(No text yet)'
  return { ...data, texts: { ...data.texts, en } }
}

export function publishedSet(state: PublicationsState, now: number, opts: ViewOptions = {}): PublishedPublication[] {
  const out: PublishedPublication[] = []
  for (const p of state.publications) {
    if (p.deletedAt || p.id === opts.override?.id) continue
    if (p.published) out.push({ id: p.id, kind: p.kind, data: p.published, publishedAt: p.publishedAt ?? now })
    else if (opts.includeReady && p.status === 'ready') out.push({ id: p.id, kind: p.kind, data: p.data, publishedAt: now })
  }
  if (opts.override) out.push(opts.override)
  return out
}

/** sha512 → picture id, for every picture any publication or background uses */
export function pictureIds(state: PublicationsState, extra?: PublicationData, backgrounds?: Backgrounds): Record<string, string> {
  const map: Record<string, string> = {}
  for (const d of [...state.publications.flatMap((p) => [p.data, p.published]), extra]) if (d?.image) map[d.image.sha512] = d.image.id
  for (const b of [state.backgrounds, backgrounds]) for (const period of b?.periods ?? []) for (const pic of period.pictures) map[pic.image.sha512] = pic.image.id
  return map
}

export function viewAt(state: PublicationsState, at: number, lang: string, opts: ViewOptions, urls: Record<string, string>, ids: Record<string, string>): FeedView {
  const view = resolveFeed(clearFeed(draftAt(state, at, opts)), {}, at, lang)
  view.news = view.news.map((n) => {
    const f = (n as NewsItemV2).imageFile
    return f ? { ...n, image: urls[ids[f.sha512]] } : n
  })
  if (view.backgrounds) view.backgrounds.items = view.backgrounds.items.map((b) => ({ ...b, src: urls[ids[b.image.sha512]] }))
  return view
}

/** News a player who last opened News at `seenAt` (default: a day earlier) has not seen yet (the red badge) */
export function badgeAt(state: PublicationsState, at: number, lang: string, opts: ViewOptions, seenAt = at - 86_400_000): number {
  const before = new Set(resolveFeed(clearFeed(draftAt(state, seenAt, opts)), {}, seenAt, lang).news.map((n) => n.id))
  return resolveFeed(clearFeed(draftAt(state, at, opts)), {}, at, lang).news.filter((n) => !before.has(n.id)).length
}

export interface Change {
  at: number
  lines: string[]
}

/** The instants the launcher changes by itself from `from` on, and what changes then (time travel's list) */
export function upcomingChanges(state: PublicationsState, from: number, lang: string, opts: ViewOptions, max = 25): Change[] {
  const feed = clearFeed(draftAt(state, from, opts))
  const out: Change[] = []
  let prev = resolveFeed(feed, {}, from, lang)
  let prevAt = from
  let t = prev.nextChangeAt
  while (t !== null && out.length < max) {
    const next = resolveFeed(feed, {}, t, lang)
    const lines = describeChange(prev, next, prevAt, t)
    if (lines.length) out.push({ at: t, lines })
    prev = next
    prevAt = t
    t = next.nextChangeAt
  }
  return out
}

const en = (x: { en: string } | undefined) => x?.en ?? ''

/** What changed between two views (taken at `ta` and `tb`) */
export function describeChange(a: FeedView, b: FeedView, ta: number, tb: number): string[] {
  const lines: string[] = []
  // Events: in the list (announced), live, gone
  const evA = new Map(upcomingEvents(a.events, ta).map((e) => [e.id, e]))
  const evB = new Map(upcomingEvents(b.events, tb).map((e) => [e.id, e]))
  // a weekly event's next dates (id-YYYYMMDD) are not "announced" again
  const base = (id: string) => id.match(/^[nebw]-[a-z0-9]{12}/)?.[0] ?? id
  const knownA = new Set([...evA.keys()].map(base))
  for (const [id, e] of evB) {
    const live = eventPhase(e, tb) === 'live'
    if (!evA.has(id) && !live && !knownA.has(base(id))) lines.push(`Event announced: “${en(e.title)}”`)
    else if (live && (!evA.has(id) || eventPhase(evA.get(id)!, ta) !== 'live')) lines.push(`Event starts: “${en(e.title)}”`)
  }
  for (const [id, e] of evA) if (!evB.has(id) && eventPhase(e, ta) === 'live') lines.push(`Event ends: “${en(e.title)}”`)
  const was = new Map(a.news.map((n) => [n.id, n]))
  const is = new Map(b.news.map((n) => [n.id, n]))
  for (const [id, n] of is) {
    if (!was.has(id)) lines.push(`News appears: “${en(n.title)}”`)
    else if (was.get(id)!.featured && !n.featured) lines.push(`No longer the big card: “${en(n.title)}”`)
  }
  for (const [id, n] of was) if (!is.has(id)) lines.push(`News removed: “${en(n.title)}”`)
  if (!a.maintenancePlanned && b.maintenancePlanned) lines.push(`Maintenance announced: “${en(b.maintenancePlanned.message)}”`)
  if (!a.maintenance.active && b.maintenance.active) lines.push(`Maintenance starts: “${en(b.maintenance.message)}”`)
  if (a.maintenance.active && !b.maintenance.active) lines.push('Maintenance ends: the server is open again')
  if (a.restart && b.restart && (a.restart.time !== b.restart.time || a.restart.timeZone !== b.restart.timeZone || a.restart.durationMin !== b.restart.durationMin))
    lines.push(`Daily restart now ${b.restart.time} ${b.restart.timeZone} (${b.restart.durationMin} min)`)
  const pics = (v: FeedView) => (v.backgrounds?.items ?? []).map((x) => x.id).join()
  if (pics(a) !== pics(b) || a.backgrounds?.mode !== b.backgrounds?.mode)
    lines.push(!b.backgrounds ? 'Home backgrounds: the built-in pictures only' : `Home backgrounds: ${b.backgrounds.items.length} picture${b.backgrounds.items.length > 1 ? 's' : ''} from the team${b.backgrounds.mode === 'replace' ? ' only' : ', with the built-in ones'}`)
  if (en(a.banner?.text) !== en(b.banner?.text)) lines.push(b.banner ? `Banner: “${en(b.banner.text)}”` : 'Banner removed')
  if (en(a.welcome?.text) !== en(b.welcome?.text) || en(a.welcome?.title) !== en(b.welcome?.title)) lines.push(b.welcome ? `Welcome message: “${en(b.welcome.title) || en(b.welcome.text)}”` : 'Back to the usual welcome')
  return lines
}
