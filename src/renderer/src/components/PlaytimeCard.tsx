import { useTranslation } from 'react-i18next'
import { splitDuration, usePlaytime } from '../hooks'

export default function PlaytimeCard() {
  const { t } = useTranslation()
  const playtime = usePlaytime()
  if (!playtime) return null

  const total = splitDuration(playtime.totalMs)
  const fmt = (ms: number | null) => (ms === null ? '—' : ms < 60_000 ? t('time.lessThanMinute') : t('time.hm', splitDuration(ms)))

  return (
    <aside
      className="glass animate-rise px-4 py-3.5 [animation-delay:300ms]"
      title={t('playtime.tooltip')}
    >
      <p className="text-xs font-bold tracking-[0.08em] text-gray-400 uppercase">{t('playtime.title')}</p>
      <p className="mt-1.5 mb-2.5 text-[30px] leading-tight font-extrabold text-white tabular-nums">
        {total.h}
        <small className="ml-px text-base font-bold text-green-400">h</small> {String(total.m).padStart(2, '0')}
        <small className="ml-px text-base font-bold text-green-400">m</small>
      </p>
      {playtime.sessions === 0 ? (
        <p className="border-t border-white/10 pt-2.5 text-xs text-gray-400">{t('playtime.empty')}</p>
      ) : (
        <dl className="flex flex-col gap-1 border-t border-white/10 pt-2.5 text-[12.5px]">
          <Stat label={t('playtime.lastSession')} value={fmt(playtime.lastSessionMs)} />
          <Stat label={t('playtime.thisWeek')} value={fmt(playtime.weekMs)} />
          <Stat label={t('playtime.sessions')} value={String(playtime.sessions)} />
        </dl>
      )}
    </aside>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-gray-400">
      <dt>{label}</dt>
      <dd className="font-semibold text-gray-200">{value}</dd>
    </div>
  )
}
