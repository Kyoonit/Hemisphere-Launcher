import { useCallback, useEffect, useState } from 'react'
import type { Profile } from '@herald/api'
import { StoreProvider, useStore } from './store'
import { TABS, TitleBar, type Tab } from './components/TitleBar'
import SignIn from './screens/SignIn'
import Home from './screens/Home'
import Team from './screens/Team'
import MySettings from './screens/MySettings'

const COMING: Partial<Record<Tab, string>> = {
  publications: 'News, events, banners and welcome messages: phase S5.',
  preview: 'The launcher at any date and in any time zone: phase S5.',
  server: 'Maintenance, emergency buttons and the daily restart: phase S6.',
  backgrounds: 'Home backgrounds by period: phase S8.',
  pack: 'The mod pack and its approvals: phase S10.',
}

export default function App() {
  const [me, setMe] = useState<Profile | null | undefined>(undefined)
  const [staging, setStaging] = useState(false)
  useEffect(() => {
    void window.herald.info().then((i) => setStaging(i.staging))
    void window.herald.session.current().then(setMe)
  }, [])
  const signedOut = useCallback(() => setMe(null), [])

  if (me === undefined) return <div className="h-full bg-gray-900" />
  if (me === null) return <SignIn staging={staging} onSignedIn={setMe} />
  return (
    <StoreProvider me={me} onSignedOut={signedOut}>
      <Shell staging={staging} />
    </StoreProvider>
  )
}

function Shell({ staging }: { staging: boolean }) {
  const { can } = useStore()
  const [tab, setTab] = useState<Tab>('home')
  // A permission removed meanwhile: back to Home
  const allowed = tab === 'settings' || TABS.some((t) => t.id === tab && (!t.needs || t.needs.some(can)))
  const shown = allowed ? tab : 'home'
  return (
    <div className="flex h-full flex-col">
      <TitleBar tab={shown} onTab={setTab} staging={staging} />
      <main className="min-h-0 flex-1 overflow-auto px-7 py-6">
        {shown === 'home' && <Home />}
        {shown === 'team' && <Team />}
        {shown === 'settings' && <MySettings />}
        {COMING[shown] && (
          <div className="grid h-full place-items-center text-center">
            <div>
              <div className="eyebrow">Coming soon</div>
              <p className="mt-2 text-gray-300">{COMING[shown]}</p>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
