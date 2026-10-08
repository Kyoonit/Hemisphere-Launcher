import { useTranslation } from 'react-i18next'
import { Clock, Construction, Signal } from 'lucide-react'
import type { ServerStatus } from '@shared/server'
import type { Feed } from '@shared/feed'
import { restartState, type RestartSchedule, type RestartState } from '@shared/restart'
import { splitDuration, useNow, useShortWindow } from '../hooks'

// fewer heads in a short window so the panel never reaches the news card
const MAX_HEADS = 10
const MAX_HEADS_SHORT = 4

export default function ServerPanel({ status, feed }: { status: ServerStatus | null; feed: Feed | null }) {
  const { t, i18n } = useTranslation()
  const now = useNow()
  const schedule: RestartSchedule | null = feed ? feed.restart : null
  const restart = schedule ? restartState(now, schedule) : null
  const restarting = restart?.phase === 'restarting'
  const maintenance = feed?.maintenance.active === true
  const online = status?.online === true && !restarting && !maintenance

  return (
    <aside className="glass animate-rise absolute top-5 right-6 w-[268px] p-4 [animation-delay:300ms]">
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
        restart && <RestartBox restart={restart} />
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
    ? (['text-red-400', t('server.offline')] as const)
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

function RestartBox({ restart }: { restart: RestartState }) {
  const { t, i18n } = useTranslation()
  const localTime = new Date(restart.next).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })

  let main: string
  let sub: string
  if (restart.phase === 'restarting') {
    main = t('server.restarting')
    sub = t('server.backIn', { min: Math.max(1, Math.ceil(restart.msLeft / 60_000)) })
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
    restart.phase === 'restarting'
      ? 'bg-red-900/45 shadow-[inset_3px_0_0_var(--color-red-400)] [&_.accent]:text-red-400'
      : restart.phase === 'soon'
        ? 'bg-amber-900/50 shadow-[inset_3px_0_0_var(--color-amber-400)] [&_.accent]:text-amber-400'
        : 'bg-gray-900/60 [&_.accent]:text-white'

  return (
    <div className={`mt-3 flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-[13px] ${tone}`}>
      <Clock size={16} className="accent mt-0.5 text-gray-400" />
      <div>
        <div className="accent font-semibold tabular-nums">{main}</div>
        <div className="text-xs text-gray-400">{sub}</div>
      </div>
    </div>
  )
}

function PlayerList({ status }: { status: ServerStatus }) {
  const { t } = useTranslation()
  const shown = status.players.slice(0, useShortWindow() ? MAX_HEADS_SHORT : MAX_HEADS)
  const total = status.playersOnline ?? status.players.length
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
      {total === 0 ? (
        <p className="rounded-md bg-gray-900/50 px-3 py-2 text-[13px] text-gray-400">{t('server.nobody')}</p>
      ) : (
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
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
          {more > 0 && (
            <div className="col-span-2 mt-1 rounded-md bg-gray-900/50 py-1 text-center text-[13px] font-semibold text-gray-400">
              {t('server.more', { count: more })}
            </div>
          )}
        </div>
      )}
    </>
  )
}
