import { useState } from 'react'
import TitleBar, { type Screen } from './components/TitleBar'
import Background from './components/Background'
import Home from './screens/Home'
import Placeholder from './screens/Placeholder'
import Settings from './screens/Settings'

export default function App() {
  const [screen, setScreen] = useState<Screen>('home')
  const dimmed = screen !== 'home'

  return (
    <div className="relative h-full overflow-hidden">
      <Background dimmed={dimmed} />
      <TitleBar screen={screen} onNavigate={setScreen} />
      <main key={screen} className="animate-fade absolute inset-x-0 top-[52px] bottom-0">
        {screen === 'home' && <Home />}
        {screen === 'news' && <Placeholder kind="news" />}
        {screen === 'mods' && <Placeholder kind="mods" />}
        {screen === 'settings' && <Settings />}
      </main>
    </div>
  )
}
