import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Bell, BellRing, Construction, MapPin, Signal, X } from 'lucide-react'
import type { OnlinePlayer, ServerStatus } from '@shared/server'
import type { SkinInfo } from '@shared/skins'
import { SkinView } from './skin/SkinView'
import type { Feed } from '@shared/feed'
import { nextRestart, type RestartSchedule } from '@shared/restart'
import { RestartBox } from './feed/RestartBox'
import { NextEvent } from './feed/EventCards'
import { useLiveRestart, useNow } from '../hooks'

export default function ServerPanel({ status, feed, onOpenNews, onOpenMap }: { status: ServerStatus | null; feed: Feed | null; onOpenNews?: () => void; onOpenMap?: (uuid: string) => void }) {
  const { t, i18n } = useTranslation()
  const now = useNow()
  const schedule: RestartSchedule | null = feed ? feed.restart : null
  const restart = schedule ? nextRestart(now, schedule) : null
  // restarting: from the scheduled time until the server answers again (checked live every few seconds)
  const live = useLiveRestart()
  const restarting = live?.phase === 'restarting'
  const maintenance = feed?.maintenance.active === true
  const online = status?.online === true && !restarting && !maintenance

  // in Home's right column, which keeps it above the footer: it gives up height first (its player list scrolls)
  return (
    <aside data-tour="server" className="glass animate-rise flex min-h-0 w-full flex-col p-4 [animation-delay:300ms] [&>*]:flex-none">
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
        restart && <RestartBox restart={restart} live={live} now={now} />
      )}

      <NextEvent events={feed?.events} now={now} onOpen={onOpenNews} />

      {online && <PlayerList status={status} onOpenMap={onOpenMap} />}
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

function PlayerList({ status, onOpenMap }: { status: ServerStatus; onOpenMap?: (uuid: string) => void }) {
  const { t } = useTranslation()
  // a player's card, beside the panel (a click on their name)
  const [card, setCard] = useState<{ player: OnlinePlayer; top: number; right: number } | null>(null)
  const open = (player: OnlinePlayer, el: HTMLElement) => {
    if (card?.player.uuid === player.uuid) return setCard(null)
    const row = el.getBoundingClientRect()
    const panel = el.closest('aside')?.getBoundingClientRect() ?? row
    setCard({ player, top: row.top, right: window.innerWidth - panel.left + 12 })
  }
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
            <button
              key={p.uuid}
              title={p.name}
              onClick={(e) => open(p, e.currentTarget)}
              aria-expanded={card?.player.uuid === p.uuid}
              className={`flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left text-[13px] transition-colors hover:bg-gray-700/60 ${card?.player.uuid === p.uuid ? 'bg-gray-700/60' : ''}`}
            >
              <img
                src={`https://mc-heads.net/avatar/${p.uuid}/40`}
                alt=""
                className="h-5 w-5 flex-none rounded-[3px] bg-gray-700 [image-rendering:pixelated]"
                draggable={false}
              />
              <span className="truncate">{p.name}</span>
            </button>
          ))}
        </div>
      )}
      {total > 0 && more > 0 && (
        <div className="mt-1.5 rounded-md bg-gray-900/50 py-1 text-center text-[13px] font-semibold text-gray-400">{t('server.more', { count: more })}</div>
      )}
      {card && <PlayerCard key={card.player.uuid} {...card} onClose={() => setCard(null)} onOpenMap={onOpenMap} />}
    </>
  )
}

/**
 * A player's card, beside the server panel: their skin in 3D (a still picture), where they are, and the map following
 * them. Closes with Esc, a click elsewhere, or their name again.
 */
function PlayerCard({ player, top, right, onClose, onOpenMap }: { player: OnlinePlayer; top: number; right: number; onClose(): void; onOpenMap?: (uuid: string) => void }) {
  const { t } = useTranslation()
  const [skin, setSkin] = useState<SkinInfo | null>(null)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let alive = true
    void window.hemisphere.skins.player(player.uuid).then((s) => alive && setSkin(s))
    return () => {
      alive = false
    }
  }, [player.uuid])
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    // a click elsewhere closes it; on a name of the list, that name decides (another card, or this one closed)
    const away = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!box.current?.contains(target) && !target.closest('[aria-expanded]')) onClose()
    }
    window.addEventListener('keydown', key)
    window.addEventListener('mousedown', away)
    window.addEventListener('resize', onClose)
    return () => {
      window.removeEventListener('keydown', key)
      window.removeEventListener('mousedown', away)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  const height = 330
  return createPortal(
    <div
      ref={box}
      role="dialog"
      aria-label={player.name}
      className="glass animate-fade fixed z-50 flex w-[220px] flex-col items-center bg-gray-900/85 p-3"
      style={{ top: Math.max(60, Math.min(top - 120, window.innerHeight - height - 16)), right }}
    >
      <div className="flex w-full items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-semibold text-white">{player.name}</span>
        <button onClick={onClose} aria-label={t('window.close')} className="grid size-6 place-items-center rounded-md text-gray-500 transition-colors hover:bg-gray-700 hover:text-white">
          <X size={14} />
        </button>
      </div>
      <div className="my-1 grid h-[200px] w-[130px] place-items-center">{skin ? <SkinView skin={skin} width={130} height={200} /> : <div className="h-[170px] w-[70px] animate-pulse rounded-md bg-gray-700/60" />}</div>
      {player.dimension && (
        <span className="rounded-full bg-gray-800 px-2.5 py-0.5 text-[12px] font-semibold text-gray-300">{t(`map.dimension.${player.dimension}`)}</span>
      )}
      {onOpenMap && (
        <button onClick={() => onOpenMap(player.uuid)} className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-green-600 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-green-500">
          <MapPin size={14} /> {t('map.showPlayer')}
        </button>
      )}
    </div>,
    document.body,
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
