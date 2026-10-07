import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { IPC, LINKS, type AppInfo, type LinkKey } from '@shared/ipc'
import type { ServerStatus } from '@shared/server'
import { getServerStatus, startStatusPolling } from './core/status/serverStatus'
import { getPlaytime } from './core/playtime/playtimeStore'

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
  // Until accounts exist (Phase 6), playtime is tracked under a single local profile.
  ipcMain.handle(IPC.playtimeGet, () => getPlaytime('local'))

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

  app.whenReady().then(() => {
    app.setAppUserModelId('club.hemispheresurvival.launcher')
    registerIpc()
    createWindow()
    startStatusPolling((status) => {
      lastStatus = status
      win?.webContents.send(IPC.serverStatusUpdate, status)
    })
  })

  app.on('window-all-closed', () => app.quit())
}
