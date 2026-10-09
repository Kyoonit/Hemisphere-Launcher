/**
 * A player's launcher, drawn by Herald: the launcher's own news pieces, banner and welcome message (src/renderer/src/
 * components/feed), with its own translations, inside a replica of its window. Fed by resolveFeed, the function the
 * launcher itself uses: what is shown here is what a player sees.
 */
import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import i18next, { type i18n } from 'i18next'
import { I18nextProvider, initReactI18next, useTranslation } from 'react-i18next'
import { BookOpen, Construction, Globe, Images, Map as MapIcon, MapPin, Minus, Newspaper, Package, Play, Settings, Square, X } from 'lucide-react'
import en from '@locales/en.json'
import fr from '@locales/fr.json'
import type { FeedView } from '@shared/schedule'
import { NEWS_CATEGORIES, type NewsItem } from '@shared/feed'
import { NewsArticle, NewsCard, NewsFeatured, NewsPeekCard } from '@launcher/components/feed/NewsCards'
import { AnnouncementBanner, MaintenanceNotice, PlannedMaintenance, WelcomeHeading } from '@launcher/components/feed/HomeNotices'
import { RestartBox } from '@launcher/components/feed/RestartBox'
import { EventList, NextEvent } from '@launcher/components/feed/EventCards'
import { nextRestart, restartState } from '@shared/restart'
import logo from '@launcher/assets/logo.png'
import { homePictures } from '@launcher/components/feed/homePictures'

const instances = new Map<string, i18n>()
/** One translation instance per language shown (several previews can show different languages side by side) */
function launcherI18n(lang: string): i18n {
  let inst = instances.get(lang)
  if (!inst) {
    inst = i18next.createInstance()
    void inst.use(initReactI18next).init({ resources: { en: { translation: en }, fr: { translation: fr } }, lng: lang, fallbackLng: 'en', interpolation: { escapeValue: false }, initAsync: false })
    instances.set(lang, inst)
  }
  return inst
}

export type PreviewScreen = 'home' | 'news'
export const WINDOW_SIZES = { small: { w: 960, h: 600, label: 'Smallest window (960 × 600)' }, normal: { w: 1120, h: 700, label: 'Usual window (1120 × 700)' } } as const
export type WindowSize = keyof typeof WINDOW_SIZES

interface Props {
  view: FeedView
  lang: string
  screen: PreviewScreen
  onScreen(s: PreviewScreen): void
  /** Open this news's reading page (null = the News list) */
  article: string | null
  onArticle(id: string | null): void
  size: WindowSize
  /** News the player has not opened yet (red badge) */
  badge: number
  playerName?: string | null
  /** The instant shown (restart countdown, maintenance end); default: now */
  at?: number
  /** Home's picture (its URL); default: the team's first one in force, else the first built-in one */
  background?: string
}

/** The launcher window, scaled to the width it is given */
export function LauncherPreview(props: Props) {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(800)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  const { w, h } = WINDOW_SIZES[props.size]
  const scale = Math.min(1, width / w)
  const inst = useMemo(() => launcherI18n(props.lang), [props.lang])
  return (
    <div ref={box} className="w-full">
      <div style={{ height: h * scale }} className="overflow-hidden rounded-lg shadow-2xl ring-1 ring-white/10">
        <div style={{ width: w, height: h, transform: `scale(${scale})`, transformOrigin: 'top left' }} className="launcher-preview relative overflow-hidden bg-gray-900 text-gray-200">
          <I18nextProvider i18n={inst}>
            <Guard>
              <Window {...props} height={h} />
            </Guard>
          </I18nextProvider>
        </div>
      </div>
    </div>
  )
}

/** A preview that cannot be drawn says so instead of blanking Herald */
class Guard extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null }
  static getDerivedStateFromError(err: unknown) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
  componentDidUpdate(prev: { children: ReactNode }) {
    if (prev.children !== this.props.children && this.state.error) this.setState({ error: null })
  }
  render() {
    return this.state.error ? <div className="grid h-full place-items-center p-10 text-center text-xl text-red-300">This preview could not be drawn: {this.state.error}</div> : this.props.children
  }
}

function Window({ view, lang, screen, onScreen, article, onArticle, badge, playerName, height, at, background }: Props & { height: number }) {
  const { t } = useTranslation()
  const pictures = homePictures(view.backgrounds, lang, t)
  const picture = pictures.find((p) => p.src === background) ?? pictures.find((p) => view.backgrounds?.items.some((b) => b.src === p.src)) ?? pictures[0]
  const dimmed = screen !== 'home'
  // The launcher sizes Home's title with the window height (vh): same formula with this window's height
  const vh = height / 100
  const style = { '--lp-title': `${Math.min(44, Math.max(34, 6.25 * vh - 3.5))}px`, '--lp-gap': `${Math.min(32, Math.max(20, 7.5 * vh - 25))}px` } as React.CSSProperties
  return (
    <div className="absolute inset-0" style={style}>
      <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url("${picture.src}")` }} />
      <div className="absolute inset-0 bg-gradient-to-b from-gray-900/75 via-gray-800/60 to-gray-900/95" />
      {dimmed && <div className="absolute inset-0 bg-gray-900/95" />}
      {!dimmed && (
        <div className="absolute top-[66px] left-5 z-10 flex items-center gap-1.5 text-xs text-white/55">
          <MapPin size={13} />
          {picture.caption}
        </div>
      )}
      <TitleBar screen={screen} onScreen={onScreen} badge={screen === 'news' ? 0 : badge} />
      <div className="absolute inset-x-0 top-[52px] bottom-5">
        {screen === 'home' ? <Home view={view} at={at ?? Date.now()} onOpenNews={() => (onScreen('news'), onArticle(null))} playerName={playerName === undefined ? 'Steve' : playerName} /> : <News view={view} lang={lang} at={at ?? Date.now()} article={article} onArticle={onArticle} />}
      </div>
      <p className="pointer-events-none absolute inset-x-0 bottom-0 h-5 truncate px-4 text-center text-[11px] leading-5 text-gray-500">{t('legal.disclaimer')}</p>
    </div>
  )
}

const TABS = [
  { id: 'home', icon: Play, label: 'nav.play' },
  { id: 'news', icon: Newspaper, label: 'nav.news' },
  { id: 'mods', icon: Package, label: 'nav.mods' },
  { id: 'screenshots', icon: Images, label: 'nav.screenshots' },
  { id: 'settings', icon: Settings, label: 'nav.settings' },
] as const

function TitleBar({ screen, onScreen, badge }: { screen: PreviewScreen; onScreen(s: PreviewScreen): void; badge: number }) {
  const { t } = useTranslation()
  return (
    <header className="absolute inset-x-0 top-0 z-20 flex h-[52px] items-center gap-4 border-b border-green-500/20 bg-gradient-to-r from-gray-900/95 via-gray-800/95 to-gray-900/95 pl-4 shadow-lg">
      <div className="flex items-center gap-2 text-[17px] font-bold whitespace-nowrap text-white">
        <img src={logo} alt="" className="h-7 w-7" draggable={false} />
        {t('app.name')}
      </div>
      <nav className="ml-3 flex min-w-0 gap-1">
        {TABS.map(({ id, icon: Icon, label }) => {
          const active = screen === id
          return (
            <button
              key={id}
              onClick={() => (id === 'home' || id === 'news') && onScreen(id)}
              className={`relative flex items-center gap-2 rounded-lg px-3.5 py-[7px] text-sm font-medium ${active ? 'bg-green-600 text-white shadow-md' : 'text-gray-300 hover:bg-gray-700 hover:text-white'} ${id === 'home' || id === 'news' ? '' : 'cursor-default'}`}
            >
              <Icon size={16} strokeWidth={2} />
              <span>{t(label)}</span>
              {id === 'news' && badge > 0 && (
                <span className="absolute -top-1 -right-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-white shadow ring-2 ring-gray-900">{badge > 9 ? '9+' : badge}</span>
              )}
            </button>
          )
        })}
      </nav>
      <div className="ml-auto flex h-full items-center text-gray-400">
        <span className="mr-2 flex items-center gap-2 rounded-lg px-2 py-1 text-[13px] text-gray-300">
          <span className="size-6 rounded bg-gradient-to-br from-amber-700 to-amber-900" /> Steve
        </span>
        {[Minus, Square, X].map((Icon, i) => (
          <span key={i} className="grid h-full w-[46px] place-items-center">
            <Icon size={i === 1 ? 13 : 16} />
          </span>
        ))}
      </div>
    </header>
  )
}

function Home({ view, at, onOpenNews, playerName }: { view: FeedView; at: number; onOpenNews(): void; playerName: string | null }) {
  const { t } = useTranslation()
  const latest = view.news[0]
  return (
    <div className="relative flex h-full flex-col items-center px-7 pb-3">
      <ServerCard view={view} at={at} />
      <section className="flex min-h-0 flex-1 flex-col items-center justify-center text-center">
        {view.banner && <AnnouncementBanner banner={view.banner} />}
        <WelcomeHeading welcome={view.welcome} name={playerName} compact={false} />
        <div className="flex flex-col items-center" style={{ marginTop: 'var(--lp-gap)' }}>
          <button className="play-button">{t('home.play')}</button>
          {view.maintenance.active && <MaintenanceNotice maintenance={view.maintenance} now={at} />}
          {view.maintenancePlanned && <PlannedMaintenance planned={view.maintenancePlanned} />}
        </div>
      </section>
      <footer className="relative z-10 flex w-full flex-none items-end justify-between gap-4 pt-4">
        <div className="flex gap-2">
          <span className="flex items-center gap-2 rounded-lg bg-discord px-4 py-[9px] text-sm font-semibold text-white shadow-md">{t('links.discord')}</span>
          {[
            [Globe, 'website'],
            [MapIcon, 'map'],
            [BookOpen, 'rules'],
          ].map(([Icon, key]) => {
            const I = Icon as typeof Globe
            return (
              <span key={key as string} className="flex items-center gap-2 rounded-lg bg-gray-800/75 px-4 py-[9px] text-sm font-semibold text-gray-300">
                <I size={18} /> {t(`links.${key}`)}
              </span>
            )
          })}
        </div>
        {latest && <NewsPeekCard item={latest} onOpen={onOpenNews} />}
      </footer>
    </div>
  )
}

function News({ view, lang, at, article, onArticle }: { view: FeedView; lang: string; at: number; article: string | null; onArticle(id: string | null): void }) {
  const { t } = useTranslation()
  const open = view.news.find((n) => n.id === article)
  if (open) return <NewsArticle item={open} lang={lang} onBack={() => onArticle(null)} onOpenLink={() => {}} />
  const items: NewsItem[] = view.news
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
        <div className="flex gap-1.5">
          {['all', ...NEWS_CATEGORIES].map((f) => (
            <span key={f} className={`rounded-lg px-3.5 py-1.5 text-[13px] font-medium ${f === 'all' ? 'bg-green-600 text-white' : 'bg-gray-800/70 text-gray-300'}`}>
              {f === 'all' ? t('mods.groups.all') : t(`news.categories.${f}`)}
            </span>
          ))}
        </div>
      </div>
      <div className="mb-5 flex gap-1 border-b border-gray-700/70">
        <span className="-mb-px flex items-center gap-2 border-b-2 border-green-400 px-3.5 pb-2 text-[14px] font-semibold text-white">{t('news.tabs.server')}</span>
        <span className="-mb-px flex items-center gap-2 border-b-2 border-transparent px-3.5 pb-2 text-[14px] font-semibold text-gray-400">{t('news.tabs.launcher')}</span>
      </div>
      <EventList events={view.events} now={at} lang={lang} />
      {!featured ? (
        <div className="grid h-[60%] place-items-center text-gray-400">
          <p className="flex items-center gap-2">
            <Newspaper size={18} /> {t('news.empty')}
          </p>
        </div>
      ) : (
        <>
          <NewsFeatured item={featured} lang={lang} onOpen={() => onArticle(featured.id)} />
          <div className="grid grid-cols-3 gap-4">
            {rest.map((n) => (
              <NewsCard key={n.id} item={n} lang={lang} onOpen={() => onArticle(n.id)} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/** The server panel of Home (top right): its status and the restart line, at the instant shown (players and ping are live data, not shown) */
function ServerCard({ view, at }: { view: FeedView; at: number }) {
  const { t, i18n } = useTranslation()
  const maintenance = view.maintenance.active
  const restarting = !maintenance && view.restart ? restartState(at, view.restart).phase === 'restarting' : false
  const [tone, label] = maintenance ? ['text-amber-400', t('server.maintenance')] : restarting ? ['text-red-400', t('server.restartingShort')] : ['text-green-400', t('server.online')]
  return (
    <aside className="glass absolute top-5 right-6 flex w-[268px] flex-col p-4">
      <p className="text-xs font-bold tracking-[0.08em] text-gray-400 uppercase">{t('server.name')}</p>
      <div className="mt-2">
        <span className={`inline-flex items-center gap-2 rounded-full bg-gray-900/75 px-3 py-[5px] text-xs font-bold tracking-[0.06em] uppercase ${tone}`}>
          <i className="h-2 w-2 rounded-full bg-current shadow-[0_0_8px_currentColor]" />
          {label}
        </span>
      </div>
      {maintenance ? (
        <div className="mt-3 flex items-start gap-2.5 rounded-lg bg-amber-900/50 px-3 py-2.5 text-[13px] shadow-[inset_3px_0_0_var(--color-amber-400)]">
          <Construction size={16} className="mt-0.5 flex-none text-amber-400" />
          <span className="text-amber-100">
            {t('server.maintenanceShort')}
            {view.maintenance.until && Date.parse(view.maintenance.until) > at && (
              <span className="block text-xs text-amber-200/80">{t('home.maintenanceUntil', { time: new Date(view.maintenance.until).toLocaleString(i18n.language, { weekday: 'short', hour: '2-digit', minute: '2-digit' }) })}</span>
            )}
          </span>
        </div>
      ) : (
        view.restart && <RestartBox restart={restarting ? restartState(at, view.restart) : nextRestart(at, view.restart)} live={restarting ? { phase: 'restarting', since: at, checkedAt: at } : null} now={at} />
      )}
      <NextEvent events={view.events} now={at} />
    </aside>
  )
}
