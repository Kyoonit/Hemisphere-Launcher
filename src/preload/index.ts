import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type HemisphereApi } from '@shared/ipc'
import type { ServerStatus } from '@shared/server'
import type { AccountsState } from '@shared/auth'
import type { GameState } from '@shared/game'
import type { Settings } from '@shared/settings'
import type { Feed } from '@shared/feed'
import type { ImportProgress } from '@shared/importer'
import type { LauncherUpdateState } from '../shared/launcherUpdate'

const api: HemisphereApi = {
  window: {
    minimize: () => ipcRenderer.send(IPC.windowMinimize),
    toggleMaximize: () => ipcRenderer.send(IPC.windowToggleMaximize),
    close: () => ipcRenderer.send(IPC.windowClose),
    onMaximizedChange: (cb) => {
      const listener = (_e: unknown, maximized: boolean): void => cb(maximized)
      ipcRenderer.on(IPC.windowMaximizedChanged, listener)
      return () => ipcRenderer.removeListener(IPC.windowMaximizedChanged, listener)
    },
  },
  openLink: (key) => ipcRenderer.send(IPC.openLink, key),
  appInfo: () => ipcRenderer.invoke(IPC.appInfo),
  screenshots: {
    list: () => ipcRenderer.invoke(IPC.screenshotsList),
    copy: (name) => ipcRenderer.invoke(IPC.screenshotsCopy, name),
    showInFolder: (name) => ipcRenderer.send(IPC.screenshotsShow, name),
    remove: (name) => ipcRenderer.invoke(IPC.screenshotsDelete, name),
    exportTo: (names) => ipcRenderer.invoke(IPC.screenshotsExport, names),
  },
  backups: {
    list: () => ipcRenderer.invoke(IPC.backupsList),
    create: () => ipcRenderer.invoke(IPC.backupsCreate),
    preview: (id) => ipcRenderer.invoke(IPC.backupsPreview, id),
    restore: (id) => ipcRenderer.invoke(IPC.backupsRestore, id),
    remove: (id) => ipcRenderer.invoke(IPC.backupsDelete, id),
    exportSetup: () => ipcRenderer.invoke(IPC.setupExport),
    pickSetup: () => ipcRenderer.invoke(IPC.setupPick),
    importSetup: (token) => ipcRenderer.invoke(IPC.setupImport, token),
  },
  launcherUpdate: {
    get: () => ipcRenderer.invoke(IPC.launcherUpdateGet),
    onChange: (cb) => {
      const listener = (_e: unknown, state: LauncherUpdateState): void => cb(state)
      ipcRenderer.on(IPC.launcherUpdateChanged, listener)
      return () => ipcRenderer.removeListener(IPC.launcherUpdateChanged, listener)
    },
    check: () => ipcRenderer.invoke(IPC.launcherUpdateCheck),
    install: () => ipcRenderer.send(IPC.launcherUpdateInstall),
  },
  server: {
    getStatus: () => ipcRenderer.invoke(IPC.serverStatusGet),
    onStatus: (cb) => {
      const listener = (_e: unknown, status: ServerStatus): void => cb(status)
      ipcRenderer.on(IPC.serverStatusUpdate, listener)
      return () => ipcRenderer.removeListener(IPC.serverStatusUpdate, listener)
    },
  },
  playtime: {
    get: () => ipcRenderer.invoke(IPC.playtimeGet),
    onChange: (cb) => {
      const listener = (): void => cb()
      ipcRenderer.on(IPC.playtimeChanged, listener)
      return () => ipcRenderer.removeListener(IPC.playtimeChanged, listener)
    },
  },
  feed: {
    get: () => ipcRenderer.invoke(IPC.feedGet),
    onChange: (cb) => {
      const listener = (_e: unknown, feed: Feed): void => cb(feed)
      ipcRenderer.on(IPC.feedChanged, listener)
      return () => ipcRenderer.removeListener(IPC.feedChanged, listener)
    },
    openLink: (newsId) => ipcRenderer.send(IPC.feedOpenLink, newsId),
  },
  system: {
    info: () => ipcRenderer.invoke(IPC.systemInfo),
    preflight: () => ipcRenderer.invoke(IPC.systemPreflight),
    openFolder: (kind) => ipcRenderer.send(IPC.systemOpenFolder, kind),
    copyDiagnostics: () => ipcRenderer.invoke(IPC.systemDiagnostics),
    moveGameDir: (target) => ipcRenderer.invoke(IPC.systemMoveGameDir, target),
    onMoveProgress: (cb) => {
      const listener = (_e: unknown, ratio: number): void => cb(ratio)
      ipcRenderer.on(IPC.systemMoveProgress, listener)
      return () => ipcRenderer.removeListener(IPC.systemMoveProgress, listener)
    },
    pickJava: () => ipcRenderer.invoke(IPC.systemPickJava),
  },
  importer: {
    detect: () => ipcRenderer.invoke(IPC.importDetect),
    chooseFolder: () => ipcRenderer.invoke(IPC.importChoose),
    run: (sourceId, opts) => ipcRenderer.invoke(IPC.importRun, sourceId, opts),
    onProgress: (cb) => {
      const listener = (_e: unknown, p: ImportProgress): void => cb(p)
      ipcRenderer.on(IPC.importProgress, listener)
      return () => ipcRenderer.removeListener(IPC.importProgress, listener)
    },
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    set: (patch) => ipcRenderer.invoke(IPC.settingsSet, patch),
    onChange: (cb) => {
      const listener = (_e: unknown, s: Settings): void => cb(s)
      ipcRenderer.on(IPC.settingsChanged, listener)
      return () => ipcRenderer.removeListener(IPC.settingsChanged, listener)
    },
  },
  auth: {
    getState: () => ipcRenderer.invoke(IPC.authState),
    onChange: (cb) => {
      const listener = (_e: unknown, state: AccountsState): void => cb(state)
      ipcRenderer.on(IPC.authChanged, listener)
      return () => ipcRenderer.removeListener(IPC.authChanged, listener)
    },
    signIn: (language) => ipcRenderer.invoke(IPC.authSignIn, language),
    cancel: () => ipcRenderer.send(IPC.authCancel),
    switchTo: (id) => ipcRenderer.invoke(IPC.authSwitch, id),
    signOut: (id) => ipcRenderer.invoke(IPC.authSignOut, id),
    addDevOffline: (name) => ipcRenderer.invoke(IPC.authDevOffline, name),
  },
  game: {
    getState: () => ipcRenderer.invoke(IPC.gameState),
    onState: (cb) => {
      const listener = (_e: unknown, state: GameState): void => cb(state)
      ipcRenderer.on(IPC.gameStateChanged, listener)
      return () => ipcRenderer.removeListener(IPC.gameStateChanged, listener)
    },
    play: (opts) => ipcRenderer.send(IPC.gamePlay, opts),
    dismissError: () => ipcRenderer.send(IPC.gameDismissError),
    javaInfo: () => ipcRenderer.invoke(IPC.gameJava),
    repair: (mode) => ipcRenderer.invoke(IPC.gameRepair, mode),
  },
  client: {
    get: () => ipcRenderer.invoke(IPC.clientGet),
    enabledMods: () => ipcRenderer.invoke(IPC.modsEnabled),
    setModEnabled: (id, on) => ipcRenderer.invoke(IPC.modsSet, id, on),
    playerMods: () => ipcRenderer.invoke(IPC.modsPlayer),
    setPlayerMod: (file, enabled) => ipcRenderer.invoke(IPC.modsPlayerSet, file, enabled),
    search: (query, offset) => ipcRenderer.invoke(IPC.modsSearch, query, offset),
    install: (projectId, confirmed, versionId) => ipcRenderer.invoke(IPC.modsInstall, projectId, confirmed, versionId ?? null),
    projectVersions: (projectId) => ipcRenderer.invoke(IPC.modsProjectVersions, projectId),
    list: () => ipcRenderer.invoke(IPC.modsList),
    versions: (key) => ipcRenderer.invoke(IPC.modsVersions, key),
    setVersion: (key, versionId, lock) => ipcRenderer.invoke(IPC.modsSetVersion, key, versionId, lock),
    setLock: (key, locked) => ipcRenderer.invoke(IPC.modsSetLock, key, locked),
    remove: (key) => ipcRenderer.invoke(IPC.modsRemove, key),
    backToHemisphere: (key) => ipcRenderer.invoke(IPC.modsBackToHemisphere, key),
    checkUpdates: () => ipcRenderer.invoke(IPC.modsCheckUpdates),
    updateAll: () => ipcRenderer.invoke(IPC.modsUpdateAll),
  },
}

contextBridge.exposeInMainWorld('hemisphere', api)
