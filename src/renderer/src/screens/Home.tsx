import { useTranslation } from 'react-i18next'
import { useEffect, useState } from 'react'
import { BookOpen, Clock, Globe, Map, TriangleAlert, Upload, WifiOff, X, HardDrive, MemoryStick, Sparkles, ArrowRight } from 'lucide-react'
import type { LinkKey } from '@shared/ipc'
import { nextRestart } from '@shared/restart'
import DiscordIcon from '../components/DiscordIcon'
import ServerPanel from '../components/ServerPanel'
import PlaytimeCard from '../components/PlaytimeCard'
import NewsPeek from '../components/NewsPeek'
import PlayZone, { useGameState } from '../components/PlayZone'
import type { ReportCategory } from '@shared/report'
import { useClient } from './Mods'
import { useFeed, useNow, usePlaytime, useServerStatus, useLiveRestart, useRoomAboveFooter } from '../hooks'
import type { PreflightWarning } from '@shared/settings'
import type { AppInfo } from '@shared/ipc'
import { byVersion, displayVersion, LAUNCHER_CHANGELOG, launcherHistory } from '@shared/launcherChangelog'
import { dayLabel, relativeDay } from '../components/LauncherUpdates'
import type { Feed } from '@shared/feed'
import { localize } from '@shared/manifest'
import { useAccounts } from '../accounts'
import type { SessionRecap } from '@shared/game'

const LINK_BUTTONS: { key: LinkKey; icon: React.ReactNode }[] = [
  { key: 'website', icon: <Globe size={18} /> },
  { key: 'map', icon: <Map size={18} /> },
  { key: 'rules', icon: <BookOpen size={18} /> },
]

export default function Home({
  onOpenNews,
  onOpenLauncherNews,
  onOpenScreenshots,
  onRepair,
  onImport,
  onOpenMods,
  onReport,
}: {
  onOpenNews(): void
  /** News > Launcher: the launcher's whole history */
  onOpenLauncherNews(): void
  onOpenScreenshots(): void
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
  const left = useRoomAboveFooter<HTMLDivElement>()

  return (
    <div className="home-pad relative flex h-full flex-col items-center px-7">
      {/* left column: one card under the other (never on top of each other), down to the footer */}
      <div ref={left.ref} style={{ maxHeight: left.max }} className="absolute top-11 left-6 flex w-[210px] flex-col gap-3 [&>*]:flex-none">
        <PlaytimeCard />
        <ImportPrompt onImport={onImport} />
        <WhatsNew onSeeMore={onOpenLauncherNews} />
      </div>
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
            {!crashed && <SessionRecapLine onOpenScreenshots={onOpenScreenshots} />}
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

/** Closed this run only: both cards come back the next time the launcher starts. */
let whatsNewClosed = false
let importClosed = false

/**
 * "What's new": the launcher's last 2 days of changes, at every start until closed (the whole history, by area, is in
 * News > Launcher updates). Grows down to the footer; only its list scrolls.
 */
function WhatsNew({ onSeeMore }: { onSeeMore(): void }) {
  const { t, i18n } = useTranslation()
  const [app, setApp] = useState<AppInfo | null>(null)
  const [closed, setClosed] = useState(whatsNewClosed)
  useEffect(() => {
    window.hemisphere.appInfo().then(setApp)
  }, [])
  if (!app || closed) return null
  const fr = i18n.language.startsWith('fr')
  const days = launcherHistory(LAUNCHER_CHANGELOG, app.version, null, !app.packaged).slice(0, 2)
  if (days.length === 0) return null
  const close = () => {
    whatsNewClosed = true
    setClosed(true)
  }
  const Section = ({ sub, lines }: { sub: string; lines: string[] }) => (
    <>
      <p className="mt-1.5 text-[10.5px] font-bold tracking-[0.08em] text-green-400 uppercase first:mt-0">{sub}</p>
      <ul className="mt-1 mb-2 space-y-1 text-xs text-gray-300 last:mb-0">
        {lines.map((line, i) => (
          <li key={i} className="flex gap-1.5">
            <span className="text-green-400">•</span>
            {line}
          </li>
        ))}
      </ul>
    </>
  )
  return (
    <aside className="glass animate-rise flex min-h-0 shrink! flex-col px-4 py-3.5 [animation-delay:450ms]">
      {/* title and close button above the scrolling list (its scrollbar never sits under the button) */}
      <div className="mb-1.5 flex items-start gap-1.5">
        <Sparkles size={14} className="mt-0.5 flex-none text-green-400" />
        <p className="min-w-0 flex-1 text-[13px] font-semibold text-white">{t('whatsNew.launcherTitle', { version: displayVersion(byVersion(days[0])[0].version) })}</p>
        <button onClick={close} aria-label={t('whatsNew.close')} className="-mt-0.5 -mr-1.5 flex-none rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-white">
          <X size={14} />
        </button>
      </div>
      <div className="min-h-[60px] flex-1 overflow-y-auto pr-1 [scrollbar-color:var(--color-gray-600)_transparent] [scrollbar-width:thin]">
        {days.flatMap((d) =>
          byVersion(d).map((v) => (
            <Section
              key={v.version}
              sub={`${relativeDay(d.date) ? t(`launcherNews.${relativeDay(d.date)}`) : dayLabel(d.date, i18n.language, 'short')} · ${displayVersion(v.version)}`}
              lines={v.changes.map((c) => (fr ? c.fr : c.en))}
            />
          )),
        )}
      </div>
      {(
        <button onClick={onSeeMore} className="mt-2 flex w-full flex-none items-center justify-center gap-1.5 rounded-md bg-gray-700/70 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-gray-600">
          {t('whatsNew.seeMore')} <ArrowRight size={13} />
        </button>
      )}
    </aside>
  )
}

/** "Session over: 1 h 23 min · 4 screenshots": a small recap after the game closed, until closed (or 2 hours). */
function SessionRecapLine({ onOpenScreenshots }: { onOpenScreenshots(): void }) {
  const { t } = useTranslation()
  const [recap, setRecap] = useState<SessionRecap | null>(null)
  const game = useGameState()
  useEffect(() => {
    window.hemisphere.game.recap().then(setRecap)
  }, [game])
  if (!recap) return null
  const minutes = Math.round(recap.durationMs / 60_000)
  const time = minutes >= 60 ? t('recap.hours', { h: Math.floor(minutes / 60), m: String(minutes % 60).padStart(2, '0') }) : t('recap.minutes', { count: minutes })
  return (
    <Line icon={<Clock size={14} className="text-green-400" />} className="text-gray-300">
      {t('recap.played', { time })}
      {recap.screenshots > 0 && (
        <>
          {' · '}
          <button onClick={onOpenScreenshots} className="font-semibold text-green-400 hover:underline">
            {t('recap.screenshots', { count: recap.screenshots })}
          </button>
        </>
      )}
      <button
        onClick={() => {
          window.hemisphere.game.dismissRecap()
          setRecap(null)
        }}
        aria-label={t('recap.close')}
        className="ml-1 rounded p-0.5 text-gray-500 hover:bg-gray-700 hover:text-white"
      >
        <X size={12} />
      </button>
    </Line>
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

/** For new players coming from another launcher: at every start until closed, gone for good after the first game. */
function ImportPrompt({ onImport }: { onImport(): void }) {
  const { t } = useTranslation()
  const playtime = usePlaytime()
  const [dismissed, setDismissed] = useState(importClosed)
  if (dismissed || !playtime || playtime.sessions > 0) return null
  const dismiss = () => {
    importClosed = true
    setDismissed(true)
  }
  return (
    <aside className="glass animate-rise relative px-4 py-3.5 [animation-delay:400ms]">
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
  const live = useLiveRestart()
  if (!feed?.restart || feed.maintenance.active) return offline ? <Line icon={<WifiOff size={14} />} className="text-red-400">{t('home.serverOffline')}</Line> : null
  const restart = nextRestart(now, feed.restart)

  if (live?.phase === 'restarting')
    return <Line icon={<Clock size={14} />} className="text-red-400">{t('home.restartingNow')}</Line>
  if (live?.phase === 'back') return <Line icon={<Clock size={14} />} className="text-green-400">{t('server.backOnline')}</Line>
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
