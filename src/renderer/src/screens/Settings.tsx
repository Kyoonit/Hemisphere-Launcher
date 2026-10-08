import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bell, Check, ClipboardCopy, Coffee, FolderInput, FolderOpen, FlaskConical, Flag, Gamepad2, History, KeyRound, Plus, RefreshCw, Rocket, RotateCcw, TriangleAlert, Upload, User, Wrench, type LucideIcon, BellOff } from 'lucide-react'
import { useLauncherUpdate } from '../launcherUpdate'
import { useFeed, useSettings } from '../hooks'
import type { JavaRuntimeInfo } from '@shared/game'
import { RESOLUTIONS, parseJvmArgs, type Settings, type SystemInfo } from '@shared/settings'
import { LANGUAGES, systemLanguage } from '../i18n'
import { headUrl, useAccounts } from '../accounts'
import Toggle from '../components/Toggle'
import Backups from './Backups'
import Developer from './Developer'
import type { DevAccess } from '@shared/dev'
import type { LowEndInfo } from '@shared/performance'

export type Section = 'game' | 'launcher' | 'account' | 'installation' | 'backups' | 'advanced' | 'developer'

const SECTIONS: { id: Section; icon: LucideIcon }[] = [
  { id: 'game', icon: Gamepad2 },
  { id: 'launcher', icon: Rocket },
  { id: 'account', icon: User },
  { id: 'installation', icon: FolderOpen },
  { id: 'backups', icon: History },
  { id: 'advanced', icon: Wrench },
  // only in development builds, or once the staff code was entered on this PC
  { id: 'developer', icon: FlaskConical },
]

const selectClass = 'rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-white'
const buttonClass = 'flex items-center gap-2 rounded-lg bg-gray-700/85 px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-gray-600 disabled:opacity-50'
const gb = (mb: number) => `${(mb / 1024).toFixed(mb % 1024 ? 1 : 0)} GB`

export default function Settings({
  initialSection,
  onAddAccount,
  onRepair,
  onImport,
  onReport,
}: {
  initialSection: Section
  onAddAccount(): void
  onRepair(): void
  onImport(): void
  onReport(): void
}) {
  const { t } = useTranslation()
  const [section, setSection] = useState<Section>(initialSection)
  const [dev, setDev] = useState<DevAccess | null>(null)
  const loadDev = () => void window.hemisphere.dev.get().then(setDev)
  useEffect(loadDev, [])
  const devVisible = !!dev && (dev.devBuild || dev.unlocked)

  return (
    <div className="grid h-full grid-cols-[200px_1fr]">
      <nav className="flex flex-col gap-0.5 border-r border-white/5 bg-gray-900/50 px-3 py-6">
        {SECTIONS.filter((s) => s.id !== 'developer' || devVisible).map(({ id, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setSection(id)}
            className={`flex items-center gap-2.5 rounded-lg px-3 py-[9px] text-left text-sm font-medium transition-colors duration-150 ${
              section === id ? 'bg-gray-700 text-white shadow-[inset_3px_0_0_var(--color-green-500)]' : 'text-gray-300 hover:bg-gray-700 hover:text-white'
            }`}
          >
            <Icon size={17} />
            {t(`settings.sections.${id}`)}
          </button>
        ))}
      </nav>

      <section key={section} className="animate-fade overflow-auto px-8 py-6">
        <h2 className="text-[26px] font-bold text-white">{t(`settings.sections.${section}`)}</h2>
        {section === 'game' && <GameSettings />}
        {section === 'launcher' && <LauncherSettings />}
        {section === 'account' && <AccountSettings onAddAccount={onAddAccount} />}
        {section === 'installation' && <InstallationSettings onRepair={onRepair} onImport={onImport} onReport={onReport} />}
        {section === 'backups' && <Backups />}
        {section === 'advanced' && <AdvancedSettings dev={dev} onDevChanged={loadDev} onOpenDev={() => setSection('developer')} />}
        {section === 'developer' && dev && devVisible && (
          <Developer
            access={dev}
            onLocked={() => {
              loadDev()
              setSection('advanced')
            }}
          />
        )}
      </section>
    </div>
  )
}


function useSystemInfo(): [SystemInfo | null, () => void] {
  const [info, setInfo] = useState<SystemInfo | null>(null)
  const load = () => void window.hemisphere.system.info().then(setInfo)
  useEffect(load, [])
  return [info, load]
}

// ---------------------------------------------------------------- Game
function GameSettings() {
  const { t } = useTranslation()
  const [settings, update] = useSettings()
  const [info] = useSystemInfo()
  const [draft, setDraft] = useState<number | null>(null)
  if (!settings || !info) return null

  const auto = settings.memoryMb === null
  const value = draft ?? settings.memoryMb ?? info.recommendedMemoryMb
  const tooHigh = value > info.totalMemoryMb * 0.75

  return (
    <div className="mt-2">
      <Row title={t('settings.memory')} hint={t('settings.memoryHint', { recommended: gb(info.recommendedMemoryMb), total: gb(info.totalMemoryMb) })}>
        <div className="flex w-[340px] flex-col items-end gap-1.5">
          <div className="flex w-full items-center gap-3">
            <input
              type="range"
              min={2048}
              max={info.maxMemoryMb}
              step={512}
              value={value}
              onChange={(e) => setDraft(Number(e.target.value))}
              onPointerUp={() => draft !== null && update({ memoryMb: draft === info.recommendedMemoryMb ? null : draft }).then(() => setDraft(null))}
              onKeyUp={() => draft !== null && update({ memoryMb: draft }).then(() => setDraft(null))}
              className="w-full accent-green-500"
              aria-label={t('settings.memory')}
            />
            <output className="w-[84px] flex-none text-right font-bold whitespace-nowrap text-white tabular-nums">{gb(value)}</output>
          </div>
          {auto ? (
            <span className="text-xs text-green-400">{t('settings.memoryAuto')}</span>
          ) : (
            <button onClick={() => update({ memoryMb: null })} className="flex items-center gap-1 text-xs text-gray-400 hover:text-white">
              <RotateCcw size={12} /> {t('settings.memoryUseRecommended')}
            </button>
          )}
          {tooHigh && <span className="text-xs text-amber-400">{t('settings.memoryTooHigh')}</span>}
        </div>
      </Row>
      <Row title={t('settings.resolution')} hint={t('settings.resolutionHint')}>
        <select value={settings.resolution} onChange={(e) => update({ resolution: e.target.value as Settings['resolution'] })} className={selectClass}>
          {RESOLUTIONS.map((r) => (
            <option key={r} value={r}>
              {r === 'auto' ? t('settings.resolutionAuto') : r === 'fullscreen' ? t('settings.resolutionFullscreen') : r.replace('x', ' × ')}
            </option>
          ))}
        </select>
      </Row>
      <Row title={t('settings.autoJoin')} hint={t('settings.autoJoinHint')}>
        <Toggle on={settings.autoJoin} onChange={(autoJoin) => update({ autoJoin })} label={t('settings.autoJoin')} />
      </Row>
      {info.hybridGpu && (
        <Row title={t('settings.highPerformanceGpu')} hint={t('settings.highPerformanceGpuHint', { gpus: info.gpuNames.join(' + ') })}>
          <Toggle on={settings.highPerformanceGpu} onChange={(highPerformanceGpu) => update({ highPerformanceGpu })} label={t('settings.highPerformanceGpu')} />
        </Row>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- Launcher
/** Windows turned notifications off: the alerts below can't show until the player turns them back on. */
function NotificationsBlocked() {
  const { t } = useTranslation()
  const [blocked, setBlocked] = useState(false)
  useEffect(() => {
    const check = () => void window.hemisphere.system.notificationsBlocked().then(setBlocked)
    check()
    window.addEventListener('focus', check) // back from Windows Settings
    return () => window.removeEventListener('focus', check)
  }, [])
  if (!blocked) return null
  return (
    <div className="my-2 flex items-start gap-2.5 rounded-lg border-l-[3px] border-amber-400 bg-amber-900/45 px-3.5 py-2.5 text-[13px] text-amber-100">
      <BellOff size={16} className="mt-0.5 flex-none text-amber-400" />
      <span className="min-w-0 flex-1">{t('community.notificationsOff')}</span>
      <button onClick={() => window.hemisphere.system.openNotificationSettings()} className="flex-none rounded-md bg-amber-400 px-2.5 py-1 text-xs font-bold text-gray-900 hover:bg-amber-300">
        {t('community.notificationsOffOpen')}
      </button>
    </div>
  )
}

/** Download speed limit, and no background downloads on a metered connection (says when it's metered now). */
function NetworkRows({ settings, update }: { settings: Settings; update(patch: Partial<Settings>): Promise<string | null> }) {
  const { t } = useTranslation()
  const [metered, setMetered] = useState(false)
  useEffect(() => {
    window.hemisphere.system.metered().then(setMetered)
  }, [])
  return (
    <>
      <Row title={t('settings.downloadLimit')} hint={t('settings.downloadLimitHint')}>
        <select value={settings.downloadLimit} onChange={(e) => update({ downloadLimit: Number(e.target.value) as Settings['downloadLimit'] })} className={selectClass}>
          {([0, 10, 5, 2] as const).map((v) => (
            <option key={v} value={v}>
              {v === 0 ? t('settings.downloadLimitNone') : t('settings.downloadLimitValue', { value: v })}
            </option>
          ))}
        </select>
      </Row>
      <Row title={t('settings.saveDataOnMetered')} hint={metered ? t('settings.saveDataOnMeteredNow') : t('settings.saveDataOnMeteredHint')}>
        <Toggle on={settings.saveDataOnMetered} onChange={(saveDataOnMetered) => update({ saveDataOnMetered })} label={t('settings.saveDataOnMetered')} />
      </Row>
    </>
  )
}

/** Light interface: auto says whether this PC gets it. */
function LightModeRow({ lightMode, onChange }: { lightMode: Settings['lightMode']; onChange(v: Settings['lightMode']): void }) {
  const { t } = useTranslation()
  const [pc, setPc] = useState<LowEndInfo | null>(null)
  useEffect(() => {
    window.hemisphere.system.lowEnd().then(setPc)
  }, [])
  return (
    <Row title={t('settings.lightMode')} hint={t('settings.lightModeHint')}>
      <select value={lightMode} onChange={(e) => onChange(e.target.value as Settings['lightMode'])} className={selectClass}>
        <option value="auto">{pc ? t(pc.lowEnd ? 'settings.lightModeOptions.autoOn' : 'settings.lightModeOptions.autoOff', { ram: Math.round(pc.ramGb) }) : t('settings.lightModeOptions.auto')}</option>
        <option value="on">{t('settings.lightModeOptions.on')}</option>
        <option value="off">{t('settings.lightModeOptions.off')}</option>
      </select>
    </Row>
  )
}

function LauncherSettings() {
  const { t, i18n } = useTranslation()
  const [settings, update] = useSettings()
  const [info] = useSystemInfo()
  const feed = useFeed()
  const [version, setVersion] = useState('')
  useEffect(() => {
    window.hemisphere.appInfo().then((a) => setVersion(a.version))
  }, [])
  if (!settings || !info) return null

  const changeLanguage = (language: string) => {
    void update({ language })
    i18n.changeLanguage(language === 'auto' ? systemLanguage() : language)
  }

  return (
    <div className="mt-2">
      <Row title={t('settings.onGameStart')} hint={t('settings.onGameStartHint')}>
        <select value={settings.onGameStart} onChange={(e) => update({ onGameStart: e.target.value as Settings['onGameStart'] })} className={selectClass}>
          <option value="hide">{t('settings.onGameStartOptions.hide')}</option>
          <option value="keep">{t('settings.onGameStartOptions.keep')}</option>
          <option value="close">{t('settings.onGameStartOptions.close')}</option>
        </select>
      </Row>
      <LightModeRow lightMode={settings.lightMode} onChange={(lightMode) => update({ lightMode })} />
      <Row title={t('settings.language')} hint={t('settings.languageHint')}>
        <select value={settings.language} onChange={(e) => changeLanguage(e.target.value)} className={selectClass}>
          <option value="auto">{t('settings.languageAuto')}</option>
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
            </option>
          ))}
        </select>
      </Row>
      <Row title={t('settings.startWithWindows')} hint={info.packaged ? t('settings.startWithWindowsHint') : t('settings.startWithWindowsDev')}>
        <Toggle on={settings.startWithWindows} onChange={(startWithWindows) => update({ startWithWindows })} label={t('settings.startWithWindows')} />
      </Row>
      <Row title={t('settings.backgroundUpdates')} hint={t('settings.backgroundUpdatesHint')}>
        <Toggle on={settings.backgroundUpdates} onChange={(backgroundUpdates) => update({ backgroundUpdates })} label={t('settings.backgroundUpdates')} />
      </Row>
      <NetworkRows settings={settings} update={update} />
      <h3 className="mt-6 mb-1 text-xs font-bold tracking-[0.08em] text-gray-400 uppercase">{t('community.title')}</h3>
      <NotificationsBlocked />
      <Row title={t('community.tray')} hint={t('community.trayHint')}>
        <Toggle on={settings.closeToTray} onChange={(closeToTray) => update({ closeToTray })} label={t('community.tray')} />
      </Row>
      <Row title={t('community.restartAlerts')} hint={t('community.restartAlertsHint')}>
        <div className="flex flex-wrap justify-end gap-1.5">
          {(['before15', 'before1', 'start', 'back'] as const).map((k) => {
            const on = settings.restartAlerts[k]
            return (
              <button
                key={k}
                onClick={() => update({ restartAlerts: { ...settings.restartAlerts, [k]: !on } })}
                aria-pressed={on}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] font-semibold transition-colors ${on ? 'bg-green-600 text-white' : 'bg-gray-800/80 text-gray-300 hover:bg-gray-700 hover:text-white'}`}
              >
                {on ? <Check size={13} /> : <Bell size={13} />} {t(`community.restartAlert.${k}`)}
              </button>
            )
          })}
        </div>
      </Row>
      <Row title={t('community.serverBack')} hint={t('community.serverBackHint')}>
        <Toggle on={settings.notifyServerBack} onChange={(notifyServerBack) => update({ notifyServerBack })} label={t('community.serverBack')} />
      </Row>
      <Row title={t('community.discord')} hint={feed?.discordAppId ? t('community.discordHint') : t('community.discordNotReady')}>
        <Toggle on={settings.discordStatus} disabled={!feed?.discordAppId} onChange={(discordStatus) => update({ discordStatus })} label={t('community.discord')} />
      </Row>
      <LauncherVersionRow version={version} />
    </div>
  )
}

/** Launcher version, update status and a manual "Check for updates". */
function LauncherVersionRow({ version }: { version: string }) {
  const { t, i18n } = useTranslation()
  const update = useLauncherUpdate()
  const status = (() => {
    switch (update?.phase) {
      case 'disabled':
        return t('launcherUpdate.devBuild')
      case 'checking':
        return t('launcherUpdate.checking')
      case 'downloading':
        return t('launcherUpdate.downloading', { version: update.version, percent: Math.round(update.ratio * 100) })
      case 'ready':
        return t('launcherUpdate.ready', { version: update.version })
      case 'error':
        return t('launcherUpdate.error')
      case 'idle':
        return update.checkedAt
          ? t('launcherUpdate.upToDate', { time: new Date(update.checkedAt).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' }) })
          : ''
      default:
        return ''
    }
  })()
  return (
    <Row title={t('settings.version')} hint={[version, status].filter(Boolean).join(' · ')}>
      {update?.phase === 'ready' ? (
        <button onClick={() => window.hemisphere.launcherUpdate.install()} className="flex items-center gap-2 rounded-lg bg-gradient-to-b from-amber-400 to-orange-500 px-3.5 py-2 text-sm font-bold text-gray-950 shadow-md ring-1 ring-amber-300/70 hover:brightness-110">
          <RefreshCw size={15} /> {t('launcherUpdate.restart')}
        </button>
      ) : (
        <button
          onClick={() => window.hemisphere.launcherUpdate.check()}
          disabled={!update || update.phase === 'disabled' || update.phase === 'checking' || update.phase === 'downloading'}
          className={buttonClass}
        >
          <RefreshCw size={15} className={update?.phase === 'checking' ? 'animate-spin' : ''} /> {t('launcherUpdate.check')}
        </button>
      )}
    </Row>
  )
}

// ---------------------------------------------------------------- Account
function AccountSettings({ onAddAccount }: { onAddAccount(): void }) {
  const { t } = useTranslation()
  const { state } = useAccounts()
  if (!state) return null

  return (
    <div className="mt-1">
      <p className="text-[13px] text-gray-400">{t('auth.settingsHint')}</p>
      <div className="mt-3">
        {state.accounts.map((a) => {
          const isActive = a.id === state.activeId
          return (
            <div key={a.id} className="flex items-center gap-4 border-b border-white/5 py-3.5">
              <img src={headUrl(a.id, 80)} alt="" className="h-10 w-10 rounded-[5px] [image-rendering:pixelated]" />
              <div className="flex-1">
                <b className="flex items-center gap-2 font-semibold text-white">
                  {a.name}
                  {isActive && <span className="rounded-full bg-green-600/20 px-2 py-0.5 text-[11px] font-semibold text-green-400">{t('auth.active')}</span>}
                  {a.status === 'expired' && <span className="rounded-full bg-amber-600/20 px-2 py-0.5 text-[11px] font-semibold text-amber-400">{t('auth.expired')}</span>}
                </b>
                <span className="text-[12.5px] text-gray-400">{a.kind === 'offline' ? t('auth.dev.badge') : t('auth.microsoftAccount')}</span>
              </div>
              {!isActive && (
                <button onClick={() => window.hemisphere.auth.switchTo(a.id)} className={buttonClass}>
                  {t('auth.switch')}
                </button>
              )}
              <button onClick={() => window.hemisphere.auth.signOut(a.id)} className="rounded-lg px-4 py-2 text-sm font-semibold text-gray-300 transition-colors hover:bg-gray-700 hover:text-white">
                {t('auth.signOut')}
              </button>
            </div>
          )
        })}
      </div>
      <button onClick={onAddAccount} className={`mt-4 ${buttonClass}`}>
        <Plus size={16} /> {t('auth.addAccount')}
      </button>
    </div>
  )
}

// ---------------------------------------------------------------- Installation
function InstallationSettings({ onRepair, onImport, onReport }: { onRepair(): void; onImport(): void; onReport(): void }) {
  const { t } = useTranslation()
  const [info, reload] = useSystemInfo()
  const [moving, setMoving] = useState(false)
  const [moveRatio, setMoveRatio] = useState<number | null>(null)
  useEffect(() => window.hemisphere.system.onMoveProgress(setMoveRatio), [])
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  if (!info) return null

  const isDefault = info.gameDir.toLowerCase() === info.defaultGameDir.toLowerCase()
  const move = async (target: 'choose' | 'default') => {
    setMessage(null)
    setMoving(true)
    setMoveRatio(null)
    const res = await window.hemisphere.system.moveGameDir(target)
    setMoving(false)
    setMoveRatio(null)
    if (res.cancelled) return
    setMessage(res.ok ? { ok: true, text: t('settings.moved') } : { ok: false, text: t(`settings.moveErrors.${res.reason ?? 'failed'}`) })
    reload()
  }

  return (
    <div className="mt-2">
      <Row title={t('settings.gameDir')} hint={info.gameDir}>
        <div className="flex gap-2">
          <button onClick={() => window.hemisphere.system.openFolder('game')} className={buttonClass}>
            <FolderOpen size={16} /> {t('settings.open')}
          </button>
          <button onClick={() => move('choose')} disabled={moving} className={buttonClass}>
            <FolderInput size={16} /> {moving ? (moveRatio !== null ? `${t('settings.moving')} ${Math.round(moveRatio * 100)}%` : t('settings.moving')) : t('settings.change')}
          </button>
          {!isDefault && (
            <button onClick={() => move('default')} disabled={moving} className={buttonClass}>
              <RotateCcw size={16} /> {t('settings.resetDefault')}
            </button>
          )}
        </div>
      </Row>
      {moving && moveRatio !== null && (
        <div className="mt-1 mb-2 h-2 overflow-hidden rounded-full bg-gray-700/90" role="progressbar" aria-valuenow={Math.round(moveRatio * 100)} aria-valuemin={0} aria-valuemax={100}>
          <i className="block h-full rounded-full bg-gradient-to-r from-green-600 to-green-400 transition-[width] duration-300" style={{ width: `${moveRatio * 100}%` }} />
        </div>
      )}
      {message && <Notice ok={message.ok}>{message.text}</Notice>}
      <Row title={t('settings.folders')} hint={t('settings.foldersHint')}>
        <div className="flex gap-2">
          <button onClick={() => window.hemisphere.system.openFolder('mods')} className={buttonClass}>
            {t('settings.folderMods')}
          </button>
          <button onClick={() => window.hemisphere.system.openFolder('screenshots')} className={buttonClass}>
            {t('settings.folderScreenshots')}
          </button>
        </div>
      </Row>
      <Row title={t('import.settingsTitle')} hint={t('import.settingsHint')}>
        <button onClick={onImport} className={buttonClass}>
          <Upload size={16} /> {t('import.settingsButton')}
        </button>
      </Row>
      <Row title={t('repair.title')} hint={t('repair.settingsHint')}>
        <button onClick={onRepair} className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white shadow-md transition-colors hover:bg-green-500">
          <Wrench size={16} /> {t('repair.short')}
        </button>
      </Row>
      <Row title={t('report.title')} hint={t('report.settingsHint')}>
        <button onClick={onReport} className={buttonClass}>
          <Flag size={16} /> {t('report.open')}
        </button>
      </Row>
    </div>
  )
}

// ---------------------------------------------------------------- Advanced
function AdvancedSettings({ dev, onDevChanged, onOpenDev }: { dev: DevAccess | null; onDevChanged(): void; onOpenDev(): void }) {
  const { t } = useTranslation()
  const [settings, update] = useSettings()
  const [java, setJava] = useState<JavaRuntimeInfo[] | null>(null)
  const [javaMsg, setJavaMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [args, setArgs] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [info] = useSystemInfo()
  useEffect(() => {
    window.hemisphere.game.javaInfo().then(setJava)
  }, [])
  if (!settings) return null

  const argsText = args ?? settings.jvmArgs
  const invalidArgs = parseJvmArgs(argsText).invalid

  const pickJava = async () => {
    setJavaMsg(null)
    const res = await window.hemisphere.system.pickJava()
    if (res.cancelled) return
    setJavaMsg(res.ok ? { ok: true, text: t('settings.javaChosen', { version: res.version }) } : { ok: false, text: t('settings.javaInvalid') })
  }

  return (
    <div className="mt-2">
      <Row title="Java" hint={settings.javaPath ? t('settings.javaCustom', { path: settings.javaPath }) : t('settings.javaManaged')}>
        <div className="flex gap-2">
          <button onClick={pickJava} className={buttonClass}>
            <Coffee size={16} /> {t('settings.javaChoose')}
          </button>
          {settings.javaPath && (
            <button onClick={() => update({ javaPath: null })} className={buttonClass}>
              <RotateCcw size={16} /> {t('settings.javaUseManaged')}
            </button>
          )}
        </div>
      </Row>
      {javaMsg && <Notice ok={javaMsg.ok}>{javaMsg.text}</Notice>}

      <Row title={t('settings.jvmArgs')} hint={t('settings.jvmArgsHint')}>
        <div className="flex w-[340px] flex-col gap-1.5">
          <div className="flex gap-2">
            <input
              value={argsText}
              onChange={(e) => setArgs(e.target.value)}
              placeholder="-XX:+UseZGC"
              spellCheck={false}
              className="min-w-0 flex-1 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 font-mono text-sm text-white"
            />
            <button disabled={args === null || invalidArgs.length > 0} onClick={() => update({ jvmArgs: argsText.trim() }).then(() => setArgs(null))} className={buttonClass}>
              {t('settings.save')}
            </button>
          </div>
          {invalidArgs.length > 0 && (
            <span className="flex items-center gap-1 text-xs text-red-400">
              <TriangleAlert size={12} /> {t('settings.jvmArgsInvalid', { args: invalidArgs.join(' ') })}
            </span>
          )}
        </div>
      </Row>

      <Row title={t('settings.logs')} hint={t('settings.logsHint')}>
        <div className="flex gap-2">
          <button onClick={() => window.hemisphere.system.openFolder('gameLogs')} className={buttonClass}>
            {t('settings.gameLogs')}
          </button>
          <button onClick={() => window.hemisphere.system.openFolder('launcherLogs')} className={buttonClass}>
            {t('settings.launcherLogs')}
          </button>
          <button
            onClick={async () => {
              await window.hemisphere.system.copyDiagnostics()
              setCopied(true)
              setTimeout(() => setCopied(false), 2500)
            }}
            className={buttonClass}
          >
            {copied ? <Check size={16} className="text-green-400" /> : <ClipboardCopy size={16} />} {copied ? t('settings.copied') : t('settings.copyDiagnostics')}
          </button>
        </div>
      </Row>

      {!info?.packaged && (
        <Row title={t('settings.devTools')} hint={t('settings.devToolsHint')}>
          <button onClick={() => update({ seenNews: [] })} className={buttonClass}>
            {t('settings.markNewsUnread')}
          </button>
        </Row>
      )}

      <b className="mt-5 block font-semibold text-white">{t('settings.java.title')}</b>
      <p className="text-[12.5px] text-gray-400">{t('settings.java.hint')}</p>
      <div className="mt-3 overflow-hidden rounded-lg bg-gray-900/55">
        {java === null ? (
          <p className="px-4 py-3 text-sm text-gray-400">{t('settings.java.scanning')}</p>
        ) : java.length === 0 ? (
          <p className="px-4 py-3 text-sm text-gray-400">{t('settings.java.none')}</p>
        ) : (
          java.map((j) => (
            <div key={j.path} className="flex items-center gap-3 border-t border-white/5 px-4 py-3 first:border-t-0">
              <Coffee size={18} className={j.managed ? 'text-green-400' : 'text-gray-400'} />
              <div className="min-w-0 flex-1">
                <b className="font-semibold text-white">Java {j.majorVersion}</b>
                <span className="ml-2 text-xs text-gray-400">{j.version}</span>
                <p className="truncate text-xs text-gray-400" title={j.path}>
                  {j.path}
                </p>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${j.managed ? 'bg-green-600/20 text-green-400' : 'bg-gray-700 text-gray-300'}`}>
                {j.managed ? t('settings.java.managed') : t('settings.java.system')}
              </span>
            </div>
          ))
        )}
      </div>
      <StaffAccess dev={dev} onChanged={onDevChanged} onOpen={onOpenDev} />
    </div>
  )
}

// ---------------------------------------------------------------- staff access (Developer tab)
function StaffAccess({ dev, onChanged, onOpen }: { dev: DevAccess | null; onChanged(): void; onOpen(): void }) {
  const { t } = useTranslation()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  if (!dev) return null
  const unlock = async () => {
    setBusy(true)
    setMsg(null)
    const r = await window.hemisphere.dev.unlock(code).catch(() => null)
    setBusy(false)
    if (r?.ok) {
      setCode('')
      setMsg({ ok: true, text: t('dev.unlocked') })
      onChanged()
    } else setMsg({ ok: false, text: r && r.reason === 'wait' ? t('dev.wait', { seconds: r.seconds }) : t('dev.wrong') })
  }
  return (
    <>
      <Row title={t('dev.staffAccess')} hint={dev.devBuild ? t('dev.staffAccessDev') : dev.unlocked ? t('dev.staffAccessOn') : t('dev.staffAccessHint')}>
        {dev.devBuild || dev.unlocked ? (
          <button onClick={onOpen} className={buttonClass}>
            <FlaskConical size={16} /> {t('dev.open')}
          </button>
        ) : (
          <span className="flex gap-2">
            <input
              type="password"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && code.trim() && void unlock()}
              placeholder={t('dev.codePlaceholder')}
              autoComplete="off"
              spellCheck={false}
              className="w-[200px] rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 font-mono text-sm text-white"
            />
            <button onClick={unlock} disabled={busy || !code.trim()} className={buttonClass}>
              <KeyRound size={16} /> {t('dev.unlock')}
            </button>
          </span>
        )}
      </Row>
      {msg && <Notice ok={msg.ok}>{msg.text}</Notice>}
    </>
  )
}

// ---------------------------------------------------------------- helpers
function Row({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={title} className="flex items-center gap-5 border-b border-white/5 py-4">
      <div className="min-w-0 flex-1">
        <b className="block font-semibold text-white">{title}</b>
        {hint && <span className="block truncate text-[12.5px] text-gray-400" title={hint}>{hint}</span>}
      </div>
      {children}
    </div>
  )
}

function Notice({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <p className={`animate-fade mt-2 flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] ${ok ? 'bg-green-900/40 text-green-300' : 'bg-red-900/35 text-red-300'}`}>
      {ok ? <Check size={14} /> : <TriangleAlert size={14} />} {children}
    </p>
  )
}
