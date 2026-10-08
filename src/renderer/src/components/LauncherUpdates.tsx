import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Gauge, House, Image, Package, Play, Rocket, Settings, Sparkles, Users, type LucideIcon } from 'lucide-react'
import { byArea, LAUNCHER_CHANGELOG, visibleHistory, type ChangeArea, type LauncherDay } from '@shared/launcherChangelog'

export const AREA_ICONS: Record<ChangeArea, LucideIcon> = {
  play: Play,
  home: House,
  content: Package,
  screenshots: Image,
  community: Users,
  settings: Settings,
  performance: Gauge,
  launcher: Rocket,
}

const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
/** "Today", "Yesterday", or null */
export function relativeDay(date: string): 'today' | 'yesterday' | null {
  const now = new Date()
  if (date === localDay(now)) return 'today'
  now.setDate(now.getDate() - 1)
  return date === localDay(now) ? 'yesterday' : null
}
export const dayLabel = (date: string, lang: string, style: 'long' | 'short') =>
  new Date(`${date}T12:00:00`).toLocaleDateString(lang, style === 'long' ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' } : { day: 'numeric', month: 'short' })

/** Development builds also show the days not released yet ("next"). */
export function useLauncherHistory(): LauncherDay[] | null {
  const [packaged, setPackaged] = useState<boolean | null>(null)
  useEffect(() => {
    window.hemisphere.appInfo().then((a) => setPackaged(a.packaged))
  }, [])
  return packaged === null ? null : visibleHistory(LAUNCHER_CHANGELOG, !packaged)
}

/** News > Launcher: everything that changed in the launcher, one card per day (the latest two open). */
export default function LauncherUpdates() {
  const { t } = useTranslation()
  const history = useLauncherHistory()
  if (!history) return null
  if (history.length === 0) return <p className="mt-10 text-center text-gray-400">{t('launcherNews.empty')}</p>
  const total = history.reduce((n, d) => n + d.changes.length, 0)
  return (
    <div className="animate-fade">
      <p className="mb-4 flex items-center gap-2 text-[13.5px] text-gray-400">
        <Sparkles size={15} className="text-green-400" /> {t('launcherNews.intro', { days: history.length, count: total })}
      </p>
      <ol className="relative space-y-4 border-l-2 border-gray-700/70 pl-6">
        {history.map((day, i) => (
          <Day key={day.date} day={day} open={i < 2} />
        ))}
      </ol>
    </div>
  )
}

function Day({ day, open: openAtFirst }: { day: LauncherDay; open: boolean }) {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(openAtFirst)
  const fr = i18n.language.startsWith('fr')
  const rel = relativeDay(day.date)
  const groups = byArea(day)
  return (
    <li className="relative">
      <span className={`absolute top-[18px] -left-[31px] h-3 w-3 rounded-full ring-4 ring-gray-900 ${rel === 'today' ? 'bg-green-400' : 'bg-gray-500'}`} aria-hidden />
      <section className="glass overflow-hidden">
        <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-gray-700/30">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold tracking-[0.08em] text-green-400 uppercase">
              {rel ? t(`launcherNews.${rel}`) : dayLabel(day.date, i18n.language, 'short')}
              <span className="ml-2 text-gray-500">{t('launcherNews.changes', { count: day.changes.length })}</span>
            </p>
            <h2 className="text-[17px] font-bold text-white first-letter:uppercase">{dayLabel(day.date, i18n.language, 'long')}</h2>
          </div>
          <span className={`flex-none rounded-md px-2 py-0.5 text-[11.5px] font-bold ${day.version === 'next' ? 'bg-violet-500/20 text-violet-200' : 'bg-green-500/15 text-green-300'}`}>
            {day.version === 'next' ? t('launcherNews.inDev') : t('launcherNews.version', { version: day.version })}
          </span>
          <ChevronDown size={18} className={`flex-none text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {open ? (
          <div className="columns-2 gap-8 border-t border-gray-700/60 px-5 pt-3 pb-4 max-[1100px]:columns-1">
            {groups.map(({ area, changes }) => {
              const Icon = AREA_ICONS[area]
              return (
                <div key={area} className="mb-3 break-inside-avoid">
                  <h3 className="mb-1 flex items-center gap-1.5 text-[12px] font-bold tracking-[0.06em] text-gray-300 uppercase">
                    <Icon size={13} className="text-green-400" /> {t(`launcherNews.areas.${area}`)}
                  </h3>
                  <ul className="space-y-1 text-[13.5px] leading-snug text-gray-300">
                    {changes.map((c, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="text-green-400">•</span>
                        <span>{fr ? c.fr : c.en}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5 border-t border-gray-700/60 px-5 py-2.5">
            {groups.map(({ area, changes }) => {
              const Icon = AREA_ICONS[area]
              return (
                <span key={area} className="flex items-center gap-1 rounded-md bg-gray-800/80 px-2 py-0.5 text-[12px] text-gray-300">
                  <Icon size={12} className="text-green-400" /> {t(`launcherNews.areas.${area}`)} · {changes.length}
                </span>
              )
            })}
          </div>
        )}
      </section>
    </li>
  )
}
