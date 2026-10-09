import { useTranslation } from 'react-i18next'
import { CalendarClock, Info, Megaphone, OctagonAlert, TriangleAlert } from 'lucide-react'
import type { FeedView } from '@shared/schedule'
import { localize } from '@shared/manifest'

/** Staff texts on Home (Herald), without data loading: used by the launcher's Home and by Herald's preview. */

const LEVEL = {
  info: { box: 'border-sky-400 bg-sky-950/60 text-sky-100', icon: <Info size={16} className="flex-none text-sky-400" /> },
  important: { box: 'border-amber-400 bg-amber-900/55 text-amber-100', icon: <Megaphone size={16} className="flex-none text-amber-400" /> },
  critical: { box: 'border-red-400 bg-red-950/70 text-red-100', icon: <OctagonAlert size={16} className="flex-none text-red-400" /> },
}

/** The announcement banner: one short line above the title, coloured by importance */
export function AnnouncementBanner({ banner }: { banner: NonNullable<FeedView['banner']> }) {
  const { i18n } = useTranslation()
  const tone = LEVEL[banner.level]
  return (
    <div role={banner.level === 'critical' ? 'alert' : 'status'} className={`animate-fade mb-5 flex max-w-[620px] items-center gap-3 rounded-lg border-l-[3px] px-4 py-2.5 text-left text-[13.5px] backdrop-blur-sm ${tone.box}`}>
      {tone.icon}
      <span>{localize(banner.text, i18n.language)}</span>
    </div>
  )
}

/**
 * "Welcome back <name>", or the staff's welcome message: its title replaces the whole heading, with an optional green
 * second line ({player} = the player's name, {server} = Hemisphere SMP); its text goes below.
 */
export function WelcomeHeading({ welcome, name, compact }: { welcome?: FeedView['welcome']; name: string | null; compact: boolean }) {
  const { t, i18n } = useTranslation()
  const custom = welcome?.title !== undefined
  const first = custom ? localize(welcome!.title!, i18n.language) : name ? t('home.welcomeBack') : t('home.welcomeTo')
  const green = custom ? (welcome?.accent ? localize(welcome.accent, i18n.language).replace(/\{player\}/g, name ?? '').replace(/\{server\}/g, t('app.name')).trim() || null : null) : (name ?? t('app.name'))
  return (
    <>
      {/* one compact line while the crash card needs the room */}
      <h1 className={`${compact ? 'home-title-compact' : 'home-title'} animate-rise leading-[1.05] font-bold text-white uppercase drop-shadow-lg [animation-delay:100ms]`}>
        {first}
        {green && (
          <>
            {compact ? ' ' : <br />}
            <span className="text-green-400">{green}</span>
          </>
        )}
      </h1>
      {welcome && !compact && <p className="animate-rise mt-3 max-w-[560px] text-[15px] leading-snug text-gray-200 drop-shadow-md [animation-delay:150ms]">{localize(welcome.text, i18n.language)}</p>}
    </>
  )
}

/** Staff maintenance message, with the end time in the player's own time zone (`now`: the instant shown) */
export function MaintenanceNotice({ maintenance, now }: { maintenance: FeedView['maintenance']; now: number }) {
  const { t, i18n } = useTranslation()
  const until = maintenance.until ? new Date(maintenance.until) : null
  return (
    <div className="animate-fade mt-2 flex max-w-[400px] items-center gap-3 rounded-lg border-l-[3px] border-amber-400 bg-amber-900/55 px-4 py-2.5 text-left text-[13px] text-amber-100 backdrop-blur-sm">
      <TriangleAlert size={16} className="flex-none text-amber-400" />
      <span>
        <b className="text-white">{t('server.maintenance')}</b> · {localize(maintenance.message, i18n.language)}
        {until && until.getTime() > now && <> {t('home.maintenanceUntil', { time: until.toLocaleString(i18n.language, { weekday: 'short', hour: '2-digit', minute: '2-digit' }) })}</>}
      </span>
    </div>
  )
}

/** A maintenance announced in advance: when (the player's time) and why */
export function PlannedMaintenance({ planned }: { planned: NonNullable<FeedView['maintenancePlanned']> }) {
  const { t, i18n } = useTranslation()
  const fmt = (iso: string, withDay: boolean) => new Date(iso).toLocaleString(i18n.language, { ...(withDay ? { weekday: 'long', day: 'numeric', month: 'long' } : {}), hour: '2-digit', minute: '2-digit' })
  const start = new Date(planned.start)
  const sameDay = planned.end && new Date(planned.end).toDateString() === start.toDateString()
  const when = planned.end ? `${fmt(planned.start, true)} → ${fmt(planned.end, !sameDay)}` : fmt(planned.start, true)
  return (
    <div className="animate-fade mt-2 flex max-w-[440px] items-start gap-3 rounded-lg border-l-[3px] border-amber-400/70 bg-gray-900/70 px-4 py-2.5 text-left text-[13px] text-gray-200 backdrop-blur-sm">
      <CalendarClock size={16} className="mt-0.5 flex-none text-amber-400" />
      <span>
        <b className="text-white">{t('home.maintenancePlanned', { when })}</b>
        <span className="block text-gray-300">{localize(planned.message, i18n.language)}</span>
      </span>
    </div>
  )
}
