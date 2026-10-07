import { useTranslation } from 'react-i18next'
import { ArrowRight } from 'lucide-react'
import thumb from '../assets/backgrounds/hempshire.avif'

/** Latest post preview. Bundled welcome post until remote news arrives (Phase 12). */
export default function NewsPeek({ onOpen }: { onOpen(): void }) {
  const { t } = useTranslation()

  return (
    <button
      onClick={onOpen}
      className="glass flex w-[330px] gap-3 p-2.5 text-left transition-transform duration-150 hover:scale-[1.03]"
    >
      <span className="h-16 w-[86px] flex-none rounded bg-cover bg-center" style={{ backgroundImage: `url(${thumb})` }} />
      <span className="flex min-w-0 flex-col">
        <span className="text-[11px] font-bold tracking-[0.08em] text-green-400 uppercase">{t('news.welcome.tag')}</span>
        <span className="my-0.5 line-clamp-2 text-sm leading-tight font-bold text-white">{t('news.welcome.title')}</span>
        <span className="flex items-center gap-1 text-xs text-gray-400">
          {t('news.allNews')} <ArrowRight size={12} />
        </span>
      </span>
    </button>
  )
}
