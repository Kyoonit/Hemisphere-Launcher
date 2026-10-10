import { useCallback, useEffect, useState } from 'react'
import type { Profile } from '@herald/api'
import { StoreProvider, useStore } from './store'
import { TABS, TitleBar, type Tab } from './components/TitleBar'
import { Tour } from '@launcher/components/tour/Tour'
import { heraldTour, markTourDone, onStartTour, TOUR_LABELS, tourDone } from './tour'
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
import Stats from './screens/Stats'
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
  const { can, me } = useStore()
  const [tab, setTab] = useState<Tab>('home')
  const [openPub, setOpenPub] = useState<string | null>(null)
  // Team opens on its people, or on the backups (from Home's warning)
  const [teamView, setTeamView] = useState<'people' | 'backups'>('people')
  const goPub = (id: string | null) => {
    setOpenPub(id)
    setTab('publications')
  }
  // A permission removed meanwhile: back to Home
  const allowed = tab === 'settings' || (tab === 'launcher' && (can('settings.public') || can('settings.staffCode'))) || TABS.some((t) => t.id === tab && (!t.needs || t.needs.some(can)))
  const shown = allowed ? tab : 'home'
  // the guided tour: opens by itself when Herald starts, until this profile did it or quit it once on this PC (×
  // or Esc ends it for good); shown again from the profile menu
  const [touring, setTouring] = useState(false)
  useEffect(() => onStartTour(() => setTouring(true)), [])
  useEffect(() => {
    if (tourDone(me.id)) return
    const timer = window.setTimeout(() => setTouring(true), 700)
    return () => window.clearTimeout(timer)
  }, [me.id])
  const canOpen = (t: Tab) => TABS.some((x) => x.id === t && (!x.needs || x.needs.some(can)))
  const endTour = () => (setTouring(false), markTourDone(me.id))
  return (
    <div className="flex h-full flex-col">
      <TitleBar tab={shown} onTab={(t) => (t === 'publications' && tab === 'publications' && setOpenPub(null), t === 'team' && setTeamView('people'), setTab(t))} staging={staging} />
      <PublishJobs catalogue={shown === 'catalogue'} />
      {touring && <Tour steps={heraldTour(canOpen, setTab)} labels={TOUR_LABELS} onClose={endTour} />}
      <main className="min-h-0 flex-1 overflow-auto px-7 py-6">
        {shown === 'home' && <Home onOpen={goPub} onPack={() => setTab('pack')} onBackups={() => (setTeamView('backups'), setTab('team'))} />}
        {shown === 'publications' && <Publications open={openPub} onOpen={setOpenPub} />}
        {shown === 'preview' && <Preview />}
        {shown === 'server' && <Server />}
        {shown === 'stats' && <Stats />}
        {shown === 'backgrounds' && <Backgrounds />}
        {shown === 'pack' && <Pack />}
        {shown === 'catalogue' && <Catalogue />}
        {shown === 'team' && <Team key={teamView} onOpen={goPub} initialView={teamView} />}
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
