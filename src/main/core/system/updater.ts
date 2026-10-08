import { app } from 'electron'
import electronUpdater from 'electron-updater'
import type { LauncherUpdateState as UpdateState } from '@shared/launcherUpdate'
import { backgroundDownloadsAllowed } from './network'

/**
 * Launcher updates from GitHub releases: checked at start and every 4 hours, downloaded in the background,
 * installed when the player clicks "Restart to update" or, at the latest, silently when the launcher closes.
 * The game is a separate process, so updating the launcher never interrupts a running game.
 */
const { autoUpdater } = electronUpdater
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000

let state: UpdateState = app.isPackaged ? { phase: 'idle', checkedAt: null } : { phase: 'disabled' }
let listener: (s: UpdateState) => void = () => {}

function set(next: UpdateState): void {
  state = next
  listener(state)
}

export const getUpdateState = (): UpdateState => state
export function onUpdateState(cb: (s: UpdateState) => void): void {
  listener = cb
}

export function startUpdater(): void {
  if (!app.isPackaged) return
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = false
  autoUpdater.logger = { info: (m: unknown) => console.log('[update]', m), warn: (m: unknown) => console.warn('[update]', m), error: (m: unknown) => console.error('[update]', m), debug: () => {} }

  autoUpdater.on('checking-for-update', () => state.phase !== 'ready' && set({ phase: 'checking' }))
  autoUpdater.on('update-not-available', () => set({ phase: 'idle', checkedAt: Date.now() }))
  autoUpdater.on('update-available', (info) => set({ phase: 'downloading', version: info.version, ratio: 0 }))
  autoUpdater.on('download-progress', (p) => state.phase === 'downloading' && set({ ...state, ratio: Math.min(1, p.percent / 100) }))
  autoUpdater.on('update-downloaded', (info) => set({ phase: 'ready', version: info.version }))
  autoUpdater.on('error', (err) => {
    const message = String(err?.message ?? err).slice(0, 300)
    if (state.phase === 'ready') return
    // Offline, GitHub not answering, or no release published yet: nothing the player can do, so no red badge
    // (tried again at the next check). Only an update that failed while downloading is shown.
    if (state.phase !== 'downloading' && /\b404\b|latest\.yml|No published versions|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|ECONNREFUSED|net::ERR_|socket hang up/i.test(message)) {
      console.warn('[update] check skipped:', message)
      set({ phase: 'idle', checkedAt: null })
      return
    }
    set({ phase: 'error', message })
  })

  // automatic checks wait for a normal connection (metered: only when the player asks in Settings)
  const auto = async () => {
    if (await backgroundDownloadsAllowed()) void checkForUpdates()
  }
  setTimeout(() => void auto(), 10_000)
  setInterval(() => void auto(), CHECK_EVERY_MS).unref()
}

export async function checkForUpdates(): Promise<UpdateState> {
  if (!app.isPackaged || state.phase === 'checking' || state.phase === 'downloading' || state.phase === 'ready') return state
  try {
    await autoUpdater.checkForUpdates()
  } catch {
    /* reported through the 'error' event */
  }
  return state
}

/** Closes the launcher, installs the downloaded update silently and starts the new version. */
export function installUpdateNow(): void {
  if (state.phase === 'ready') autoUpdater.quitAndInstall(true, true)
}
