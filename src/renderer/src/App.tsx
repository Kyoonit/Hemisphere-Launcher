import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import TitleBar, { type Screen } from './components/TitleBar'
import Background from './components/Background'
import AccountMenu from './components/AccountMenu'
import Home from './screens/Home'
import Login from './screens/Login'
import News from './screens/News'
import Mods from './screens/Mods'
import Repair from './screens/Repair'
import Import from './screens/Import'
import Settings, { type Section } from './screens/Settings'
import { useAccounts } from './accounts'
import { useFeed, useSettings } from './hooks'
import { markNewsSeen, unseenNewsCount } from '@shared/feed'

export default function App() {
  const { t } = useTranslation()
  const { state } = useAccounts()
  const [screen, setScreen] = useState<Screen>('home')
  const [settingsSection, setSettingsSection] = useState<Section>('game')
  const [addingAccount, setAddingAccount] = useState(false)

  // Opening News (or news arriving while it's open) marks every item as seen: the red badge goes away.
  const feed = useFeed()
  const [settings, updateSettings] = useSettings()
  useEffect(() => {
    if (screen === 'news' && feed && settings && unseenNewsCount(feed.news, settings.seenNews) > 0)
      void updateSettings({ seenNews: markNewsSeen(feed.news, settings.seenNews) })
  }, [screen, feed, settings])

  const needsLogin = state !== null && state.accounts.length === 0
  const showLogin = needsLogin || addingAccount
  const dimmed = !showLogin && screen !== 'home' && screen !== 'repair' && screen !== 'import'

  const openSettings = (section: Section) => {
    setSettingsSection(section)
    setScreen('settings')
  }

  return (
    <div className="relative h-full overflow-hidden">
      <Background dimmed={dimmed} />
      <TitleBar
        screen={screen}
        onNavigate={(s) => {
          if (s === 'settings') setSettingsSection('game')
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
            <>
              {screen === 'home' && <Home onOpenNews={() => setScreen('news')} onRepair={() => setScreen('repair')} onImport={() => setScreen('import')} />}
              {screen === 'news' && <News />}
              {screen === 'mods' && <Mods onImport={() => setScreen('import')} />}
              {screen === 'settings' && <Settings initialSection={settingsSection} onAddAccount={() => setAddingAccount(true)} onRepair={() => setScreen('repair')} onImport={() => setScreen('import')} />}
              {screen === 'import' && <Import onClose={() => setScreen('home')} />}
              {screen === 'repair' && <Repair onClose={() => openSettings('installation')} onDone={() => setScreen('home')} />}
            </>
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
