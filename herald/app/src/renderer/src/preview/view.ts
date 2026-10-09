/** What a player sees at an instant, computed like the launcher does (feedDraft → resolveFeed), for Herald's previews. */
import type { PublicationsState } from '@herald/api'
import { clearFeed, feedDraft, type PublicationData, type PublicationKind, type PublishedPublication } from '@shared/heraldPublications'
import { resolveFeed, type FeedView } from '@shared/schedule'
import type { NewsItemV2 } from '@shared/feedV2'

export interface ViewOptions {
  /** A publication shown as if it were published with this data (the editor's preview) */
  override?: { id: string; kind: PublicationKind; data: PublicationData; publishedAt: number }
  /** Also show the Ready publications that are not published yet */
  includeReady?: boolean
}

/** A draft still missing its English texts, shown with placeholders (the launcher never receives such a draft) */
export function withPlaceholders(kind: PublicationKind, data: PublicationData): PublicationData {
  const en = { ...data.texts.en }
  if (kind === 'news') {
    en.title = en.title?.trim() || '(No title yet)'
    en.body = en.body?.trim() || '(No text yet)'
  } else en.text = en.text?.trim() || '(No text yet)'
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

/** sha512 → picture id, for every picture any publication uses */
export function pictureIds(state: PublicationsState, extra?: PublicationData): Record<string, string> {
  const map: Record<string, string> = {}
  for (const d of [...state.publications.flatMap((p) => [p.data, p.published]), extra]) if (d?.image) map[d.image.sha512] = d.image.id
  return map
}

export function viewAt(state: PublicationsState, at: number, lang: string, opts: ViewOptions, urls: Record<string, string>, ids: Record<string, string>): FeedView {
  const pubs = publishedSet(state, at, opts)
  const view = resolveFeed(clearFeed(feedDraft(pubs, state.base, at)), {}, at, lang)
  view.news = view.news.map((n) => {
    const f = (n as NewsItemV2).imageFile
    return f ? { ...n, image: urls[ids[f.sha512]] } : n
  })
  return view
}

/** News a player who last opened News at `seenAt` (default: a day earlier) has not seen yet (the red badge) */
export function badgeAt(state: PublicationsState, at: number, lang: string, opts: ViewOptions, seenAt = at - 86_400_000): number {
  const before = new Set(resolveFeed(clearFeed(feedDraft(publishedSet(state, at, opts), state.base, seenAt)), {}, seenAt, lang).news.map((n) => n.id))
  return resolveFeed(clearFeed(feedDraft(publishedSet(state, at, opts), state.base, at)), {}, at, lang).news.filter((n) => !before.has(n.id)).length
}

export interface Change {
  at: number
  lines: string[]
}

/** The instants the launcher changes by itself from `from` on, and what changes then (time travel's list) */
export function upcomingChanges(state: PublicationsState, from: number, lang: string, opts: ViewOptions, max = 25): Change[] {
  const pubs = publishedSet(state, from, opts)
  const draft = feedDraft(pubs, state.base, from)
  const feed = clearFeed(draft)
  const out: Change[] = []
  let prev = resolveFeed(feed, {}, from, lang)
  let t = prev.nextChangeAt
  while (t !== null && out.length < max) {
    const next = resolveFeed(feed, {}, t, lang)
    const lines = describeChange(prev, next)
    if (lines.length) out.push({ at: t, lines })
    prev = next
    t = next.nextChangeAt
  }
  return out
}

const en = (x: { en: string } | undefined) => x?.en ?? ''

export function describeChange(a: FeedView, b: FeedView): string[] {
  const lines: string[] = []
  const was = new Map(a.news.map((n) => [n.id, n]))
  const is = new Map(b.news.map((n) => [n.id, n]))
  for (const [id, n] of is) {
    if (!was.has(id)) lines.push(`News appears: “${en(n.title)}”`)
    else if (was.get(id)!.featured && !n.featured) lines.push(`No longer the big card: “${en(n.title)}”`)
  }
  for (const [id, n] of was) if (!is.has(id)) lines.push(`News removed: “${en(n.title)}”`)
  if (en(a.banner?.text) !== en(b.banner?.text)) lines.push(b.banner ? `Banner: “${en(b.banner.text)}”` : 'Banner removed')
  if (en(a.welcome?.text) !== en(b.welcome?.text) || en(a.welcome?.title) !== en(b.welcome?.title)) lines.push(b.welcome ? `Welcome message: “${en(b.welcome.title) || en(b.welcome.text)}”` : 'Back to the usual welcome')
  return lines
}
