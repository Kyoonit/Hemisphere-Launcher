import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, Minus, Newspaper, Package, Play, Settings, Square, X, type LucideIcon } from 'lucide-react'
import logo from '../assets/logo.png'

export type Screen = 'home' | 'news' | 'mods' | 'settings'

const TABS: { id: Screen; icon: LucideIcon; label: string }[] = [
  { id: 'home', icon: Play, label: 'nav.play' },
  { id: 'news', icon: Newspaper, label: 'nav.news' },
  { id: 'mods', icon: Package, label: 'nav.mods' },
  { id: 'settings', icon: Settings, label: 'nav.settings' },
]

interface Props {
  screen: Screen
  onNavigate(screen: Screen): void
}

export default function TitleBar({ screen, onNavigate }: Props) {
  const { t } = useTranslation()
  const [maximized, setMaximized] = useState(false)
  useEffect(() => window.hemisphere.window.onMaximizedChange(setMaximized), [])

  return (
    <header className="drag absolute inset-x-0 top-0 z-20 flex h-[52px] items-center gap-4 border-b border-green-500/20 bg-gradient-to-r from-gray-900/95 via-gray-800/95 to-gray-900/95 pl-4 shadow-lg backdrop-blur-md">
      <div className="flex items-center gap-2 text-[17px] font-bold whitespace-nowrap text-white">
        <img src={logo} alt="" className="h-7 w-7" draggable={false} />
        {t('app.name')}
      </div>

      <nav className="no-drag ml-3 flex gap-1">
        {TABS.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => onNavigate(id)}
            className={`flex items-center gap-2 rounded-lg px-3.5 py-[7px] text-sm font-medium transition-all duration-300 ${
              screen === id ? 'bg-green-600 text-white shadow-md' : 'text-gray-300 hover:bg-gray-700 hover:text-white'
            }`}
          >
            <Icon size={16} strokeWidth={2} />
            {t(label)}
          </button>
        ))}
      </nav>

      <div className="no-drag ml-auto flex h-full">
        <WindowButton label={t('window.minimize')} onClick={window.hemisphere.window.minimize}>
          <Minus size={15} />
        </WindowButton>
        <WindowButton
          label={t(maximized ? 'window.restore' : 'window.maximize')}
          onClick={window.hemisphere.window.toggleMaximize}
        >
          {maximized ? <Copy size={13} className="-scale-x-100" /> : <Square size={13} />}
        </WindowButton>
        <WindowButton label={t('window.close')} onClick={window.hemisphere.window.close} danger>
          <X size={16} />
        </WindowButton>
      </div>
    </header>
  )
}

function WindowButton(props: { label: string; onClick(): void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      aria-label={props.label}
      title={props.label}
      onClick={props.onClick}
      className={`grid w-[46px] place-items-center text-gray-400 transition-colors duration-150 hover:text-white ${
        props.danger ? 'hover:bg-red-600' : 'hover:bg-gray-700'
      }`}
    >
      {props.children}
    </button>
  )
}
