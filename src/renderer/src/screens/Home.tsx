import { useTranslation } from 'react-i18next'
import { BookOpen, Clock, Globe, Map, TriangleAlert, WifiOff } from 'lucide-react'
import type { LinkKey } from '@shared/ipc'
import { RESTART_SCHEDULE } from '@shared/server'
import { restartState } from '@shared/restart'
import DiscordIcon from '../components/DiscordIcon'
import ServerPanel from '../components/ServerPanel'
import PlaytimeCard from '../components/PlaytimeCard'
import NewsPeek from '../components/NewsPeek'
import PlayZone, { useGameState } from '../components/PlayZone'
import { useClient } from './Mods'
import { useNow, useServerStatus } from '../hooks'
import { useAccounts } from '../accounts'

const LINK_BUTTONS: { key: LinkKey; icon: React.ReactNode }[] = [
  { key: 'website', icon: <Globe size={18} /> },
  { key: 'map', icon: <Map size={18} /> },
  { key: 'rules', icon: <BookOpen size={18} /> },
]

export default function Home({ onOpenNews, onRepair }: { onOpenNews(): void; onRepair(): void }) {
  const { t } = useTranslation()
  const status = useServerStatus()
  const { active } = useAccounts()
  const game = useGameState()
  // Reload client info whenever a launch/repair finishes (an update may have just been installed).
  const client = useClient(game?.phase === 'preparing' ? 'busy' : game?.phase)

  return (
    <div className="relative flex h-full flex-col items-center px-7 pb-6">
      <PlaytimeCard key={active?.id} />
      <ServerPanel status={status} />

      <section className="flex flex-1 flex-col items-center justify-center text-center">
        {active?.status === 'expired' && <ExpiredBanner />}
        <h1 className="animate-rise text-[44px] leading-[1.05] font-bold text-white uppercase drop-shadow-lg [animation-delay:100ms]">
          {active ? t('home.welcomeBack') : t('home.welcomeTo')}
          <br />
          <span className="text-green-400">{active ? active.name : t('app.name')}</span>
        </h1>

        <div className="animate-rise mt-8 flex flex-col items-center [animation-delay:250ms]">
          <PlayZone client={client ?? null} onRepair={onRepair} />
          <div className="mt-1 flex min-h-6 flex-col items-center gap-1 text-[13px] text-gray-400">
            <ServerNotice offline={status?.online === false} />
          </div>
        </div>
      </section>

      <footer className="animate-rise flex w-full items-end justify-between gap-4 [animation-delay:400ms]">
        <div className="flex gap-2">
          <button
            onClick={() => window.hemisphere.openLink('discord')}
            className="flex items-center gap-2 rounded-lg bg-discord px-4 py-[9px] text-sm font-semibold text-white shadow-md transition-all duration-300 hover:scale-[1.04] hover:bg-discord-hover"
          >
            <DiscordIcon />
            {t('links.discord')}
          </button>
          {LINK_BUTTONS.map(({ key, icon }) => (
            <button
              key={key}
              onClick={() => window.hemisphere.openLink(key)}
              className="flex items-center gap-2 rounded-lg bg-gray-800/75 px-4 py-[9px] text-sm font-semibold text-gray-300 backdrop-blur-md transition-all duration-300 hover:-translate-y-0.5 hover:bg-gray-700 hover:text-white"
            >
              {icon}
              {t(`links.${key}`)}
            </button>
          ))}
        </div>
        <NewsPeek onOpen={onOpenNews} />
      </footer>
    </div>
  )
}

/** The Microsoft session of the active account can no longer be renewed. */
function ExpiredBanner() {
  const { t, i18n } = useTranslation()
  return (
    <div className="animate-fade mb-5 flex items-center gap-3 rounded-lg border-l-[3px] border-amber-400 bg-amber-900/55 px-4 py-2.5 text-[13px] text-amber-100 backdrop-blur-sm">
      <TriangleAlert size={16} className="text-amber-400" />
      {t('auth.expiredBanner')}
      <button
        onClick={() => window.hemisphere.auth.signIn(i18n.language)}
        className="rounded-md bg-amber-400 px-3 py-1 text-xs font-bold text-gray-900 hover:bg-amber-300"
      >
        {t('auth.signInAgain')}
      </button>
    </div>
  )
}

/** Restart / offline hint shown under the PLAY button. */
function ServerNotice({ offline }: { offline: boolean }) {
  const { t } = useTranslation()
  const restart = restartState(useNow(), RESTART_SCHEDULE)

  if (restart.phase === 'restarting')
    return <Line icon={<Clock size={14} />} className="text-red-400">{t('home.restartingNow')}</Line>
  if (offline) return <Line icon={<WifiOff size={14} />} className="text-red-400">{t('home.serverOffline')}</Line>
  if (restart.phase === 'soon') {
    const s = Math.floor(restart.msLeft / 1000)
    const time = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
    return <Line icon={<Clock size={14} />} className="text-amber-400 tabular-nums">{t('server.restartIn', { time })}</Line>
  }
  return null
}

function Line({ icon, className = '', children }: { icon: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <p className={`flex items-center gap-1.5 ${className}`}>
      {icon}
      {children}
    </p>
  )
}
