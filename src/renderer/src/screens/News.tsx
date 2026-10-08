import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, ArrowRight, ExternalLink, Newspaper, Rocket } from 'lucide-react'
import { NEWS_CATEGORIES, type NewsItem } from '@shared/feed'
import { localize } from '@shared/manifest'
import NewsImage from '../components/NewsImage'
import Events from '../components/Events'
import LauncherUpdates from '../components/LauncherUpdates'
import { useFeed } from '../hooks'

type Filter = 'all' | (typeof NEWS_CATEGORIES)[number]
/** News from the staff, or the launcher's own history (day by day) */
export type NewsTab = 'server' | 'launcher'

export const formatNewsDate = (date: string, lang: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString(lang, { day: 'numeric', month: 'short' })

const tagTone: Record<NewsItem['category'], string> = {
  update: 'text-green-400',
  event: 'text-sky-400',
  server: 'text-amber-400',
  community: 'text-pink-400',
}

export default function News({ tab, onTab }: { tab: NewsTab; onTab(tab: NewsTab): void }) {
  const { t, i18n } = useTranslation()
  const feed = useFeed()
  const [filter, setFilter] = useState<Filter>('all')
  const [openId, setOpenId] = useState<string | null>(null)
  const lang = i18n.language

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpenId(null)
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [])

  if (!feed && tab === 'server')
    return (
      <div className="h-full overflow-hidden px-8 py-6" aria-busy="true">
        <div className="skeleton mb-2 h-3 w-32 rounded" />
        <div className="skeleton mb-6 h-8 w-56 rounded" />
        <div className="skeleton mb-4 h-[260px] rounded-lg" />
        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="skeleton h-[180px] rounded-lg" />
          ))}
        </div>
      </div>
    )
  const open = feed?.news.find((n) => n.id === openId)
  if (open) return <Article item={open} lang={lang} onBack={() => setOpenId(null)} />

  const items = (feed?.news ?? []).filter((n) => filter === 'all' || n.category === filter)
  const featured = items.find((n) => n.featured) ?? items[0]
  const rest = items.filter((n) => n !== featured)

  return (
    <div className="h-full overflow-auto px-8 py-6">
      <div className="mb-5 flex items-end justify-between">
        <div>
          <p className="text-xs font-bold tracking-[0.08em] text-green-400 uppercase">{t('news.subtitle')}</p>
          <h1 className="text-[30px] font-bold text-white uppercase">
            {t('news.titleA')} <span className="text-green-400">{t('news.titleB')}</span>
          </h1>
        </div>
        {tab === 'server' && (
        <div className="flex gap-1.5">
          {(['all', ...NEWS_CATEGORIES] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
                filter === f ? 'bg-green-600 text-white' : 'bg-gray-800/70 text-gray-300 hover:bg-gray-700 hover:text-white'
              }`}
            >
              {f === 'all' ? t('mods.groups.all') : t(`news.categories.${f}`)}
            </button>
          ))}
        </div>
        )}
      </div>

      <div role="tablist" className="mb-5 flex gap-1 border-b border-gray-700/70">
        {(['server', 'launcher'] as const).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => onTab(k)}
            className={`-mb-px flex items-center gap-2 border-b-2 px-3.5 pb-2 text-[14px] font-semibold transition-colors ${tab === k ? 'border-green-400 text-white' : 'border-transparent text-gray-400 hover:text-gray-200'}`}
          >
            {k === 'server' ? <Newspaper size={15} /> : <Rocket size={15} />} {t(`news.tabs.${k}`)}
          </button>
        ))}
      </div>

      {tab === 'launcher' ? (
        <LauncherUpdates />
      ) : (
      <>
      <Events events={feed!.events} />

      {!featured ? (
        <div className="grid h-[60%] place-items-center text-gray-400">
          <p className="flex items-center gap-2">
            <Newspaper size={18} /> {t('news.empty')}
          </p>
        </div>
      ) : (
        <>
          <button
            onClick={() => setOpenId(featured.id)}
            className="glass mb-4 grid w-full grid-cols-[1.25fr_1fr] overflow-hidden text-left transition-transform duration-150 hover:scale-[1.01]"
          >
            <NewsImage src={featured.image} className="h-full min-h-[220px] w-full" />
            <div className="p-6">
              <Tag item={featured} lang={lang} />
              <h2 className="mt-1.5 mb-2.5 text-[22px] leading-tight font-bold text-white">{localize(featured.title, lang)}</h2>
              <p className="line-clamp-4 text-gray-400">{localize(featured.body, lang)}</p>
              <span className="mt-4 inline-flex items-center gap-2 rounded-lg bg-gray-700/85 px-4 py-2 text-sm font-semibold text-white">
                {t('news.readMore')} <ArrowRight size={16} />
              </span>
            </div>
          </button>

          <div className="grid grid-cols-3 gap-4">
            {rest.map((n) => (
              <button
                key={n.id}
                onClick={() => setOpenId(n.id)}
                className="overflow-hidden rounded-lg bg-gray-700/75 text-left transition-transform duration-150 hover:scale-[1.04]"
              >
                <NewsImage src={n.image} className="h-[110px] w-full" />
                <div className="px-3.5 pt-3 pb-3.5">
                  <Tag item={n} lang={lang} />
                  <h3 className="my-0.5 text-[15px] leading-snug font-bold text-white">{localize(n.title, lang)}</h3>
                  <p className="line-clamp-2 text-[12.5px] text-gray-400">{localize(n.body, lang)}</p>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
      </>
      )}
    </div>
  )
}

function Tag({ item, lang }: { item: NewsItem; lang: string }) {
  const { t } = useTranslation()
  return (
    <span className={`text-[11px] font-bold tracking-[0.08em] uppercase ${tagTone[item.category]}`}>
      {t(`news.categories.${item.category}`)} · {formatNewsDate(item.date, lang)}
    </span>
  )
}

function Article({ item, lang, onBack }: { item: NewsItem; lang: string; onBack(): void }) {
  const { t } = useTranslation()
  return (
    <div className="animate-fade h-full overflow-auto px-8 py-6">
      <button onClick={onBack} className="mb-4 flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-gray-400 transition-colors hover:bg-gray-700 hover:text-white">
        <ArrowLeft size={14} /> {t('news.back')}
      </button>
      <article className="glass mx-auto max-w-[760px] overflow-hidden">
        <NewsImage src={item.image} className="h-[240px] w-full" />
        <div className="px-8 py-6">
          <Tag item={item} lang={lang} />
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
              onClick={() => window.hemisphere.feed.openLink(item.id)}
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
