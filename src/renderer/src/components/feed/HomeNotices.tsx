import { useTranslation } from 'react-i18next'
import { Info, Megaphone, OctagonAlert } from 'lucide-react'
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
