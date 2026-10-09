/** Session + what the server says (presence, activity), refreshed every 15 s (60 s when Herald is in the background). */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { LocalSettings, Profile, SyncState } from '@herald/api'
import type { Permission } from '@shared/heraldRoles'
import { pcZone } from './time'

interface Store {
  me: Profile
  sync: SyncState | null
  settings: LocalSettings
  /** The zone every date is shown in */
  zone: string
  can(p: Permission): boolean
  refresh(): Promise<void>
  saveSettings(patch: Partial<LocalSettings>): Promise<void>
  signOut(): Promise<void>
}

const Ctx = createContext<Store | null>(null)
export const useStore = () => useContext(Ctx)!

export function StoreProvider({ me: initial, onSignedOut, children }: { me: Profile; onSignedOut(): void; children: ReactNode }) {
  const [me, setMe] = useState(initial)
  const [sync, setSync] = useState<SyncState | null>(null)
  const [settings, setSettings] = useState<LocalSettings>({ timeZone: null, extraZones: [] })

  const refresh = useCallback(async () => {
    const res = await window.herald.api<SyncState>('GET', '/sync')
    if (res.ok) {
      setSync(res.data)
      setMe(res.data.me)
    }
  }, [])

  useEffect(() => {
    void window.herald.settings.get().then(setSettings)
    void refresh()
    let timer = 0
    const schedule = () => {
      window.clearInterval(timer)
      timer = window.setInterval(() => void refresh(), document.hidden ? 60_000 : 15_000)
    }
    const onVisible = () => {
      if (!document.hidden) void refresh()
      schedule()
    }
    schedule()
    document.addEventListener('visibilitychange', onVisible)
    const off = window.herald.session.onEnded(onSignedOut)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      off()
    }
  }, [refresh, onSignedOut])

  const store: Store = {
    me,
    sync,
    settings,
    zone: settings.timeZone ?? pcZone(),
    can: (p) => me.permissions.includes(p),
    refresh,
    saveSettings: async (patch) => setSettings(await window.herald.settings.set(patch)),
    signOut: async () => {
      await window.herald.session.signOut()
      onSignedOut()
    },
  }
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>
}
