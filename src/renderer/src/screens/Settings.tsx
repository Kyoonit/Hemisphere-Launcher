import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Coffee, FolderOpen, Gamepad2, Plus, Rocket, User, Wrench, type LucideIcon } from 'lucide-react'
import type { JavaRuntimeInfo } from '@shared/game'
import { LANGUAGES, systemLanguage } from '../i18n'
import { headUrl, useAccounts } from '../accounts'
import Toggle from '../components/Toggle'
import type { Settings } from '@shared/settings'

export type Section = 'game' | 'launcher' | 'account' | 'installation' | 'advanced'

const SECTIONS: { id: Section; icon: LucideIcon }[] = [
  { id: 'game', icon: Gamepad2 },
  { id: 'launcher', icon: Rocket },
  { id: 'account', icon: User },
  { id: 'installation', icon: FolderOpen },
  { id: 'advanced', icon: Wrench },
]

export default function Settings({ initialSection, onAddAccount, onRepair }: { initialSection: Section; onAddAccount(): void; onRepair(): void }) {
  const { t } = useTranslation()
  const [section, setSection] = useState<Section>(initialSection)

  return (
    <div className="grid h-full grid-cols-[200px_1fr]">
      <nav className="flex flex-col gap-0.5 border-r border-white/5 bg-gray-900/50 px-3 py-6">
        {SECTIONS.map(({ id, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setSection(id)}
            className={`flex items-center gap-2.5 rounded-lg px-3 py-[9px] text-left text-sm font-medium transition-colors duration-150 ${
              section === id
                ? 'bg-gray-700 text-white shadow-[inset_3px_0_0_var(--color-green-500)]'
                : 'text-gray-300 hover:bg-gray-700 hover:text-white'
            }`}
          >
            <Icon size={17} />
            {t(`settings.sections.${id}`)}
          </button>
        ))}
      </nav>

      <section key={section} className="animate-fade overflow-auto px-8 py-6">
        <h2 className="text-[26px] font-bold text-white">{t(`settings.sections.${section}`)}</h2>
        {section === 'launcher' ? (
          <LauncherSettings />
        ) : section === 'game' ? (
          <GameSettings />
        ) : section === 'account' ? (
          <AccountSettings onAddAccount={onAddAccount} />
        ) : section === 'installation' ? (
          <Row title={t('repair.title')} hint={t('repair.settingsHint')}>
            <button onClick={onRepair} className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white shadow-md transition-colors hover:bg-green-500">
              <Wrench size={16} /> {t('repair.short')}
            </button>
          </Row>
        ) : section === 'advanced' ? (
          <JavaSettings />
        ) : (
          <p className="mt-4 text-gray-400">{t('settings.sectionPlaceholder')}</p>
        )}
      </section>
    </div>
  )
}

function useSettings(): [Settings | null, (patch: Partial<Settings>) => void] {
  const [settings, setSettings] = useState<Settings | null>(null)
  useEffect(() => {
    window.hemisphere.settings.get().then(setSettings)
    return window.hemisphere.settings.onChange(setSettings)
  }, [])
  return [settings, (patch) => void window.hemisphere.settings.set(patch).then(setSettings)]
}

const selectClass = 'rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-white'

function GameSettings() {
  const { t } = useTranslation()
  const [settings, update] = useSettings()
  if (!settings) return null
  return (
    <div className="mt-2">
      <Row title={t('settings.autoJoin')} hint={t('settings.autoJoinHint')}>
        <Toggle on={settings.autoJoin} onChange={(autoJoin) => update({ autoJoin })} label={t('settings.autoJoin')} />
      </Row>
    </div>
  )
}

function LauncherSettings() {
  const { t, i18n } = useTranslation()
  const [settings, update] = useSettings()
  const [version, setVersion] = useState('')
  useEffect(() => {
    window.hemisphere.appInfo().then((info) => setVersion(info.version))
  }, [])
  if (!settings) return null

  const changeLanguage = (language: string) => {
    update({ language })
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
      <Row title={t('settings.version')} hint={version}>
        <span />
      </Row>
    </div>
  )
}

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
                <button onClick={() => window.hemisphere.auth.switchTo(a.id)} className="rounded-lg bg-gray-700/85 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-gray-600">
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
      <button onClick={onAddAccount} className="mt-4 flex items-center gap-2 rounded-lg bg-gray-700/85 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-gray-600">
        <Plus size={16} /> {t('auth.addAccount')}
      </button>
    </div>
  )
}

function JavaSettings() {
  const { t } = useTranslation()
  const [java, setJava] = useState<JavaRuntimeInfo[] | null>(null)
  useEffect(() => {
    window.hemisphere.game.javaInfo().then(setJava)
  }, [])

  return (
    <div className="mt-1">
      <b className="mt-3 block font-semibold text-white">{t('settings.java.title')}</b>
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
                <p className="truncate text-xs text-gray-400" title={j.path}>{j.path}</p>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${j.managed ? 'bg-green-600/20 text-green-400' : 'bg-gray-700 text-gray-300'}`}>
                {j.managed ? t('settings.java.managed') : t('settings.java.system')}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function Row({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-5 border-b border-white/5 py-4">
      <div className="flex-1">
        <b className="block font-semibold text-white">{title}</b>
        {hint && <span className="text-[12.5px] text-gray-400">{hint}</span>}
      </div>
      {children}
    </div>
  )
}
