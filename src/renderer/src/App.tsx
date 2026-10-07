import { useState } from 'react'
import TitleBar, { type Screen } from './components/TitleBar'
import Background from './components/Background'
import AccountMenu from './components/AccountMenu'
import Home from './screens/Home'
import Login from './screens/Login'
import Placeholder from './screens/Placeholder'
import Settings, { type Section } from './screens/Settings'
import { useAccounts } from './accounts'

export default function App() {
  const { state } = useAccounts()
  const [screen, setScreen] = useState<Screen>('home')
  const [settingsSection, setSettingsSection] = useState<Section>('launcher')
  const [addingAccount, setAddingAccount] = useState(false)

  const needsLogin = state !== null && state.accounts.length === 0
  const showLogin = needsLogin || addingAccount
  const dimmed = !showLogin && screen !== 'home'

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
          if (s === 'settings') setSettingsSection('launcher')
          setScreen(s)
        }}
        minimal={showLogin}
        account={<AccountMenu onAddAccount={() => setAddingAccount(true)} onManage={() => openSettings('account')} />}
      />
      {state && (
        <main key={showLogin ? 'login' : `${screen}-${settingsSection}`} className="animate-fade absolute inset-x-0 top-[52px] bottom-0">
          {showLogin ? (
            <Login onBack={needsLogin ? undefined : () => setAddingAccount(false)} />
          ) : (
            <>
              {screen === 'home' && <Home onOpenNews={() => setScreen('news')} />}
              {screen === 'news' && <Placeholder kind="news" />}
              {screen === 'mods' && <Placeholder kind="mods" />}
              {screen === 'settings' && <Settings initialSection={settingsSection} onAddAccount={() => setAddingAccount(true)} />}
            </>
          )}
        </main>
      )}
    </div>
  )
}
