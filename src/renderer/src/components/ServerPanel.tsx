import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bell, BellRing, CalendarDays, Clock, Construction, Signal } from 'lucide-react'
import { eventPhase, upcomingEvents } from '@shared/events'
import { localize } from '@shared/manifest'
import { relativeTime } from './Events'
import type { ServerStatus } from '@shared/server'
import type { Feed } from '@shared/feed'
import { nextRestart, type LiveRestart, type RestartSchedule, type RestartState } from '@shared/restart'
import { splitDuration, useLiveRestart, useNow } from '../hooks'

/** The panel stops above Home's footer (news card, links): the player list scrolls in whatever room is left. */
function useRoomAboveFooter() {
  const ref = useRef<HTMLElement>(null)
  const [max, setMax] = useState<number | undefined>(undefined)
  useLayoutEffect(() => {
    const parent = ref.current?.parentElement
    const footer = parent?.querySelector(':scope > footer')
    if (!parent || !(footer instanceof HTMLElement)) return
    const measure = () => setMax(Math.max(160, footer.offsetTop - (ref.current?.offsetTop ?? 0) - 10))
    const observer = new ResizeObserver(measure)
    observer.observe(parent)
    observer.observe(footer)
    measure()
    return () => observer.disconnect()
  }, [])
  return { ref, max }
}

export default function ServerPanel({ status, feed, onOpenNews }: { status: ServerStatus | null; feed: Feed | null; onOpenNews?: () => void }) {
  const { t, i18n } = useTranslation()
  const now = useNow()
  const schedule: RestartSchedule | null = feed ? feed.restart : null
  const restart = schedule ? nextRestart(now, schedule) : null
  // restarting: from the scheduled time until the server answers again (checked live every few seconds)
  const live = useLiveRestart()
  const restarting = live?.phase === 'restarting'
  const maintenance = feed?.maintenance.active === true
  const online = status?.online === true && !restarting && !maintenance
  const room = useRoomAboveFooter()
  const next = upcomingEvents(feed?.events, now).find((e) => Date.parse(e.start) - now < 7 * 24 * 3600_000)

  return (
    <aside ref={room.ref} style={{ maxHeight: room.max }} className="glass animate-rise absolute top-5 right-6 flex w-[268px] flex-col p-4 [animation-delay:300ms] [&>*]:flex-none">
      <p className="text-xs font-bold tracking-[0.08em] text-gray-400 uppercase">{t('server.name')}</p>

      <div className="mt-2 flex items-center justify-between">
        <StatusPill status={status} restarting={restarting} maintenance={maintenance} />
        {online && status.latencyMs !== null && (
          <span className="flex items-center gap-1 text-xs text-gray-400" title={t('server.latency')}>
            <Signal size={14} />
            {status.latencyMs} ms
          </span>
        )}
      </div>

      {maintenance && feed ? (
        <div className="mt-3 flex items-start gap-2.5 rounded-lg bg-amber-900/50 px-3 py-2.5 text-[13px] shadow-[inset_3px_0_0_var(--color-amber-400)]">
          <Construction size={16} className="mt-0.5 flex-none text-amber-400" />
          <span className="text-amber-100">
            {t('server.maintenanceShort')}
            {feed.maintenance.until && new Date(feed.maintenance.until).getTime() > now && (
              <span className="block text-xs text-amber-200/80">
                {t('home.maintenanceUntil', { time: new Date(feed.maintenance.until).toLocaleString(i18n.language, { weekday: 'short', hour: '2-digit', minute: '2-digit' }) })}
              </span>
            )}
          </span>
        </div>
      ) : (
        restart && <RestartBox restart={restart} live={live} />
      )}

      {next && (
        <button
          onClick={onOpenNews}
          title={localize(next.title, i18n.language)}
          className={`mt-2.5 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[12.5px] transition-colors ${eventPhase(next, now) === 'live' ? 'bg-green-900/45 text-green-100 hover:bg-green-900/60' : 'bg-gray-900/55 text-gray-300 hover:bg-gray-800/80'}`}
        >
          <CalendarDays size={15} className="flex-none text-green-400" />
          <span className="min-w-0 flex-1 truncate">
            <b className="font-semibold text-white">{localize(next.title, i18n.language)}</b>
          </span>
          <span className="flex-none text-[11.5px] text-gray-400">{eventPhase(next, now) === 'live' ? t('events.live') : relativeTime(Date.parse(next.start), now, i18n.language)}</span>
        </button>
      )}

      {online && <PlayerList status={status} />}
    </aside>
  )
}

function StatusPill({ status, restarting, maintenance }: { status: ServerStatus | null; restarting: boolean; maintenance: boolean }) {
  const { t } = useTranslation()
  const [tone, label] = maintenance
    ? (['text-amber-400', t('server.maintenance')] as const)
    : restarting
    ? (['text-red-400', t('server.restartingShort')] as const)
    : status === null
      ? (['text-gray-400', t('server.checking')] as const)
      : status.online === true
        ? (['text-green-400', t('server.online')] as const)
        : status.online === false
          ? (['text-red-400', t('server.offline')] as const)
          : (['text-gray-400', t('server.unknown')] as const)
  const pulse = status?.online === true && !restarting && !maintenance

  return (
    <span className={`inline-flex items-center gap-2 rounded-full bg-gray-900/75 px-3 py-[5px] text-xs font-bold tracking-[0.06em] uppercase ${tone}`}>
      <i className={`h-2 w-2 rounded-full bg-current shadow-[0_0_8px_currentColor] ${pulse ? 'animate-pulse' : ''}`} />
      {label}
    </span>
  )
}

function RestartBox({ restart, live }: { restart: RestartState; live: LiveRestart }) {
  const { t, i18n } = useTranslation()
  const localTime = new Date(restart.next).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })

  const now = useNow()
  let main: string
  let sub: string
  let phase: 'restarting' | 'back' | 'soon' | 'normal' = restart.phase === 'soon' ? 'soon' : 'normal'
  if (live?.phase === 'restarting') {
    phase = 'restarting'
    main = t('server.restarting')
    sub = t('server.restartingLive', { s: Math.max(0, Math.round((now - live.checkedAt) / 1000)) })
  } else if (live?.phase === 'back') {
    phase = 'back'
    main = t('server.backOnline')
    sub = t('server.backAt', { time: new Date(live.at).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' }) })
  } else if (restart.phase === 'soon') {
    const s = Math.floor(restart.msLeft / 1000)
    main = t('server.restartIn', { time: `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` })
    sub = t('server.dailyAt', { time: localTime })
  } else {
    const { h, m } = splitDuration(restart.msLeft)
    main = t('server.restartIn', { time: h ? t('time.hm', { h, m }) : t('time.m', { m }) })
    sub = t('server.dailyAt', { time: localTime })
  }

  const tone =
    phase === 'restarting'
      ? 'bg-red-900/45 shadow-[inset_3px_0_0_var(--color-red-400)] [&_.accent]:text-red-400'
      : phase === 'back'
        ? 'bg-green-900/45 shadow-[inset_3px_0_0_var(--color-green-400)] [&_.accent]:text-green-400'
        : phase === 'soon'
        ? 'bg-amber-900/50 shadow-[inset_3px_0_0_var(--color-amber-400)] [&_.accent]:text-amber-400'
        : 'bg-gray-900/60 [&_.accent]:text-white'

  return (
    <div className={`mt-3 flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-[13px] ${tone}`}>
      {phase === 'restarting' ? <span className="accent mt-1 h-3 w-3 flex-none animate-pulse rounded-full bg-red-400" /> : <Clock size={16} className="accent mt-0.5 text-gray-400" />}
      <div>
        <div className="accent font-semibold tabular-nums">{main}</div>
        <div className="text-xs text-gray-400">{sub}</div>
      </div>
    </div>
  )
}

function PlayerList({ status }: { status: ServerStatus }) {
  const { t } = useTranslation()
  // up to 6 players visible (3 rows of 2; fewer when the window is short); the rest of the list scrolls
  const shown = status.players
  const total = status.playersOnline ?? status.players.length
  // the server only lists some of its players: the others are counted below the list
  const more = total - shown.length

  return (
    <>
      <div className="mt-3.5 mb-2 flex items-center justify-between">
        <span className="text-xs font-bold tracking-[0.08em] text-gray-400 uppercase">{t('server.onlineNow')}</span>
        {status.playersOnline !== null && (
          <span className="text-xs text-gray-400 tabular-nums">
            {status.playersOnline} / {status.playersMax}
          </span>
        )}
      </div>
      {status.playersMax !== null && status.playersOnline !== null && status.playersOnline >= status.playersMax && <SlotWatch />}
      {total === 0 ? (
        <p className="rounded-md bg-gray-900/50 px-3 py-2 text-[13px] text-gray-400">{t('server.nobody')}</p>
      ) : (
        <div className="grid max-h-[92px] min-h-[28px] shrink! grid-cols-2 gap-x-2 gap-y-1 overflow-y-auto pr-0.5 [scrollbar-color:var(--color-gray-600)_transparent] [scrollbar-width:thin]">
          {shown.map((p) => (
            <div key={p.uuid} title={p.name} className="flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-[13px] hover:bg-gray-700/60">
              <img
                src={`https://mc-heads.net/avatar/${p.uuid}/40`}
                alt=""
                className="h-5 w-5 flex-none rounded-[3px] bg-gray-700 [image-rendering:pixelated]"
                draggable={false}
              />
              <span className="truncate">{p.name}</span>
            </div>
          ))}
        </div>
      )}
      {total > 0 && more > 0 && (
        <div className="mt-1.5 rounded-md bg-gray-900/50 py-1 text-center text-[13px] font-semibold text-gray-400">{t('server.more', { count: more })}</div>
      )}
    </>
  )
}

/** Server full: "tell me when a place frees up" (one notification, then it's over). */
function SlotWatch() {
  const { t } = useTranslation()
  const [on, setOn] = useState<boolean | null>(null)
  useEffect(() => {
    window.hemisphere.server.slotWatched().then(setOn)
  }, [])
  if (on === null) return null
  return (
    <button
      onClick={() => window.hemisphere.server.watchSlot(!on).then(setOn)}
      aria-pressed={on}
      className={`mb-2 flex w-full items-center justify-center gap-1.5 rounded-md py-1.5 text-[12.5px] font-semibold transition-colors ${on ? 'bg-green-900/50 text-green-200 hover:bg-green-900/70' : 'bg-amber-500/20 text-amber-100 hover:bg-amber-500/30'}`}
    >
      {on ? <BellRing size={14} /> : <Bell size={14} />} {on ? t('server.slotWatching') : t('server.slotWatch')}
    </button>
  )
}
