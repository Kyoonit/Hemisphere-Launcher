import { useEffect, useRef, useState } from 'react'
import type { UpdateState } from '@herald/api'
import { ROLE_LABEL, type Permission } from '@shared/heraldRoles'
import { useStore } from '../store'
import { Avatar } from './ui'
import { usePubs } from '../pubs'
import { attention } from '../screens/Home'
import { startTour } from '../tour'

export type Tab = 'home' | 'publications' | 'preview' | 'server' | 'backgrounds' | 'pack' | 'catalogue' | 'team' | 'settings' | 'launcher'

/** The tabs a profile sees: hidden when none of their permissions uses them (Lodge keepers see four). */
export const TABS: { id: Tab; label: string; needs?: Permission[] }[] = [
  { id: 'home', label: 'Home' },
  { id: 'publications', label: 'Publications' },
  { id: 'preview', label: 'Preview' },
  { id: 'server', label: 'Server', needs: ['maintenance.write', 'maintenance.emergency', 'restart.write'] },
  { id: 'backgrounds', label: 'Backgrounds', needs: ['backgrounds.write'] },
  { id: 'pack', label: 'Mod pack', needs: ['pack.propose', 'pack.approve'] },
  { id: 'catalogue', label: 'Catalogue', needs: ['catalogue.write', 'catalogue.publish', 'catalogue.delete', 'catalogue.export'] },
  { id: 'team', label: 'Team' },
]

export function TitleBar({ tab, onTab, staging }: { tab: Tab | null; onTab(t: Tab): void; staging: boolean }) {
  const { me, sync, can, signOut, zone } = useStore()
  const { state } = usePubs()
  // Reminders (Home's "Needs attention"): a count on the Home tab, seen from every tab
  const reminders = state ? new Set(attention(state.publications, sync?.now ?? Date.now(), zone).map((a) => a.pub.id)).size : 0
  const [menu, setMenu] = useState(false)
  const menuBox = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menu) return
    const onDown = (e: MouseEvent) => !menuBox.current?.contains(e.target as Node) && setMenu(false)
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [menu])
  // Other staff online (your own avatar is already the profile button)
  const online = (sync?.people ?? []).filter((p) => p.online && p.id !== me?.id)
  const [update, setUpdate] = useState<UpdateState>({ phase: 'idle' })
  const [version, setVersion] = useState('')
  useEffect(() => void window.herald.info().then((i) => setVersion(i.version)), [])
  useEffect(() => {
    void window.herald.update.state().then(setUpdate)
    return window.herald.update.onState(setUpdate)
  }, [])

  return (
    <div className="drag flex h-[52px] shrink-0 items-center gap-3 border-b border-green-400/20 bg-gradient-to-r from-gray-900 via-gray-800 to-gray-900 pl-4">
      <div className="flex items-center gap-2 text-[17px] font-bold text-white">
        <span className="grid size-7 place-items-center rounded-md bg-gradient-to-br from-green-400 to-green-600 text-[15px] font-extrabold text-gray-950">H</span>
        Herald
      </div>
      {staging && <span className="rounded-full border border-amber-400/30 bg-amber-400/15 px-2 text-[10.5px] font-bold tracking-wider text-amber-400">STAGING</span>}
      {tab && (
        <nav data-tour="tabs" className="no-drag ml-1 flex gap-1">
          {TABS.filter((t) => !t.needs || t.needs.some(can)).map((t) => (
            <button key={t.id} data-tour={`tab-${t.id}`} className={`rounded-lg px-3 py-1.5 text-[13.5px] font-medium whitespace-nowrap ${tab === t.id ? 'bg-green-600 text-white' : 'text-gray-300 hover:bg-gray-700 hover:text-white'}`} onClick={() => onTab(t.id)}>
              {t.label}
              {t.id === 'home' && reminders > 0 && (
                <span className="ml-1.5 rounded-full bg-amber-400 px-1.5 text-[11px] font-bold text-gray-900" title={`${reminders} publication${reminders === 1 ? '' : 's'} need${reminders === 1 ? 's' : ''} attention`}>
                  {reminders}
                </span>
              )}
            </button>
          ))}
        </nav>
      )}
      <div className="ml-auto flex h-full items-center">
        {tab && (
          <>
            {online.length > 0 && <div className="mr-2 flex items-center pl-3.5" title={`Also online in Herald: ${online.map((p) => p.name).join(', ')}`}>
              {online.slice(0, 5).map((p) => (
                <span key={p.id} className="-ml-1.5 rounded-md ring-2 ring-gray-900">
                  <Avatar name={p.name} size={24} />
                </span>
              ))}
            </div>}
            {update.phase === 'ready' && (
              <button className="no-drag mr-2 rounded-lg bg-orange-600 px-3 py-1 text-[12.5px] font-semibold whitespace-nowrap text-white" title={`Herald ${update.version} is ready`} onClick={() => window.herald.update.install()}>
                ⬆ Update
              </button>
            )}
            <div ref={menuBox} className="no-drag relative mr-1">
              <button data-tour="profile" className="flex items-center gap-2 rounded-lg py-1 pr-2.5 pl-1.5 text-[13px] hover:bg-gray-700" onClick={() => setMenu(!menu)}>
                <Avatar name={me.name} size={26} />
                <span className="font-semibold text-white">{me.name}</span>
                <span className="text-gray-400">▾</span>
              </button>
              {menu && (
                <div className="absolute top-11 right-0 z-50 w-56 rounded-lg border border-gray-700 bg-gray-800 p-1.5 shadow-2xl">
                  <div className="px-2.5 py-1.5 text-xs text-gray-400">
                    Signed in as <b className="text-white">{ROLE_LABEL[me.role]}</b>
                  </div>
                  <hr className="my-1 border-gray-700" />
                  <button className="block w-full rounded-md px-2.5 py-1.5 text-left text-sm text-gray-300 hover:bg-gray-700 hover:text-white" onClick={() => (onTab('settings'), setMenu(false))}>
                    My time zone…
                  </button>
                  {(can('settings.public') || can('settings.staffCode')) && (
                    <button className="block w-full rounded-md px-2.5 py-1.5 text-left text-sm text-gray-300 hover:bg-gray-700 hover:text-white" onClick={() => (onTab('launcher'), setMenu(false))}>
                      Launcher settings…
                    </button>
                  )}
                  <button className="block w-full rounded-md px-2.5 py-1.5 text-left text-sm text-gray-300 hover:bg-gray-700 hover:text-white" onClick={() => (startTour(), setMenu(false))}>
                    Take the tour
                  </button>
                  <hr className="my-1 border-gray-700" />
                  <button className="block w-full rounded-md px-2.5 py-1.5 text-left text-sm text-gray-300 hover:bg-gray-700 hover:text-white" onClick={() => void signOut()}>
                    Sign out
                  </button>
                  <div className="px-2.5 pt-1 pb-0.5 text-[11px] text-gray-500">Herald {version.replace(/\.0$/, '')}</div>
                </div>
              )}
            </div>
          </>
        )}
        <WindowButtons />
      </div>
    </div>
  )
}

export function WindowButtons() {
  const cls = 'no-drag grid h-full w-[46px] place-items-center text-gray-400 hover:bg-gray-700 hover:text-white'
  return (
    <>
      <button className={cls} onClick={() => window.herald.window.minimize()} aria-label="Minimize">
        —
      </button>
      <button className={cls} onClick={() => window.herald.window.toggleMaximize()} aria-label="Maximize">
        ☐
      </button>
      <button className={`${cls} hover:!bg-red-600`} onClick={() => window.herald.window.close()} aria-label="Close">
        ✕
      </button>
    </>
  )
}
