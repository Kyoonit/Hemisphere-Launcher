import { useState } from 'react'
import TitleBar, { type Screen } from './components/TitleBar'
import Background from './components/Background'
import AccountMenu from './components/AccountMenu'
import Home from './screens/Home'
import Login from './screens/Login'
import News from './screens/News'
import Mods from './screens/Mods'
import Repair from './screens/Repair'
import Settings, { type Section } from './screens/Settings'
import { useAccounts } from './accounts'

export default function App() {
  const { state } = useAccounts()
  const [screen, setScreen] = useState<Screen>('home')
  const [settingsSection, setSettingsSection] = useState<Section>('game')
  const [addingAccount, setAddingAccount] = useState(false)

  const needsLogin = state !== null && state.accounts.length === 0
  const showLogin = needsLogin || addingAccount
  const dimmed = !showLogin && screen !== 'home' && screen !== 'repair'

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
        <main key={showLogin ? 'login' : `${screen}-${settingsSection}`} className="animate-fade absolute inset-x-0 top-[52px] bottom-0">
          {showLogin ? (
            <Login onBack={needsLogin ? undefined : () => setAddingAccount(false)} />
          ) : (
            <>
              {screen === 'home' && <Home onOpenNews={() => setScreen('news')} onRepair={() => setScreen('repair')} />}
              {screen === 'news' && <News />}
              {screen === 'mods' && <Mods />}
              {screen === 'settings' && <Settings initialSection={settingsSection} onAddAccount={() => setAddingAccount(true)} onRepair={() => setScreen('repair')} />}
              {screen === 'repair' && <Repair onClose={() => openSettings('installation')} onDone={() => setScreen('home')} />}
            </>
          )}
        </main>
      )}
    </div>
  )
}
