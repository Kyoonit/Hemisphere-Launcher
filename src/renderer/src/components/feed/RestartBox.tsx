import { useTranslation } from 'react-i18next'
import { Clock } from 'lucide-react'
import type { LiveRestart, RestartState } from '@shared/restart'

/** The restart line of the panel (also drawn by Herald's preview) */
export function RestartBox({ restart, live, now }: { restart: RestartState; live: LiveRestart; now: number }) {
  const { t, i18n } = useTranslation()
  const localTime = new Date(restart.next).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })

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
    sub = t(restart.kind === 'extra' ? 'server.extraAt' : 'server.dailyAt', { time: localTime })
  } else {
    const totalMin = Math.floor(restart.msLeft / 60_000)
    const [h, m] = [Math.floor(totalMin / 60), totalMin % 60]
    main = t('server.restartIn', { time: h ? t('time.hm', { h, m }) : t('time.m', { m }) })
    sub = t(restart.kind === 'extra' ? 'server.extraAt' : 'server.dailyAt', { time: localTime })
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
