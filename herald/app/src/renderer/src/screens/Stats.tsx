/**
 * Statistics tab: the Minecraft server seen by Herald every minute (the game's status ping and BlueMap's live player
 * list; nothing installed on the server). Players online over a day, a week or a month, the week's rhythm, who plays
 * the most, the dimensions, and the catalogue items tried. Bots (offline-mode ids) are left out.
 */
import { useEffect, useState } from 'react'
import { DIMENSIONS, type Dimension, type ServerStatsView, type StatsRange } from '@shared/serverStats'
import { useStore } from '../store'
import { ago, formatDay, formatTime, formatWhen, zoneName } from '../time'

const RANGES: { id: StatsRange; label: string }[] = [
  { id: 'day', label: '24 hours' },
  { id: 'week', label: '7 days' },
  { id: 'month', label: '30 days' },
]
const DIMENSION_LABEL: Record<Dimension, string> = { overworld: 'Overworld', nether: 'Nether', end: 'End' }
const DIMENSION_COLOR: Record<Dimension, string> = { overworld: 'bg-green-500', nether: 'bg-red-500', end: 'bg-violet-400' }
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** 95 → "1 h 35", 40 → "40 min" */
export const duration = (minutes: number) => (minutes >= 60 ? `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}` : `${minutes} min`)

export default function Stats() {
  const { zone } = useStore()
  const [range, setRange] = useState<StatsRange>('day')
  const [view, setView] = useState<ServerStatsView | null>(null)
  const [error, setError] = useState<string | null>(null)

  // a fresh view now and every minute (the server collects once a minute)
  useEffect(() => {
    let alive = true
    const load = () =>
      // days and hours in this profile's time zone
      void window.herald.api<ServerStatsView>('GET', `/stats?range=${range}&zone=${encodeURIComponent(zone)}`).then((r) => {
        if (!alive) return
        if (r.ok) {
          setView(r.data)
          setError(null)
        } else setError(r.error)
      })
    load()
    const timer = window.setInterval(load, 60_000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [range, zone])

  const shown = view?.range === range ? view : null
  return (
    <div className="animate-fade">
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <div className="eyebrow">Seen every minute, nothing installed on the server</div>
          <h1 className="text-[26px] font-extrabold text-white">Statistics</h1>
        </div>
        <div data-tour="stats-range" className="ml-auto flex rounded-lg bg-gray-800 p-1">
          {RANGES.map((r) => (
            <button key={r.id} onClick={() => setRange(r.id)} className={`rounded-md px-3 py-1.5 text-sm font-semibold transition-colors ${range === r.id ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-white'}`}>
              {r.label}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="mb-3 rounded-lg border border-red-400/30 bg-red-600/10 px-3 py-2 text-sm text-red-300">{error}</p>}
      {!shown ? (
        !error && <div className="text-gray-400">Loading…</div>
      ) : shown.collectingSince === null ? (
        <div className="card text-sm text-gray-300">Nothing collected yet: the first numbers arrive within a minute of the server update.</div>
      ) : (
        <StatsBody view={shown} zone={zone} />
      )}
    </div>
  )
}

function StatsBody({ view, zone }: { view: ServerStatsView; zone: string }) {
  const last = view.last
  // who played the most: over 24 hours, 7 days, 30 days (the range shown at first) or since the statistics began
  const [over, setOver] = useState<StatsRange | 'all'>(view.range)
  const top = over === 'all' ? view.topAllTime : view.tops[over]
  // the range started before the collection: say so (fewer days than the range)
  const partial = view.collectingSince !== null && view.collectingSince > view.from
  return (
    <>
      <div className="mb-4 grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
        <Metric label="Online now" value={last?.online ? `${last.players ?? '?'} / ${last.max ?? '?'}` : 'Offline'} tone={last?.online ? 'text-green-400' : 'text-red-400'} hint={last ? `${last.latencyMs !== null ? `${last.latencyMs} ms · ` : ''}${last.version ?? ''} · ${ago(last.at)}` : undefined} />
        <Metric label="Most at once" value={view.peak ? String(view.peak.players) : '–'} hint={view.peak ? formatWhen(view.peak.at, zone) : undefined} />
        <Metric label="Different players" value={String(view.unique)} hint={`${view.newPlayers} new · ${view.allPlayers} seen in all`} />
        <Metric label="Sessions" value={String(view.sessions.count)} hint={view.sessions.averageMinutes !== null ? `${duration(view.sessions.averageMinutes)} on average · ${duration(view.sessions.minutes)} in all` : undefined} />
        <Metric label="Server up" value={view.uptime !== null ? `${Math.floor(view.uptime * 1000) / 10} %` : '–'} hint="of the minutes checked" />
      </div>

      <div className="card mb-4">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h2 className="font-bold text-white">Players online</h2>
          <span className="text-xs text-gray-500">{partial ? `Collected since ${formatWhen(view.collectingSince!, zone)}` : 'Most players at once in each slice; red: the server did not answer'}</span>
        </div>
        <Curve view={view} zone={zone} />
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <div className="card">
          <h2 className="mb-2 font-bold text-white">Online now</h2>
          {view.online.length === 0 ? (
            <p className="text-sm text-gray-400">Nobody (players hidden from the map are counted above, not listed).</p>
          ) : (
            <ul className="max-h-[260px] space-y-1 overflow-auto pr-1">
              {view.online.map((p) => (
                <PlayerRow key={p.uuid} uuid={p.uuid} name={p.name} right={`since ${formatTime(p.since, zone)} · ${duration(p.minutes)}`} />
              ))}
            </ul>
          )}
        </div>
        <div className="card">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className="font-bold text-white">Who played the most</h2>
            <div className="flex rounded-md bg-gray-900/60 p-0.5 text-xs">
              {[...RANGES, { id: 'all' as const, label: 'All time' }].map((o) => (
                <button key={o.id} onClick={() => setOver(o.id)} className={`rounded px-2 py-1 font-semibold whitespace-nowrap transition-colors ${over === o.id ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-white'}`}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          {top.length === 0 ? (
            <p className="text-sm text-gray-400">{over === 'all' ? 'Nobody has played yet.' : 'No session in this time yet.'}</p>
          ) : (
            <ol className="max-h-[260px] space-y-1 overflow-auto pr-1">
              {top.map((p, i) => (
                <PlayerRow key={p.uuid} uuid={p.uuid} name={p.name} rank={i + 1} right={`${duration(p.minutes)} · ${p.sessions} session${p.sessions > 1 ? 's' : ''}`} />
              ))}
            </ol>
          )}
        </div>
      </div>

      {view.range !== 'day' && (
        <div className="card mb-4">
          <h2 className="mb-2 font-bold text-white">Each day</h2>
          <Days view={view} />
        </div>
      )}

      <div className="mb-4 grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="card">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h2 className="font-bold text-white">When people play</h2>
            <span className="text-xs text-gray-500">Average players online, last 4 weeks ({zoneName(view.zone)} time)</span>
          </div>
          <Heat heat={view.heat} />
        </div>
        <div className="flex flex-col gap-4">
          <div className="card">
            <h2 className="mb-2 font-bold text-white">Time in each dimension</h2>
            <Dimensions minutes={view.dimensions} />
          </div>
          <div className="card">
            <h2 className="mb-2 font-bold text-white">Catalogue: tried the most</h2>
            {view.catalogue.length === 0 ? (
              <p className="text-sm text-gray-400">Nothing tried in this range.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {view.catalogue.map((c) => (
                  <li key={c.itemId} className="flex justify-between gap-3">
                    <span className="truncate text-gray-200">{c.name}</span>
                    <span className="shrink-0 text-gray-400 tabular-nums">
                      {c.players} player{c.players > 1 ? 's' : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
      <p className="text-xs text-gray-500">Bots (offline-mode accounts such as chunk loaders) are left out. Players who hide from the map are counted, but have no sessions.</p>
    </>
  )
}

function Metric({ label, value, hint, tone = 'text-white' }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="card">
      <div className="text-xs font-semibold text-gray-400">{label}</div>
      <div className={`mt-1 text-[24px] font-extrabold tabular-nums ${tone}`}>{value}</div>
      {hint && <div className="mt-0.5 truncate text-xs text-gray-500" title={hint}>{hint}</div>}
    </div>
  )
}

function PlayerRow({ uuid, name, right, rank }: { uuid: string; name: string; right: string; rank?: number }) {
  return (
    <li className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-gray-700/50">
      {rank !== undefined && <span className="w-5 shrink-0 text-right text-xs text-gray-500 tabular-nums">{rank}</span>}
      <img src={`https://mc-heads.net/avatar/${uuid}/32`} alt="" className="size-5 shrink-0 rounded-[3px] bg-gray-700 [image-rendering:pixelated]" draggable={false} />
      <span className="min-w-0 flex-1 truncate text-gray-100">{name}</span>
      <span className="shrink-0 text-xs text-gray-400 tabular-nums">{right}</span>
    </li>
  )
}

/** Players online over the range: one bar per slice (red where the server did not answer), the time under it */
function Curve({ view, zone }: { view: ServerStatsView; zone: string }) {
  const [hover, setHover] = useState<number | null>(null)
  const points = view.curve
  const max = Math.max(1, ...points.map((p) => p.players ?? 0))
  const W = 1000
  const H = 180
  const w = W / points.length
  const label = (at: number) => (view.range === 'day' ? formatTime(at, zone) : view.range === 'week' ? `${formatDay(at, zone)} ${formatTime(at, zone)}` : formatDay(at, zone))
  const ticks = [0, 0.25, 0.5, 0.75].map((f) => Math.floor(f * points.length))
  const h = hover !== null ? points[hover] : null
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H + 22}`} className="h-[220px] w-full" preserveAspectRatio="none" onMouseLeave={() => setHover(null)}>
        {[0.5, 1].map((f) => (
          <line key={f} x1={0} x2={W} y1={H - f * H} y2={H - f * H} stroke="currentColor" className="text-white/5" />
        ))}
        {points.map((p, i) => {
          const down = p.players === null ? false : p.up < 0.5
          const height = p.players === null ? 0 : Math.max(2, (p.players / max) * (H - 8))
          return (
            <g key={p.at} onMouseEnter={() => setHover(i)}>
              <rect x={i * w} y={0} width={w} height={H} fill="transparent" />
              {p.players === null ? null : down ? (
                <rect x={i * w + w * 0.1} y={H - 6} width={w * 0.8} height={6} className="fill-red-500/70" />
              ) : (
                <rect x={i * w + w * 0.1} y={H - height} width={w * 0.8} height={height} rx={Math.min(3, w / 4)} className={hover === i ? 'fill-green-300' : 'fill-green-500/80'} />
              )}
            </g>
          )
        })}
        {ticks.map((i) => (
          <text key={i} x={i * w} y={H + 16} className="fill-gray-500 text-[13px]">
            {label(points[i]?.at ?? view.from)}
          </text>
        ))}
      </svg>
      <span className="pointer-events-none absolute top-0 right-0 text-xs text-gray-500">max {max}</span>
      {h && (
        <div className="pointer-events-none absolute top-1 left-1/2 -translate-x-1/2 rounded-md bg-gray-900/95 px-2.5 py-1 text-xs text-gray-200 shadow">
          {label(h.at)} · {h.players === null ? 'not collected' : h.up < 0.5 ? 'server not answering' : `${h.players} player${h.players === 1 ? '' : 's'}`}
        </div>
      )}
    </div>
  )
}

/** Different players and time played, day by day */
function Days({ view }: { view: ServerStatsView }) {
  const max = Math.max(1, ...view.days.map((d) => d.players))
  return (
    <div className="flex h-[150px] items-end gap-1">
      {view.days.map((d) => (
        <div key={d.day} className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${d.day}: ${d.players} player${d.players === 1 ? '' : 's'}, ${duration(d.minutes)}`}>
          <span className="text-[10px] text-gray-400 tabular-nums">{d.players || ''}</span>
          {/* the bar's height is a share of this space only (not of the labels around it) */}
          <div className="flex min-h-0 w-full flex-1 items-end">
            <div className="w-full rounded-t bg-sky-500/80 group-hover:bg-sky-300" style={{ height: `${(d.players / max) * 100}%`, minHeight: d.players ? 3 : 0 }} />
          </div>
          <span className="text-[10px] text-gray-500">{d.day.slice(8)}</span>
        </div>
      ))}
    </div>
  )
}

/** Average players by weekday and hour: darker green, more players */
function Heat({ heat }: { heat: (number | null)[][] }) {
  const max = Math.max(1, ...heat.flat().map((v) => v ?? 0))
  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[560px] grid-cols-[34px_repeat(24,minmax(0,1fr))] gap-[3px] text-[10px] text-gray-500">
        <span />
        {Array.from({ length: 24 }, (_, h) => (
          <span key={h} className="text-center">
            {h % 3 === 0 ? h : ''}
          </span>
        ))}
        {heat.map((row, d) => (
          <Row key={d} day={WEEKDAYS[d]} row={row} max={max} />
        ))}
      </div>
    </div>
  )
}
function Row({ day, row, max }: { day: string; row: (number | null)[]; max: number }) {
  return (
    <>
      <span className="self-center">{day}</span>
      {row.map((v, h) => (
        <span
          key={h}
          title={v === null ? `${day} ${h}:00 · no data` : `${day} ${h}:00 · ${v} on average`}
          className="h-5 rounded-[3px]"
          style={{ background: v === null ? 'rgba(255,255,255,0.03)' : `rgba(34,197,94,${0.12 + 0.88 * (v / max)})` }}
        />
      ))}
    </>
  )
}

function Dimensions({ minutes }: { minutes: Record<Dimension, number> }) {
  const total = DIMENSIONS.reduce((n, d) => n + minutes[d], 0)
  if (!total) return <p className="text-sm text-gray-400">No time recorded yet.</p>
  return (
    <>
      <div className="mb-2 flex h-3 overflow-hidden rounded-full bg-gray-700">
        {DIMENSIONS.map((d) => (
          <div key={d} className={DIMENSION_COLOR[d]} style={{ width: `${(minutes[d] / total) * 100}%` }} />
        ))}
      </div>
      <ul className="space-y-0.5 text-sm">
        {DIMENSIONS.map((d) => (
          <li key={d} className="flex items-center gap-2">
            <i className={`size-2.5 rounded-full ${DIMENSION_COLOR[d]}`} />
            <span className="flex-1 text-gray-200">{DIMENSION_LABEL[d]}</span>
            <span className="text-gray-400 tabular-nums">
              {Math.round((minutes[d] / total) * 100)} % · {duration(minutes[d])}
            </span>
          </li>
        ))}
      </ul>
    </>
  )
}
