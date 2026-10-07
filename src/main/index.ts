import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { IPC, LINKS, type AppInfo, type LinkKey } from '@shared/ipc'
import type { ServerStatus } from '@shared/server'
import { getServerStatus, startStatusPolling } from './core/status/serverStatus'
import { getPlaytime } from './core/playtime/playtimeStore'
import {
  addDevOfflineAccount,
  getAccountsState,
  loadAccounts,
  onAccountsChanged,
  refreshAccount,
  signIn,
  signOut,
  switchAccount,
} from './core/auth/accounts'
import { cancelSignIn } from './core/auth/oauth'
import { gameEvents, getGameState, onGameState, play, repair } from './core/game/gameService'
import { getSettings, onSettingsChanged, updateSettings } from './core/settings/settings'
import { recoverSessions } from './core/playtime/playtimeStore'
import { instanceLogPath } from './core/game/install'
import { readInstanceState } from './core/sync/sync'
import { decideUpdate } from '@shared/update'
import { detectSystemJava, inspectJava } from './core/game/java'
import { installedJavaPath } from './core/game/install'
import { getContent } from './core/remote/content'
import { getEnabledMods, setModEnabled } from './core/sync/sync'
import { getModIcons } from './core/remote/modIcons'
import type { ClientSummary } from '@shared/client'

const isId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{32}$/.test(v)

let win: BrowserWindow | null = null
let lastStatus: ServerStatus | null = null

function createWindow(): void {
  win = new BrowserWindow({
    width: 1120,
    height: 700,
    minWidth: 960,
    minHeight: 600,
    frame: false,
    show: false,
    backgroundColor: '#111827',
    title: 'Hemisphere Launcher',
    icon: join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: false,
    },
  })

  win.once('ready-to-show', () => win?.show())
  win.on('maximize', () => win?.webContents.send(IPC.windowMaximizedChanged, true))
  win.on('unmaximize', () => win?.webContents.send(IPC.windowMaximizedChanged, false))
  win.on('closed', () => (win = null))

  // The UI never navigates away or opens windows; external links go through IPC.openLink.
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  ipcMain.on(IPC.windowMinimize, () => win?.minimize())
  ipcMain.on(IPC.windowToggleMaximize, () => (win?.isMaximized() ? win.unmaximize() : win?.maximize()))
  ipcMain.on(IPC.windowClose, () => win?.close())

  ipcMain.on(IPC.openLink, (_e, key: unknown) => {
    if (typeof key === 'string' && Object.hasOwn(LINKS, key)) {
      shell.openExternal(LINKS[key as LinkKey])
    }
  })

  ipcMain.handle(IPC.serverStatusGet, async () => lastStatus ?? (lastStatus = await getServerStatus()))
  ipcMain.handle(IPC.playtimeGet, () => getPlaytime(getAccountsState().activeId ?? 'none'))

  ipcMain.handle(IPC.authState, () => getAccountsState())
  ipcMain.handle(IPC.authSignIn, async (_e, language: unknown) => {
    const result = await signIn(typeof language === 'string' ? language : 'en')
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus() // bring the launcher back after the browser
    }
    return result
  })
  ipcMain.on(IPC.authCancel, () => cancelSignIn())
  ipcMain.handle(IPC.authSwitch, (_e, id: unknown) => (isId(id) ? switchAccount(id) : undefined))
  ipcMain.handle(IPC.authSignOut, (_e, id: unknown) => (isId(id) ? signOut(id) : undefined))
  ipcMain.handle(IPC.authDevOffline, (_e, name: unknown) =>
    addDevOfflineAccount(typeof name === 'string' ? name : ''),
  )

  ipcMain.handle(IPC.gameState, () => getGameState())
  ipcMain.on(IPC.gamePlay, (_e, opts: unknown) => {
    const active = getAccountsState().activeId
    const o = (opts ?? {}) as { target?: unknown; skipWhitelist?: unknown }
    if (active) void play(active, { target: o.target === 'previous' ? 'previous' : 'latest', skipWhitelist: o.skipWhitelist === true })
  })
  ipcMain.handle(IPC.settingsGet, () => getSettings())
  ipcMain.handle(IPC.settingsSet, (_e, patch: unknown) => updateSettings(typeof patch === 'object' && patch ? (patch as object) : {}))
  ipcMain.handle(IPC.gameRepair, (_e, mode: unknown) => repair(mode === 'full' ? 'full' : 'quick'))
  ipcMain.handle(IPC.gameJava, async () => {
    const path = await installedJavaPath()
    const managed = path ? await inspectJava(path, true) : null
    return [...(managed ? [managed] : []), ...(await detectSystemJava())]
  })

  ipcMain.handle(IPC.clientGet, async (): Promise<ClientSummary | null> => {
    try {
      const { manifest, index, source } = await getContent()
      const installed = await readInstanceState()
      const update = decideUpdate(index, installed.clientVersion && installed.minecraft ? { clientVersion: installed.clientVersion, minecraft: installed.minecraft } : null)
      const icons = await getModIcons(manifest.mods.flatMap((m) => (m.source ? [m.source.modrinth.projectId] : [])))
      return {
        clientVersion: manifest.clientVersion,
        minecraft: manifest.minecraft,
        loader: manifest.loader.version,
        source,
        update,
        mods: manifest.mods.map((m) => ({
          id: m.id,
          name: m.name,
          description: m.description,
          category: m.category,
          recommended: m.recommended,
          defaultEnabled: m.defaultEnabled,
          version: m.version,
          size: m.file.size,
          requires: m.requires,
          icon: (m.source && icons[m.source.modrinth.projectId]) || '',
        })),
      }
    } catch {
      return null
    }
  })

  ipcMain.handle(IPC.modsEnabled, async () => getEnabledMods((await getContent()).manifest).catch(() => []))
  ipcMain.handle(IPC.modsSet, async (_e, id: unknown, on: unknown) => {
    if (typeof id !== 'string' || typeof on !== 'boolean') throw new Error('invalid arguments')
    return setModEnabled((await getContent()).manifest, id, on)
  })

  ipcMain.handle(IPC.appInfo, (): AppInfo => ({ version: app.getVersion(), platform: process.platform }))
}

// One launcher at a time: a second start focuses the existing window.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(async () => {
    app.setAppUserModelId('club.hemispheresurvival.launcher')
    await loadAccounts()
    onAccountsChanged(() => win?.webContents.send(IPC.authChanged, getAccountsState()))
    onGameState((s) => win?.webContents.send(IPC.gameStateChanged, s))
    onSettingsChanged((s) => win?.webContents.send(IPC.settingsChanged, s))
    // Launcher window while playing: hide (default), keep, or close. It comes back when the game exits.
    gameEvents.onLaunched = () => {
      const mode = getSettings().onGameStart
      if (mode === 'hide') win?.hide()
      else if (mode === 'close') setTimeout(() => app.quit(), 1500)
    }
    gameEvents.onExited = ({ crashed, anyRunning }) => {
      if (win && (crashed || !anyRunning) && !win.isVisible()) win.show()
      if (crashed) win?.focus()
    }
    gameEvents.onPlaytimeChanged = () => win?.webContents.send(IPC.playtimeChanged)
    void recoverSessions(instanceLogPath(), () => win?.webContents.send(IPC.playtimeChanged))
    registerIpc()
    createWindow()
    startStatusPolling((status) => {
      lastStatus = status
      win?.webContents.send(IPC.serverStatusUpdate, status)
    })
    void refreshAccount() // renew the active session silently in the background
  })

  app.on('window-all-closed', () => app.quit())
}
