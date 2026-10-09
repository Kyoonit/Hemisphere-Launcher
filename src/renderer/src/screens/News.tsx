import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Newspaper, Rocket } from 'lucide-react'
import { NEWS_CATEGORIES } from '@shared/feed'
import { NewsArticle, NewsCard, NewsFeatured } from '../components/feed/NewsCards'
import Events from '../components/Events'
import LauncherUpdates from '../components/LauncherUpdates'
import { useFeed } from '../hooks'

type Filter = 'all' | (typeof NEWS_CATEGORIES)[number]
/** News from the staff, or the launcher's own history (day by day) */
export type NewsTab = 'server' | 'launcher'

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
  if (open) return <NewsArticle item={open} lang={lang} onBack={() => setOpenId(null)} onOpenLink={() => window.hemisphere.feed.openLink(open.id)} />

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
          <NewsFeatured item={featured} lang={lang} onOpen={() => setOpenId(featured.id)} />

          <div className="grid grid-cols-3 gap-4">
            {rest.map((n) => (
              <NewsCard key={n.id} item={n} lang={lang} onOpen={() => setOpenId(n.id)} />
            ))}
          </div>
        </>
      )}
      </>
      )}
    </div>
  )
}
