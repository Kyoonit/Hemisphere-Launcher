import { useCallback, useEffect, useState } from 'react'
import type { Profile } from '@herald/api'
import { StoreProvider, useStore } from './store'
import { TABS, TitleBar, type Tab } from './components/TitleBar'
import SignIn from './screens/SignIn'
import Home from './screens/Home'
import Team from './screens/Team'
import MySettings from './screens/MySettings'
import Publications from './screens/Publications'
import Preview from './screens/Preview'
import Server from './screens/Server'
import Backgrounds from './screens/Backgrounds'
import LauncherSettings from './screens/LauncherSettings'
import Pack from './screens/Pack'
import Catalogue from './screens/Catalogue'
import { PubsProvider } from './pubs'
import { PublishJobs } from './screens/PublishJobs'

const COMING: Partial<Record<Tab, string>> = {}

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
  const allowed = tab === 'settings' || (tab === 'launcher' && (can('settings.public') || can('settings.staffCode'))) || TABS.some((t) => t.id === tab && (!t.needs || t.needs.some(can)))
  const shown = allowed ? tab : 'home'
  return (
    <div className="flex h-full flex-col">
      <TitleBar tab={shown} onTab={(t) => (t === 'publications' && tab === 'publications' && setOpenPub(null), setTab(t))} staging={staging} />
      <PublishJobs />
      <main className="min-h-0 flex-1 overflow-auto px-7 py-6">
        {shown === 'home' && <Home onOpen={goPub} onPack={() => setTab('pack')} />}
        {shown === 'publications' && <Publications open={openPub} onOpen={setOpenPub} />}
        {shown === 'preview' && <Preview />}
        {shown === 'server' && <Server />}
        {shown === 'backgrounds' && <Backgrounds />}
        {shown === 'pack' && <Pack />}
        {shown === 'catalogue' && <Catalogue />}
        {shown === 'team' && <Team onOpen={goPub} />}
        {shown === 'settings' && <MySettings />}
        {shown === 'launcher' && <LauncherSettings />}
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
