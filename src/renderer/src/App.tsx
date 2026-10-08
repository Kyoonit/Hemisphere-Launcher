import { lazy, Suspense, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import TitleBar, { type Screen } from './components/TitleBar'
import Background from './components/Background'
import AccountMenu from './components/AccountMenu'
import Home from './screens/Home'
import Login from './screens/Login'
import type { BrowseKind, ContentTab } from './screens/Content'
import type { ReportCategory } from '@shared/report'
import type { NewsTab } from './screens/News'
import type { Section } from './screens/Settings'
import { useAccounts } from './accounts'
import { useFeed, useLightMode, useSettings } from './hooks'

// Home and sign-in load with the launcher; the other screens load the first time they're opened (faster start, less memory).
const News = lazy(() => import('./screens/News'))
const Content = lazy(() => import('./screens/Content'))
const Repair = lazy(() => import('./screens/Repair'))
const Import = lazy(() => import('./screens/Import'))
const ModBrowser = lazy(() => import('./screens/ModBrowser'))
const ModHistory = lazy(() => import('./screens/ModHistory'))
const Screenshots = lazy(() => import('./screens/Screenshots'))
const Report = lazy(() => import('./screens/Report'))
const Settings = lazy(() => import('./screens/Settings'))
import { markNewsSeen, unseenNewsCount } from '@shared/feed'

export default function App() {
  const { t } = useTranslation()
  const { state } = useAccounts()
  const [screen, setScreen] = useState<Screen>('home')
  const [settingsSection, setSettingsSection] = useState<Section>('game')
  const [addingAccount, setAddingAccount] = useState(false)
  // Content: which tab, and what Find searches (back from Find or History lands on the same tab)
  const [contentTab, setContentTab] = useState<ContentTab>('mods')
  const [newsTab, setNewsTab] = useState<NewsTab>('server')
  const [browseKind, setBrowseKind] = useState<BrowseKind>('mod')
  // Report a problem: what it's about, and where Back goes
  const [report, setReport] = useState<{ category: ReportCategory | null; from: Screen } | null>(null)
  const openReport = (category: ReportCategory | null) => {
    setReport({ category, from: screen })
    setScreen('report')
  }

  // Opening News (or news arriving while it's open) marks every item as seen: the red badge goes away.
  const feed = useFeed()
  const [settings, updateSettings] = useSettings()
  useEffect(() => {
    if (screen === 'news' && newsTab === 'server' && feed && settings && unseenNewsCount(feed.news, settings.seenNews) > 0)
      void updateSettings({ seenNews: markNewsSeen(feed.news, settings.seenNews) })
  }, [screen, newsTab, feed, settings])

  const light = useLightMode()
  useEffect(() => void document.documentElement.classList.toggle('lite', light), [light])

  const needsLogin = state !== null && state.accounts.length === 0
  const showLogin = needsLogin || addingAccount
  const dimmed = !showLogin && screen !== 'home' && screen !== 'repair' && screen !== 'import'

  const openSettings = (section: Section) => {
    setSettingsSection(section)
    setScreen('settings')
  }

  return (
    <div className="relative h-full overflow-clip">
      <Background dimmed={dimmed} still={light} />
      <TitleBar
        screen={screen}
        onNavigate={(s) => {
          if (s === 'settings') setSettingsSection('game')
          if (s === 'news') setNewsTab('server')
          setScreen(s)
        }}
        minimal={showLogin}
        account={<AccountMenu onAddAccount={() => setAddingAccount(true)} onManage={() => openSettings('account')} />}
      />
      {state && (
        <main key={showLogin ? 'login' : `${screen}-${settingsSection}`} className="animate-fade absolute inset-x-0 top-[52px] bottom-5">
          {showLogin ? (
            <Login onBack={needsLogin ? undefined : () => setAddingAccount(false)} />
          ) : (
            <Suspense fallback={null}>
              {screen === 'home' && <Home
                  onOpenNews={() => {
                    setNewsTab('server')
                    setScreen('news')
                  }}
                  onOpenLauncherNews={() => {
                    setNewsTab('launcher')
                    setScreen('news')
                  }}
                  onRepair={() => setScreen('repair')}
                  onImport={() => setScreen('import')}
                  onReport={openReport}
                  onOpenMods={() => {
                    setContentTab('mods')
                    setScreen('mods')
                  }}
                />}
              {screen === 'news' && <News tab={newsTab} onTab={setNewsTab} />}
              {screen === 'mods' && (
                <Content
                  tab={contentTab}
                  onTab={setContentTab}
                  onBrowse={(kind) => {
                    setBrowseKind(kind)
                    setScreen('browse')
                  }}
                  onHistory={() => setScreen('modHistory')}
                  onImport={() => setScreen('import')}
                />
              )}
              {screen === 'modHistory' && <ModHistory onBack={() => setScreen('mods')} />}
              {screen === 'browse' && <ModBrowser kind={browseKind} onBack={() => setScreen('mods')} />}
              {screen === 'screenshots' && <Screenshots />}
              {screen === 'settings' && (
                <Settings initialSection={settingsSection} onAddAccount={() => setAddingAccount(true)} onRepair={() => setScreen('repair')} onImport={() => setScreen('import')} onReport={() => openReport(null)} />
              )}
              {screen === 'report' && <Report initialCategory={report?.category ?? null} onBack={() => setScreen(report?.from && report.from !== 'report' ? report.from : 'home')} />}
              {screen === 'import' && <Import onClose={() => setScreen('home')} />}
              {screen === 'repair' && <Repair onClose={() => openSettings('installation')} onDone={() => setScreen('home')} />}
            </Suspense>
          )}
        </main>
      )}
      {/* Required by Minecraft's usage guidelines for anything built around the game. */}
      <p className="pointer-events-none absolute inset-x-0 bottom-0 h-5 truncate px-4 text-center text-[11px] leading-5 text-gray-500">
        {t('legal.disclaimer')}
      </p>
    </div>
  )
}
