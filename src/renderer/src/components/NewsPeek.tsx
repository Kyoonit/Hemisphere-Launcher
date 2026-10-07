import { useTranslation } from 'react-i18next'
import { ArrowRight } from 'lucide-react'
import type { Feed } from '@shared/feed'
import { localize } from '@shared/manifest'
import NewsImage from './NewsImage'
import { formatNewsDate } from '../screens/News'

/** Latest post on Home. Hidden when there's no news yet (offline first run). */
export default function NewsPeek({ feed, onOpen }: { feed: Feed | null; onOpen(): void }) {
  const { t, i18n } = useTranslation()
  const latest = feed?.news[0]
  if (!latest) return null

  return (
    <button onClick={onOpen} className="glass flex w-[330px] gap-3 p-2.5 text-left transition-transform duration-150 hover:scale-[1.03]">
      <NewsImage src={latest.image} className="h-16 w-[86px] flex-none rounded" />
      <span className="flex min-w-0 flex-col">
        <span className="text-[11px] font-bold tracking-[0.08em] text-green-400 uppercase">
          {t(`news.categories.${latest.category}`)} · {formatNewsDate(latest.date, i18n.language)}
        </span>
        <span className="my-0.5 line-clamp-2 text-sm leading-tight font-bold text-white">{localize(latest.title, i18n.language)}</span>
        <span className="flex items-center gap-1 text-xs text-gray-400">
          {t('news.allNews')} <ArrowRight size={12} />
        </span>
      </span>
    </button>
  )
}
