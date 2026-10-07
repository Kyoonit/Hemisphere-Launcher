import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderOpen, Gamepad2, Rocket, User, Wrench, type LucideIcon } from 'lucide-react'
import { LANGUAGES, systemLanguage } from '../i18n'

type Section = 'game' | 'launcher' | 'account' | 'installation' | 'advanced'

const SECTIONS: { id: Section; icon: LucideIcon }[] = [
  { id: 'game', icon: Gamepad2 },
  { id: 'launcher', icon: Rocket },
  { id: 'account', icon: User },
  { id: 'installation', icon: FolderOpen },
  { id: 'advanced', icon: Wrench },
]

export default function Settings() {
  const { t } = useTranslation()
  const [section, setSection] = useState<Section>('launcher')

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
        {section === 'launcher' ? <LauncherSettings /> : <p className="mt-4 text-gray-400">{t('settings.sectionPlaceholder')}</p>}
      </section>
    </div>
  )
}

function LauncherSettings() {
  const { t, i18n } = useTranslation()
  const [version, setVersion] = useState('')
  const [choice, setChoice] = useState('auto')
  useEffect(() => {
    window.hemisphere.appInfo().then((info) => setVersion(info.version))
  }, [])

  const changeLanguage = (value: string) => {
    setChoice(value)
    i18n.changeLanguage(value === 'auto' ? systemLanguage() : value)
  }

  return (
    <div className="mt-2">
      <Row title={t('settings.language')} hint={t('settings.languageHint')}>
        <select
          value={choice}
          onChange={(e) => changeLanguage(e.target.value)}
          className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-white focus:border-green-500 focus:outline-none"
        >
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
