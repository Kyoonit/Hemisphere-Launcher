/**
 * Publications → Calendar: two weeks of everything players see over time (news, events, banners, welcome messages,
 * maintenances, restarts), in the staff member's zone, with the overlaps worth a look ("an event during a maintenance").
 * Dashed = not published yet (drafts, Ready): what is being prepared shows too.
 */
import { useMemo, useState } from 'react'
import type { Publication } from '@herald/api'
import { publicationEnd, type PublicationKind } from '@shared/heraldPublications'
import { ALL_YEAR, periodWindow, type Backgrounds } from '@shared/heraldBackgrounds'
import { restartsBetween } from '@shared/restart'
import { shownFrom, titleOf, usePubs } from '../pubs'
import { useStore } from '../store'
import { occurrences } from '../eventTimes'
import { formatDay, formatTime, formatWhen, fromWallInput, toWallInput, zoneLabel } from '../time'

const DAYS = 14
/** Short items (a 2-hour event) are drawn at least this long, to stay readable; overlaps use their real times */
const SHORT_MS = 36 * 3_600_000
type Lane = 'news' | 'event' | 'banner' | 'welcome' | 'background' | 'maintenance' | 'restart'
const LANES: { id: Lane; label: string }[] = [
  { id: 'news', label: 'News' },
  { id: 'event', label: 'Events' },
  { id: 'banner', label: 'Banners' },
  { id: 'welcome', label: 'Welcome' },
  { id: 'background', label: 'Backgrounds' },
  { id: 'maintenance', label: 'Maintenance' },
  { id: 'restart', label: 'Restarts' },
]
const TONE: Record<string, string> = {
  news: 'bg-sky-400/25 text-sky-100 border-sky-400/50',
  event: 'bg-green-400/20 text-green-200 border-green-400/45',
  banner: 'bg-amber-400/20 text-amber-100 border-amber-400/45',
  welcome: 'bg-violet-400/20 text-violet-100 border-violet-400/45',
  background: 'bg-orange-400/20 text-orange-100 border-orange-400/45',
  maintenance: 'bg-red-400/25 text-red-100 border-red-400/55',
  announce: 'text-red-200 border-red-400/50 border-dashed bg-[repeating-linear-gradient(45deg,rgba(248,113,113,.07)_0_6px,rgba(248,113,113,.15)_6px_12px)]',
  restart: 'bg-gray-400/30 border-gray-400/50',
  extra: 'bg-orange-400/40 border-orange-400/60',
}

interface Bar {
  key: string
  lane: Lane
  from: number
  to: number
  label: string
  tip: string
  tone: string
  draft?: boolean
  open?: string
  /** The real end, when the bar is drawn wider to stay visible (a 5-minute restart) */
  realEnd?: number
}

export default function Calendar({ onOpen }: { onOpen(id: string): void }) {
  const { state } = usePubs()
  const { zone } = useStore()
  const [weeks, setWeeks] = useState(0)
  const now = state?.now ?? Date.now()

  // Midnight of each day shown (in the staff member's zone, daylight saving included), from this week's Monday
  const days = useMemo(() => {
    const today = toWallInput(now, zone).slice(0, 10)
    const [y, m, d] = today.split('-').map(Number)
    const weekday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7
    return Array.from({ length: DAYS + 1 }, (_, i) => fromWallInput(toWallInput(Date.UTC(y, m - 1, d - weekday + weeks * 7 + i, 12), 'UTC').slice(0, 10) + 'T00:00', zone)!)
  }, [now, zone, weeks])
  const start = days[0]
  const end = days[DAYS]

  const bars = useMemo(() => (state ? barsOf(state.publications, state.base, state.backgrounds, start, end, now, zone) : []), [state, start, end, now, zone])
  if (!state) return null

  // Where an instant is, in % of the width (day by day: a 23- or 25-hour day keeps its column)
  const x = (t: number) => {
    if (t <= start) return 0
    if (t >= end) return 100
    const i = days.findIndex((d, j) => t >= d && t < days[j + 1])
    return ((i + (t - days[i]) / (days[i + 1] - days[i])) / DAYS) * 100
  }
  const warnings = overlaps(bars, zone)

  return (
    <div>
      <div className="mb-2.5 flex items-center gap-2">
        <button className="btn btn-sm btn-ghost" onClick={() => setWeeks(weeks - 1)} aria-label="Previous week">
          ◀
        </button>
        <b className="text-white">
          {formatDay(start, zone)} → {formatDay(end - 1, zone)}
        </b>
        <button className="btn btn-sm btn-ghost" onClick={() => setWeeks(weeks + 1)} aria-label="Next week">
          ▶
        </button>
        {weeks !== 0 && (
          <button className="btn btn-sm" onClick={() => setWeeks(0)}>
            This week
          </button>
        )}
        <span className="ml-auto text-xs text-gray-400">{zoneLabel(zone)} · click a bar to open it · dashed = not published yet</span>
      </div>

      <div className="relative overflow-hidden rounded-lg border border-gray-700">
        <div className="grid grid-cols-[110px_1fr] bg-gray-900 text-[11px] text-gray-400">
          <div />
          <div className="grid" style={{ gridTemplateColumns: `repeat(${DAYS}, 1fr)` }}>
            {days.slice(0, DAYS).map((d) => {
              const today = d <= now && now < d + 86_400_000
              return (
                <div key={d} className={`border-l border-gray-800 px-1 py-1.5 text-center ${today ? 'font-bold text-green-300' : ''}`}>
                  {formatDay(d, zone).replace(/ [A-Z][a-z]{2}$/, '')}
                </div>
              )
            })}
          </div>
        </div>
        {LANES.map((lane) => {
          const rows = stack(bars.filter((b) => b.lane === lane.id))
          return (
            <div key={lane.id} className="grid grid-cols-[110px_1fr] border-t border-gray-800">
              <div className="bg-gray-900/50 px-3 py-2.5 text-[13px] text-gray-300">{lane.label}</div>
              <div className="relative" style={{ height: Math.max(1, rows.length) * 30 + 12, backgroundImage: `repeating-linear-gradient(90deg, transparent 0, transparent calc(100% / ${DAYS} - 1px), var(--color-gray-800) calc(100% / ${DAYS} - 1px), var(--color-gray-800) calc(100% / ${DAYS}))` }}>
                {rows.flatMap((row, r) =>
                  row.map((b) => (
                    <button
                      key={b.key}
                      title={b.tip}
                      disabled={!b.open}
                      onClick={() => b.open && onOpen(b.open)}
                      className={`absolute h-[25px] min-w-[6px] truncate rounded-md border px-1.5 text-left text-[11.5px] leading-[23px] font-semibold ${b.tone} ${b.draft ? 'border-dashed opacity-60' : ''} ${b.open ? 'cursor-pointer hover:brightness-125' : 'cursor-default'}`}
                      style={{ top: 6 + r * 30, left: `${x(b.from)}%`, width: `${Math.max(0, x(b.to) - x(b.from))}%` }}
                    >
                      {b.label}
                    </button>
                  )),
                )}
              </div>
            </div>
          )
        })}
        {/* now */}
        {now > start && now < end && <div className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-green-400/80" style={{ left: `calc(110px + (100% - 110px) * ${x(now) / 100})` }} />}
      </div>

      {warnings.map((w) => (
        <div key={w} className="mt-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-200">
          ⚠ {w}
        </div>
      ))}
    </div>
  )
}

/** Every bar of the period */
function barsOf(pubs: Publication[], base: NonNullable<ReturnType<typeof usePubs>['state']>['base'], backgrounds: Backgrounds, start: number, end: number, now: number, zone: string): Bar[] {
  const out: Bar[] = []
  for (const p of backgrounds.periods) {
    if (p.id === ALL_YEAR || !p.pictures.length) continue
    const w = periodWindow(p)
    if (w.from === null || w.until === null) continue
    out.push({ key: p.id, lane: 'background', from: w.from, to: w.until, label: p.name, tip: `Backgrounds “${p.name}” (${p.pictures.length} picture${p.pictures.length === 1 ? '' : 's'}, ${p.mode === 'replace' ? 'only these' : 'with the all-year ones'})\n${formatWhen(w.from, zone)} – ${formatWhen(w.until, zone)}`, tone: TONE.background })
  }
  for (const p of pubs) {
    if (p.deletedAt) continue
    const data = p.published ?? p.data
    const draft = !p.published
    const title = titleOf(data)
    if (p.kind === 'event') {
      for (const o of occurrences(p.id, data, start, end))
        out.push({ key: `${p.id}-${o.start}`, lane: 'event', from: o.start, to: Math.max(o.end, o.start + SHORT_MS), realEnd: o.end, label: `${formatTime(o.start, zone)} ${title}`, tip: `Event “${title}”\n${formatWhen(o.start, zone)} – ${formatTime(o.end, zone)}${draft ? '\nNot published yet' : ''}`, tone: TONE.event, draft, open: p.id })
      continue
    }
    const from = shownFrom(p.kind, data) ?? p.publishedAt ?? now
    const to = publicationEnd(p.kind, data) ?? Infinity
    if (to <= start || from >= end) continue
    out.push({ key: p.id, lane: p.kind as Exclude<PublicationKind, 'event'>, from, to, label: title, tip: `${p.kind === 'welcome' ? 'Welcome message' : p.kind[0].toUpperCase() + p.kind.slice(1)} “${title}”\nFrom ${formatWhen(from, zone)}${to < Infinity ? ` until ${formatWhen(to, zone)}` : ', no end'}${draft ? '\nNot published yet' : ''}`, tone: TONE[p.kind], draft, open: p.id })
  }
  for (const m of base.maintenances) {
    const s = Date.parse(m.start)
    const e = m.end ? Date.parse(m.end) : Math.max(now, s) + 3_600_000
    const announce = m.announceFrom ? Date.parse(m.announceFrom) : null
    if (announce !== null && announce < s) out.push({ key: `${m.id}-a`, lane: 'maintenance', from: announce, to: s, label: 'announced to players', tip: `Maintenance announced from ${formatWhen(announce, zone)}`, tone: TONE.announce })
    out.push({ key: m.id, lane: 'maintenance', from: s, to: Math.max(e, s + 6 * 3_600_000), realEnd: e, label: '⚡ ' + m.message.en, tip: `Maintenance “${m.message.en}”\n${formatWhen(s, zone)} – ${m.end ? formatWhen(e, zone) : 'until back online'}`, tone: TONE.maintenance })
  }
  const r = base.restart
  const rule = r?.rules.filter((x) => Date.parse(x.from) <= end).sort((a, b) => Date.parse(b.from) - Date.parse(a.from))[0]
  if (rule) {
    for (const x of restartsBetween(start, end, { time: rule.time, timeZone: rule.timeZone, durationMin: rule.durationMin, exceptions: r!.exceptions }))
      out.push({ key: `r-${x.at}`, lane: 'restart', from: x.at, to: x.at + Math.max(x.duration, 45 * 60_000), realEnd: x.at + x.duration, label: '', tip: `${x.kind === 'extra' ? 'Extra restart' : 'Daily restart'} ${formatTime(x.at, zone)}–${formatTime(x.at + x.duration, zone)} (${x.duration / 60_000} min)`, tone: x.kind === 'extra' ? TONE.extra : TONE.restart })
  }
  return out.filter((b) => b.to > start && b.from < end)
}

/** Bars of one lane on as few rows as possible */
function stack(bars: Bar[]): Bar[][] {
  const rows: Bar[][] = []
  for (const b of [...bars].sort((a, c) => a.from - c.from)) {
    const row = rows.find((r) => r[r.length - 1].to <= b.from)
    if (row) row.push(b)
    else rows.push([b])
  }
  return rows
}

/** Events while the server is closed (maintenance, restart) */
function overlaps(bars: Bar[], zone: string): string[] {
  const out: string[] = []
  const closed = bars.filter((b) => (b.lane === 'maintenance' && b.tone === TONE.maintenance) || b.lane === 'restart')
  for (const e of bars.filter((b) => b.lane === 'event'))
    for (const c of closed) {
      const to = c.realEnd ?? c.to
      if (e.from < to && c.from < (e.realEnd ?? e.to))
        out.push(`The event “${e.label.replace(/^\d\d:\d\d /, '')}” (${formatWhen(e.from, zone)}) happens during ${c.lane === 'restart' ? `the ${c.tone === TONE.extra ? 'extra' : 'daily'} restart (${formatTime(c.from, zone)})` : `the maintenance (${formatWhen(c.from, zone)})`}.`)
    }
  return [...new Set(out)]
}
