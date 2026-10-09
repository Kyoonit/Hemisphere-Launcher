/**
 * Herald's own updates, like the launcher's (background download, orange "Update" button), on a SEPARATE channel:
 * the Herald server relays the latest release of the private herald-releases repository to signed-in staff only.
 */
import { app } from 'electron'
import electronUpdater from 'electron-updater'
import type { UpdateState } from '@herald/api'

const { autoUpdater } = electronUpdater
const CHECK_EVERY_MS = 30 * 60_000

let state: UpdateState = { phase: 'idle' }

export function startUpdater(server: string, token: () => string | null, onState: (s: UpdateState) => void): void {
  if (!app.isPackaged) return
  autoUpdater.setFeedURL({ provider: 'generic', url: `${server}/update/` })
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.disableDifferentialDownload = true // the relay serves whole files only
  autoUpdater.logger = { info: (m: unknown) => console.log('[update]', m), warn: (m: unknown) => console.warn('[update]', m), error: (m: unknown) => console.error('[update]', m), debug: () => {} }
  const set = (s: UpdateState) => onState((state = s))
  autoUpdater.on('update-available', (info) => set({ phase: 'downloading', version: info.version }))
  autoUpdater.on('update-downloaded', (info) => set({ phase: 'ready', version: info.version }))
  autoUpdater.on('error', (err) => {
    console.warn('[update] check skipped:', String(err?.message ?? err).slice(0, 200))
    if (state.phase !== 'ready') set({ phase: 'idle' })
  })
  const check = () => {
    const t = token()
    if (!t || state.phase === 'ready') return // only signed-in staff can download
    autoUpdater.requestHeaders = { authorization: `Bearer ${t}` }
    void autoUpdater.checkForUpdates().catch(() => {})
  }
  setTimeout(check, 10_000)
  setInterval(check, CHECK_EVERY_MS).unref()
}

export const updateState = () => state
export const installUpdate = () => state.phase === 'ready' && autoUpdater.quitAndInstall(true, true)
