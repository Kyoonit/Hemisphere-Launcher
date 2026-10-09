import { useCallback, useEffect, useState } from 'react'
import type { Profile } from '@herald/api'
import { StoreProvider, useStore } from './store'
import { TABS, TitleBar, type Tab } from './components/TitleBar'
import SignIn from './screens/SignIn'
import Home from './screens/Home'
import Team from './screens/Team'
import MySettings from './screens/MySettings'
import Publications from './screens/Publications'
import TimeTravel from './screens/TimeTravel'
import { PubsProvider } from './pubs'

const COMING: Partial<Record<Tab, string>> = {
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
      <PubsProvider>
        <Shell staging={staging} />
      </PubsProvider>
    </StoreProvider>
  )
}

function Shell({ staging }: { staging: boolean }) {
  const { can } = useStore()
  const [tab, setTab] = useState<Tab>('home')
  const [openPub, setOpenPub] = useState<string | null>(null)
  const goPub = (id: string | null) => {
    setOpenPub(id)
    setTab('publications')
  }
  // A permission removed meanwhile: back to Home
  const allowed = tab === 'settings' || TABS.some((t) => t.id === tab && (!t.needs || t.needs.some(can)))
  const shown = allowed ? tab : 'home'
  return (
    <div className="flex h-full flex-col">
      <TitleBar tab={shown} onTab={(t) => (t === 'publications' && tab === 'publications' && setOpenPub(null), setTab(t))} staging={staging} />
      <main className="min-h-0 flex-1 overflow-auto px-7 py-6">
        {shown === 'home' && <Home onOpen={goPub} />}
        {shown === 'publications' && <Publications open={openPub} onOpen={setOpenPub} />}
        {shown === 'preview' && <TimeTravel />}
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
