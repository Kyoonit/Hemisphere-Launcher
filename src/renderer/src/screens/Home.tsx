import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BookOpen, Check, Globe, Info, Map } from 'lucide-react'
import type { LinkKey } from '@shared/ipc'
import DiscordIcon from '../components/DiscordIcon'

const LINK_BUTTONS: { key: LinkKey; icon: React.ReactNode }[] = [
  { key: 'website', icon: <Globe size={18} /> },
  { key: 'map', icon: <Map size={18} /> },
  { key: 'rules', icon: <BookOpen size={18} /> },
]

export default function Home() {
  const { t } = useTranslation()
  const [notice, setNotice] = useState(false)

  return (
    <div className="flex h-full flex-col items-center px-7 pb-6">
      <section className="flex flex-1 flex-col items-center justify-center text-center">
        <h1 className="animate-rise text-[44px] leading-[1.05] font-bold text-white uppercase drop-shadow-lg [animation-delay:100ms]">
          {t('home.welcomeTo')}
          <br />
          <span className="text-green-400">{t('app.name')}</span>
        </h1>

        <div className="animate-rise mt-8 flex flex-col items-center [animation-delay:250ms]">
          <button className="play-button uppercase" onClick={() => setNotice(true)}>
            {t('home.play')}
          </button>
          <p className="mt-3 flex items-center gap-1.5 text-[13px] text-gray-400">
            {notice ? (
              <>
                <Info size={14} className="text-amber-400" />
                {t('home.notConnected')}
              </>
            ) : (
              <>
                <Check size={14} className="text-green-400" />
                <b className="font-semibold text-green-400">{t('home.ready')}</b>
                {' · '}
                {t('home.clientVersion', { version: '26.3' })}
              </>
            )}
          </p>
        </div>
      </section>

      <footer className="animate-rise flex w-full items-end justify-start gap-2 [animation-delay:400ms]">
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
      </footer>
    </div>
  )
}
