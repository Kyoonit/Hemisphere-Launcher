
import { app, BrowserWindow, dialog, shell } from 'electron'
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
import { dismissGameError, gameEvents, getGameState, onGameState, play, repair } from './core/game/gameService'
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
import { getFeed, startFeedPolling } from './core/remote/feed'
import { installFileLogger } from './core/logging/logger'
import { copyDiagnostics, moveGameFolder, openFolder, systemInfo, type FolderKind } from './core/system/system'
import { detectSources, importFrom, playerMods, setPlayerModEnabled, sourceFromFolder } from './core/importer/importer'
import type { ImportOptions, ImportSource } from '@shared/importer'
import type { ClientSummary } from '@shared/client'
import { loadWindowState, trackWindowState } from './core/system/windowState'
import { handle, hardenApp, on, trustWindow } from './security'

const isId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{32}$/.test(v)

let win: BrowserWindow | null = null
let lastStatus: ServerStatus | null = null
/** Sources the player may import from: only ones the launcher found or the player picked in the dialog. */
const importSources = new Map<string, ImportSource>()

function createWindow(): void {
  const saved = loadWindowState()
  win = new BrowserWindow({
    width: 1120,
    height: 700,
    ...saved?.bounds,
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

  trustWindow(win)
  trackWindowState(win, saved)
  win.once('ready-to-show', () => {
    if (saved?.maximized) win?.maximize()
    win?.show()
  })
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
  on(IPC.windowMinimize, () => win?.minimize())
  on(IPC.windowToggleMaximize, () => (win?.isMaximized() ? win.unmaximize() : win?.maximize()))
  on(IPC.windowClose, () => win?.close())

  on(IPC.openLink, (_e, key: unknown) => {
    if (typeof key === 'string' && Object.hasOwn(LINKS, key)) {
      shell.openExternal(LINKS[key as LinkKey])
    }
  })

  handle(IPC.serverStatusGet, async () => lastStatus ?? (lastStatus = await getServerStatus()))
  handle(IPC.playtimeGet, () => getPlaytime(getAccountsState().activeId ?? 'none'))

  handle(IPC.authState, () => getAccountsState())
  handle(IPC.authSignIn, async (_e, language: unknown) => {
    const result = await signIn(typeof language === 'string' ? language : 'en')
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus() // bring the launcher back after the browser
    }
    return result
  })
  on(IPC.authCancel, () => cancelSignIn())
  handle(IPC.authSwitch, (_e, id: unknown) => (isId(id) ? switchAccount(id) : undefined))
  handle(IPC.authSignOut, (_e, id: unknown) => (isId(id) ? signOut(id) : undefined))
  handle(IPC.authDevOffline, (_e, name: unknown) =>
    addDevOfflineAccount(typeof name === 'string' ? name : ''),
  )

  handle(IPC.gameState, () => getGameState())
  on(IPC.gameDismissError, () => dismissGameError())
  on(IPC.gamePlay, (_e, opts: unknown) => {
    const active = getAccountsState().activeId
    const o = (opts ?? {}) as { target?: unknown; withoutPlayerMods?: unknown }
    if (active) void play(active, { target: o.target === 'previous' ? 'previous' : 'latest', withoutPlayerMods: o.withoutPlayerMods === true })
  })
  handle(IPC.systemInfo, () => systemInfo())
  on(IPC.systemOpenFolder, (_e, kind: unknown) => {
    const kinds: FolderKind[] = ['game', 'mods', 'screenshots', 'gameLogs', 'crashReports', 'launcherLogs']
    if (kinds.includes(kind as FolderKind)) void openFolder(kind as FolderKind)
  })
  handle(IPC.systemDiagnostics, () => copyDiagnostics())
  handle(IPC.systemMoveGameDir, async (_e, target: unknown) => {
    let dir = systemInfo().defaultGameDir
    if (target === 'choose') {
      const pick = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'], title: 'Hemisphere game folder' })
      if (pick.canceled || !pick.filePaths[0]) return { ok: false, cancelled: true }
      dir = pick.filePaths[0]
    }
    const g = getGameState()
    let last = 0
    return moveGameFolder(dir, g.phase === 'preparing' || g.runningAccounts.length > 0, (ratio) => {
      if (ratio === 1 || ratio - last >= 0.01) {
        last = ratio
        win?.webContents.send(IPC.systemMoveProgress, ratio)
      }
    })
  })
  handle(IPC.systemPickJava, async () => {
    const pick = await dialog.showOpenDialog(win!, { properties: ['openFile'], filters: [{ name: 'Java', extensions: ['exe'] }], title: 'javaw.exe' })
    if (pick.canceled || !pick.filePaths[0]) return { ok: false, cancelled: true }
    const path = pick.filePaths[0]
    if (!/javaw?.exe$/i.test(path)) return { ok: false, reason: 'notJava' }
    const info = await inspectJava(path, false)
    if (!info) return { ok: false, reason: 'notJava' }
    await updateSettings({ javaPath: path })
    return { ok: true, version: info.version, majorVersion: info.majorVersion }
  })
  handle(IPC.importDetect, () => {
    const found = detectSources()
    for (const s of found) importSources.set(s.id, s)
    return found
  })
  handle(IPC.importChoose, async () => {
    const pick = await dialog.showOpenDialog(win!, { properties: ['openDirectory'], title: 'Minecraft folder' })
    if (pick.canceled || !pick.filePaths[0]) return null
    const src = sourceFromFolder(pick.filePaths[0])
    if (!src) return 'nothing'
    importSources.set(src.id, src)
    return src
  })
  handle(IPC.importRun, async (_e, id: unknown, opts: unknown) => {
    const source = typeof id === 'string' ? importSources.get(id) : undefined
    if (!source) return { ok: false, reason: 'unknownSource' }
    const g = getGameState()
    if (g.phase === 'preparing' || g.runningAccounts.length) return { ok: false, reason: 'busy' }
    const o = (opts ?? {}) as Record<string, unknown>
    const options: ImportOptions = { settings: !!o.settings, servers: !!o.servers, resourcepacks: !!o.resourcepacks, shaderpacks: !!o.shaderpacks, config: !!o.config, mods: !!o.mods }
    try {
      const { manifest } = await getContent()
      const report = await importFrom(source, options, manifest, (p) => win?.webContents.send(IPC.importProgress, p))
      return { ok: true, report }
    } catch (err) {
      console.error('[import] failed:', err)
      return { ok: false, reason: 'failed', detail: String(err) }
    }
  })
  handle(IPC.modsPlayer, async () => playerMods(Object.keys((await readInstanceState()).owned)))
  handle(IPC.modsPlayerSet, async (_e, file: unknown, enabled: unknown) => {
    const g = getGameState()
    if (typeof file !== 'string' || typeof enabled !== 'boolean' || g.runningAccounts.length) return false
    return setPlayerModEnabled(file, enabled, Object.keys((await readInstanceState()).owned))
  })
  handle(IPC.feedGet, () => getFeed())
  on(IPC.feedOpenLink, (_e, id: unknown) => {
    const url = getFeed().news.find((n) => n.id === id)?.link?.url
    if (url?.startsWith('https://')) void shell.openExternal(url)
  })
  handle(IPC.settingsGet, () => getSettings())
  handle(IPC.settingsSet, async (_e, patch: unknown) => {
    // gameDir is only changed through the move (files must follow); javaPath only through the picker (validated).
    const { gameDir: _g, javaPath, ...rest } = (typeof patch === 'object' && patch ? patch : {}) as Record<string, unknown>
    return updateSettings({ ...rest, ...(javaPath === null ? { javaPath: null } : {}) })
  })
  handle(IPC.gameRepair, (_e, mode: unknown) => repair(mode === 'full' ? 'full' : 'quick'))
  handle(IPC.gameJava, async () => {
    const path = await installedJavaPath()
    const managed = path ? await inspectJava(path, true) : null
    return [...(managed ? [managed] : []), ...(await detectSystemJava())]
  })

  handle(IPC.clientGet, async (): Promise<ClientSummary | null> => {
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

  handle(IPC.modsEnabled, async () => getEnabledMods((await getContent()).manifest).catch(() => []))
  handle(IPC.modsSet, async (_e, id: unknown, on: unknown) => {
    if (typeof id !== 'string' || typeof on !== 'boolean') throw new Error('invalid arguments')
    return setModEnabled((await getContent()).manifest, id, on)
  })

  handle(IPC.appInfo, (): AppInfo => ({ version: app.getVersion(), platform: process.platform }))
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
    installFileLogger()
    hardenApp()
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
    startFeedPolling((feed) => win?.webContents.send(IPC.feedChanged, feed))
  })

  app.on('window-all-closed', () => app.quit())
}
