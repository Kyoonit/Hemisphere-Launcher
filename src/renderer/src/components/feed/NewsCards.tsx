import { useTranslation } from 'react-i18next'
import { ArrowLeft, ArrowRight, ExternalLink } from 'lucide-react'
import type { NewsItem } from '@shared/feed'
import { localize } from '@shared/manifest'
import NewsImage from '../NewsImage'

/**
 * The news pieces of the launcher, without any data loading: the launcher's screens use them, and so does Herald's
 * preview (same components = what the staff sees is what players see).
 */

export const formatNewsDate = (date: string, lang: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString(lang, { day: 'numeric', month: 'short' })

const tagTone: Record<NewsItem['category'], string> = {
  update: 'text-green-400',
  event: 'text-sky-400',
  server: 'text-amber-400',
  community: 'text-pink-400',
}

export function NewsTag({ item, lang }: { item: NewsItem; lang: string }) {
  const { t } = useTranslation()
  return (
    <span className={`text-[11px] font-bold tracking-[0.08em] uppercase ${tagTone[item.category]}`}>
      {t(`news.categories.${item.category}`)} · {formatNewsDate(item.date, lang)}
    </span>
  )
}

/** The big card at the top of News */
export function NewsFeatured({ item, lang, onOpen }: { item: NewsItem; lang: string; onOpen(): void }) {
  const { t } = useTranslation()
  return (
    <button onClick={onOpen} className="glass mb-4 grid w-full grid-cols-[1.25fr_1fr] overflow-hidden text-left transition-transform duration-150 hover:scale-[1.01]">
      <NewsImage src={item.image} className="h-full min-h-[220px] w-full" />
      <div className="p-6">
        <NewsTag item={item} lang={lang} />
        <h2 className="mt-1.5 mb-2.5 text-[22px] leading-tight font-bold text-white">{localize(item.title, lang)}</h2>
        <p className="line-clamp-4 text-gray-400">{localize(item.body, lang)}</p>
        <span className="mt-4 inline-flex items-center gap-2 rounded-lg bg-gray-700/85 px-4 py-2 text-sm font-semibold text-white">
          {t('news.readMore')} <ArrowRight size={16} />
        </span>
      </div>
    </button>
  )
}

/** A small card of the News grid */
export function NewsCard({ item, lang, onOpen }: { item: NewsItem; lang: string; onOpen(): void }) {
  return (
    <button onClick={onOpen} className="overflow-hidden rounded-lg bg-gray-700/75 text-left transition-transform duration-150 hover:scale-[1.04]">
      <NewsImage src={item.image} className="h-[110px] w-full" />
      <div className="px-3.5 pt-3 pb-3.5">
        <NewsTag item={item} lang={lang} />
        <h3 className="my-0.5 text-[15px] leading-snug font-bold text-white">{localize(item.title, lang)}</h3>
        <p className="line-clamp-2 text-[12.5px] text-gray-400">{localize(item.body, lang)}</p>
      </div>
    </button>
  )
}

/** The reading page of a news */
export function NewsArticle({ item, lang, onBack, onOpenLink }: { item: NewsItem; lang: string; onBack(): void; onOpenLink(): void }) {
  const { t } = useTranslation()
  return (
    <div className="animate-fade h-full overflow-auto px-8 py-6">
      <button onClick={onBack} className="mb-4 flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-gray-400 transition-colors hover:bg-gray-700 hover:text-white">
        <ArrowLeft size={14} /> {t('news.back')}
      </button>
      <article className="glass mx-auto max-w-[760px] overflow-hidden">
        <NewsImage src={item.image} className="h-[240px] w-full" />
        <div className="px-8 py-6">
          <NewsTag item={item} lang={lang} />
          <h1 className="mt-1.5 text-[28px] leading-tight font-bold text-white">{localize(item.title, lang)}</h1>
          <div className="mt-4 flex flex-col gap-3 text-[15px] leading-relaxed text-gray-300 select-text">
            {localize(item.body, lang)
              .split(/\n\s*\n/)
              .map((p, i) => (
                <p key={i} className="whitespace-pre-line">
                  {p}
                </p>
              ))}
          </div>
          {item.link && (
            <button
              onClick={onOpenLink}
              className="mt-6 inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md transition-colors hover:bg-green-500"
            >
              {localize(item.link.label, lang)} <ExternalLink size={15} />
            </button>
          )}
        </div>
      </article>
    </div>
  )
}

/** Latest post, bottom right of Home */
export function NewsPeekCard({ item, onOpen }: { item: NewsItem; onOpen(): void }) {
  const { t, i18n } = useTranslation()
  return (
    <button onClick={onOpen} className="glass flex w-[330px] gap-3 p-2.5 text-left transition-transform duration-150 hover:scale-[1.03]">
      <NewsImage src={item.image} className="h-16 w-[86px] flex-none rounded" />
      <span className="flex min-w-0 flex-col">
        <span className="text-[11px] font-bold tracking-[0.08em] text-green-400 uppercase">
          {t(`news.categories.${item.category}`)} · {formatNewsDate(item.date, i18n.language)}
        </span>
        <span className="my-0.5 line-clamp-2 text-sm leading-tight font-bold text-white">{localize(item.title, i18n.language)}</span>
        <span className="flex items-center gap-1 text-xs text-gray-400">
          {t('news.allNews')} <ArrowRight size={12} />
        </span>
      </span>
    </button>
  )
}
