import { useTranslation } from 'react-i18next'
import { useEffect, useState } from 'react'
import { BookOpen, Clock, Globe, Map, TriangleAlert, Upload, WifiOff, X, HardDrive, MemoryStick, Sparkles } from 'lucide-react'
import type { LinkKey } from '@shared/ipc'
import { restartState } from '@shared/restart'
import DiscordIcon from '../components/DiscordIcon'
import ServerPanel from '../components/ServerPanel'
import PlaytimeCard from '../components/PlaytimeCard'
import NewsPeek from '../components/NewsPeek'
import PlayZone, { useGameState } from '../components/PlayZone'
import type { ReportCategory } from '@shared/report'
import { useClient } from './Mods'
import { useFeed, useNow, usePlaytime, useServerStatus, useSettings } from '../hooks'
import type { ClientSummary } from '@shared/client'
import type { PreflightWarning } from '@shared/settings'
import type { Feed } from '@shared/feed'
import { localize } from '@shared/manifest'
import { useAccounts } from '../accounts'

const LINK_BUTTONS: { key: LinkKey; icon: React.ReactNode }[] = [
  { key: 'website', icon: <Globe size={18} /> },
  { key: 'map', icon: <Map size={18} /> },
  { key: 'rules', icon: <BookOpen size={18} /> },
]

export default function Home({
  onOpenNews,
  onRepair,
  onImport,
  onOpenMods,
  onReport,
}: {
  onOpenNews(): void
  onRepair(): void
  onImport(): void
  onOpenMods(): void
  onReport(category: ReportCategory | null): void
}) {
  const { t } = useTranslation()
  const status = useServerStatus()
  const feed = useFeed()
  const { active } = useAccounts()
  const game = useGameState()
  // Reload client info whenever a launch/repair finishes (an update may have just been installed).
  const client = useClient(game?.phase === 'preparing' ? 'busy' : `${game?.phase}-${game?.background}`)
  const crashed = game?.error?.code === 'crashed'

  return (
    <div className="home-pad relative flex h-full flex-col items-center px-7">
      <PlaytimeCard key={active?.id} />
      <ImportPrompt onImport={onImport} />
      <WhatsNew client={client ?? null} />
      <ServerPanel status={status} feed={feed} onOpenNews={onOpenNews} />

      <section className="flex min-h-0 flex-1 flex-col items-center justify-center-safe text-center">
        {active?.status === 'expired' && <ExpiredBanner />}
        {/* one compact line while the crash card needs the room */}
        <h1
          className={`${crashed ? 'home-title-compact' : 'home-title'} animate-rise leading-[1.05] font-bold text-white uppercase drop-shadow-lg [animation-delay:100ms]`}
        >
          {active ? t('home.welcomeBack') : t('home.welcomeTo')}
          {crashed ? ' ' : <br />}
          <span className="text-green-400">{active ? active.name : t('app.name')}</span>
        </h1>

        <div className={`animate-rise flex flex-col items-center [animation-delay:250ms] ${crashed ? 'mt-2' : 'home-gap'}`}>
          <PlayZone client={client ?? null} onRepair={onRepair} onOpenMods={onOpenMods} onReport={onReport} />
          <div className={`mt-1 flex min-h-6 flex-col items-center gap-1 text-[13px] text-gray-400 ${crashed ? 'empty:hidden' : ''}`}>
            <ServerNotice offline={status?.online === false} feed={feed} />
            {!crashed && <PreflightHints />}
            {feed?.maintenance.active && <MaintenanceBanner feed={feed} />}
          </div>
        </div>
      </section>

      <footer className="animate-rise relative z-10 flex w-full flex-none items-end justify-between gap-4 pt-4 [animation-delay:400ms]">
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
        <NewsPeek feed={feed} onOpen={onOpenNews} />
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

/** "What's new in Hemisphere Client x": once after a client update, until closed. */
function WhatsNew({ client }: { client: ClientSummary | null }) {
  const { t, i18n } = useTranslation()
  const [settings, update] = useSettings()
  const installed = client?.installedVersion ?? null
  useEffect(() => {
    // First run with this feature (or a brand-new player): remember the current version without showing anything.
    if (settings && installed && settings.seenChangelog === null) void update({ seenChangelog: installed })
  }, [settings, installed])
  if (!client || !settings || !installed || installed !== client.clientVersion) return null
  if (settings.seenChangelog === null || settings.seenChangelog === installed || client.changelog.length === 0) return null
  return (
    <aside className="glass animate-rise absolute top-[232px] left-6 w-[210px] px-4 py-3.5 [animation-delay:450ms]">
      <button
        onClick={() => void update({ seenChangelog: installed })}
        aria-label={t('whatsNew.close')}
        className="absolute top-2 right-2 rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-white"
      >
        <X size={14} />
      </button>
      <p className="flex items-center gap-1.5 pr-4 text-[13px] font-semibold text-white">
        <Sparkles size={14} className="text-green-400" /> {t('whatsNew.title', { version: installed })}
      </p>
      <ul className="mt-1.5 max-h-[150px] space-y-1 overflow-y-auto pr-1 text-xs text-gray-300">
        {client.changelog.map((line, i) => (
          <li key={i} className="flex gap-1.5">
            <span className="text-green-400">•</span>
            {localize(line, i18n.language)}
          </li>
        ))}
      </ul>
    </aside>
  )
}

/** Low disk space / little RAM: worth knowing before PLAY, never blocking. */
function PreflightHints() {
  const { t } = useTranslation()
  const [hints, setHints] = useState<PreflightWarning[]>([])
  useEffect(() => {
    window.hemisphere.system.preflight().then(setHints)
  }, [])
  return (
    <>
      {hints.map((h) => (
        <Line key={h.code} icon={h.code === 'lowDisk' ? <HardDrive size={14} /> : <MemoryStick size={14} />} className="text-amber-400">
          {t(`preflight.${h.code}`, { value: h.value })}
        </Line>
      ))}
    </>
  )
}

/** One-time card for new players coming from another launcher (dismissible; hidden after the first game). */
function ImportPrompt({ onImport }: { onImport(): void }) {
  const { t } = useTranslation()
  const playtime = usePlaytime()
  const [dismissed, setDismissed] = useState(true)
  useEffect(() => {
    window.hemisphere.settings.get().then((s) => setDismissed(s.importPromptDismissed))
  }, [])
  if (dismissed || !playtime || playtime.sessions > 0) return null
  const dismiss = () => {
    setDismissed(true)
    void window.hemisphere.settings.set({ importPromptDismissed: true })
  }
  return (
    <aside className="glass animate-rise absolute top-[232px] left-6 w-[210px] px-4 py-3.5 [animation-delay:450ms]">
      <button onClick={dismiss} aria-label={t('import.dismiss')} className="absolute top-2 right-2 rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-white">
        <X size={14} />
      </button>
      <p className="pr-4 text-[13px] font-semibold text-white">{t('import.promptTitle')}</p>
      <p className="mt-1 text-xs text-gray-400">{t('import.promptBody')}</p>
      <button onClick={onImport} className="mt-2.5 flex items-center gap-1.5 text-xs font-semibold text-green-400 hover:text-green-300">
        <Upload size={13} /> {t('import.settingsButton')}
      </button>
    </aside>
  )
}

/** Staff maintenance message (from the signed feed), with the end time in the player's own time zone. */
function MaintenanceBanner({ feed }: { feed: Feed }) {
  const { t, i18n } = useTranslation()
  const until = feed.maintenance.until ? new Date(feed.maintenance.until) : null
  return (
    <div className="animate-fade mt-2 flex max-w-[400px] items-center gap-3 rounded-lg border-l-[3px] border-amber-400 bg-amber-900/55 px-4 py-2.5 text-left text-[13px] text-amber-100 backdrop-blur-sm">
      <TriangleAlert size={16} className="flex-none text-amber-400" />
      <span>
        <b className="text-white">{t('server.maintenance')}</b> · {localize(feed.maintenance.message, i18n.language)}
        {until && until.getTime() > Date.now() && (
          <> {t('home.maintenanceUntil', { time: until.toLocaleString(i18n.language, { weekday: 'short', hour: '2-digit', minute: '2-digit' }) })}</>
        )}
      </span>
    </div>
  )
}

/** Restart / offline hint shown under the PLAY button. */
function ServerNotice({ offline, feed }: { offline: boolean; feed: Feed | null }) {
  const { t } = useTranslation()
  const now = useNow()
  if (!feed?.restart || feed.maintenance.active) return offline ? <Line icon={<WifiOff size={14} />} className="text-red-400">{t('home.serverOffline')}</Line> : null
  const restart = restartState(now, feed.restart)

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
