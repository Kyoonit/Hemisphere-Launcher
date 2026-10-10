import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LocateFixed } from 'lucide-react'
import { useServerStatus } from '../hooks'
import { WebFrame, WebPageHeader, type WebFramePhase } from '../components/WebFrame'

/** BlueMap wants the dashed form of a player's id */
const dashed = (uuid: string) => (uuid.length === 32 ? `${uuid.slice(0, 8)}-${uuid.slice(8, 12)}-${uuid.slice(12, 16)}-${uuid.slice(16, 20)}-${uuid.slice(20)}` : uuid)

/**
 * Runs in the map's page: follows a player with BlueMap's own camera (it changes map when they change dimension) and
 * comes closer. The map loads its players every second or so: waits up to 10 s for that one. Right after the page
 * loads, BlueMap may still set its start view and drop the follow: checked a moment later, and done again.
 */
const FOLLOW = `async (uuid) => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  for (let i = 0; i < 50; i++) {
    const b = window.bluemap
    const marker = b && b.mapViewer && b.mapViewer.map && b.playerMarkerManager && b.playerMarkerManager.getPlayerMarker(uuid)
    const controls = marker && b.mapViewer.controlsManager.controls
    if (controls && controls.followPlayerMarker) {
      controls.followPlayerMarker(marker)
      await b.followPlayerMarkerWorld()
      b.mapViewer.controlsManager.distance = 120
      await wait(1200)
      const now = b.mapViewer.controlsManager.controls
      if (now && now.data && now.data.followingPlayer && now.data.followingPlayer.playerUuid === uuid) return true
    }
    await wait(200)
  }
  return false
}`

/**
 * The server's BlueMap inside the launcher (needs internet): the 3D map, who is online beside it (a click follows them),
 * and the same view in the browser. `follow`: the player to follow once the map is there (from a player card).
 */
export default function MapScreen({ follow, onBack }: { follow: string | null; onBack(): void }) {
  const { t } = useTranslation()
  const status = useServerStatus()
  const view = useRef<PageWebview>(null)
  const [phase, setPhase] = useState<WebFramePhase>('checking')
  const [following, setFollowing] = useState<string | null>(follow)
  const [missing, setMissing] = useState<string | null>(null)

  const followPlayer = useCallback((uuid: string) => {
    setFollowing(uuid)
    setMissing(null)
    void view.current
      ?.executeJavaScript(`(${FOLLOW})(${JSON.stringify(dashed(uuid))})`)
      .then((found) => !found && setMissing(uuid))
      .catch(() => setMissing(uuid))
  }, [])

  const openInBrowser = () => {
    let hash = ''
    try {
      hash = phase === 'ready' && view.current ? new URL(view.current.getURL()).hash : ''
    } catch {
      /* the map's start view */
    }
    window.hemisphere.pages.openInBrowser('map', hash)
  }

  const players = status?.online ? status.players : []
  // online but not on the map (hidden from it, or no list of names)
  const unseen = status?.online && status.playersOnline != null ? Math.max(0, status.playersOnline - players.length) : 0

  return (
    <div className="flex h-full flex-col px-8 pt-5 pb-1">
      <WebPageHeader title={t('map.title')} ready={phase === 'ready'} onBack={onBack} onReload={() => view.current?.reload()} onOpenInBrowser={openInBrowser} />

      <div className="flex min-h-0 flex-1 gap-3">
        {/* who is online: a click follows them on the map */}
        <aside className="glass flex w-56 flex-none flex-col p-3">
          <p className="mb-2 flex items-center justify-between text-xs font-bold tracking-[0.08em] text-gray-400 uppercase">
            {t('map.online')}
            {status?.playersOnline != null && <span className="font-normal tracking-normal tabular-nums">{status.playersOnline}</span>}
          </p>
          {players.length === 0 ? (
            <p className="rounded-md bg-gray-900/50 px-3 py-2 text-[13px] text-gray-400">{status?.online === false ? t('server.offline') : t('server.nobody')}</p>
          ) : (
            <div className="-mr-1 min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1 [scrollbar-color:var(--color-gray-600)_transparent] [scrollbar-width:thin]">
              {players.map((p) => (
                <button
                  key={p.uuid}
                  onClick={() => followPlayer(p.uuid)}
                  disabled={phase !== 'ready'}
                  title={t('map.follow', { name: p.name })}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors disabled:opacity-60 ${following === p.uuid ? 'bg-green-900/50 text-white' : 'text-gray-200 hover:bg-gray-700/60'}`}
                >
                  <img src={`https://mc-heads.net/avatar/${p.uuid}/40`} alt="" className="size-5 flex-none rounded-[3px] bg-gray-700 [image-rendering:pixelated]" draggable={false} />
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  {following === p.uuid ? <LocateFixed size={14} className="flex-none text-green-400" /> : p.dimension && <span className="flex-none text-[11px] text-gray-500">{t(`map.dimension.${p.dimension}`)}</span>}
                </button>
              ))}
            </div>
          )}
          {unseen > 0 && <p className="mt-2 text-[12px] text-gray-500">{t('map.notOnMap', { count: unseen })}</p>}
          {missing && <p className="mt-2 text-[12px] text-amber-300">{t('map.hidden')}</p>}
        </aside>

        <WebFrame page="map" view={view} onPhase={setPhase} onLoaded={() => following && followPlayer(following)} />
      </div>
    </div>
  )
}
