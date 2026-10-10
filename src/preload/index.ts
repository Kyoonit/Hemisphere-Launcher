import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type HemisphereApi } from '@shared/ipc'
import type { ServerStatus } from '@shared/server'
import type { AccountsState } from '@shared/auth'
import type { GameState } from '@shared/game'
import type { Settings } from '@shared/settings'
import type { FeedView } from '@shared/schedule'
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
  modSets: {
    list: () => ipcRenderer.invoke(IPC.setsList),
    save: (name) => ipcRenderer.invoke(IPC.setsSave, name),
    switchTo: (id, fallbackName) => ipcRenderer.invoke(IPC.setsSwitch, id, fallbackName),
    rename: (id, name) => ipcRenderer.invoke(IPC.setsRename, id, name),
    remove: (id) => ipcRenderer.invoke(IPC.setsDelete, id),
    duplicate: (id) => ipcRenderer.invoke(IPC.setsDuplicate, id),
    share: (id) => ipcRenderer.invoke(IPC.setsShare, id),
    importCode: (code) => ipcRenderer.invoke(IPC.setsImport, code),
  },
  modHistory: {
    list: () => ipcRenderer.invoke(IPC.historyList),
    undo: (id) => ipcRenderer.invoke(IPC.historyUndo, id),
  },
  packs: {
    list: (type) => ipcRenderer.invoke(IPC.packsList, type),
    setActive: (type, file, on) => ipcRenderer.invoke(IPC.packsSetActive, type, file, on),
    shadersOff: () => ipcRenderer.invoke(IPC.packsShadersOff),
    enableIris: () => ipcRenderer.invoke(IPC.packsEnableIris),
    move: (file, delta) => ipcRenderer.invoke(IPC.packsMove, file, delta),
    remove: (type, file) => ipcRenderer.invoke(IPC.packsRemove, type, file),
    versions: (type, file) => ipcRenderer.invoke(IPC.packsVersions, type, file),
    setVersion: (type, file, versionId, lock) => ipcRenderer.invoke(IPC.packsSetVersion, type, file, versionId, lock),
    setLock: (type, file, locked) => ipcRenderer.invoke(IPC.packsSetLock, type, file, locked),
    checkUpdates: (type) => ipcRenderer.invoke(IPC.packsCheckUpdates, type),
    updateAll: (type) => ipcRenderer.invoke(IPC.packsUpdateAll, type),
    search: (type, query, offset) => ipcRenderer.invoke(IPC.packsSearch, type, query, offset),
    projectVersions: (type, projectId) => ipcRenderer.invoke(IPC.packsProjectVersions, type, projectId),
    install: (type, projectId, confirmed, versionId) => ipcRenderer.invoke(IPC.packsInstall, type, projectId, confirmed, versionId ?? null),
  },
  restart: {
    live: () => ipcRenderer.invoke(IPC.restartLiveGet),
    onChange: (cb) => {
      const listener = (_e: unknown, live: Parameters<typeof cb>[0]) => cb(live)
      ipcRenderer.on(IPC.restartLiveChanged, listener)
      return () => ipcRenderer.removeListener(IPC.restartLiveChanged, listener)
    },
  },
  dev: {
    get: () => ipcRenderer.invoke(IPC.devGet),
    unlock: (code) => ipcRenderer.invoke(IPC.devUnlock, code),
    unlockWait: () => ipcRenderer.invoke(IPC.devUnlockWait),
    checkDiscord: (id) => ipcRenderer.invoke(IPC.devCheckDiscord, id),
    lock: () => ipcRenderer.invoke(IPC.devLock),
    onAccessChanged: (cb) => {
      const listener = () => cb()
      ipcRenderer.on(IPC.devAccessChanged, listener)
      return () => ipcRenderer.removeListener(IPC.devAccessChanged, listener)
    },
    perf: () => ipcRenderer.invoke(IPC.devPerf),
    set: (patch) => ipcRenderer.invoke(IPC.devSet, patch),
    action: (action) => ipcRenderer.invoke(IPC.devAction, action),
  },
  events: {
    addToCalendar: (id) => ipcRenderer.send(IPC.eventsAddToCalendar, id),
    setReminder: (id, on) => ipcRenderer.invoke(IPC.eventsSetReminder, id, on),
  },
  report: {
    prepare: () => ipcRenderer.invoke(IPC.reportPrepare),
    build: (draft) => ipcRenderer.invoke(IPC.reportBuild, draft),
    showInFolder: () => ipcRenderer.send(IPC.reportShow),
    startDrag: () => ipcRenderer.send(IPC.reportDrag),
    copyMessage: (message) => ipcRenderer.send(IPC.reportCopy, message),
    openSupport: () => ipcRenderer.send(IPC.reportOpenSupport),
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
    watchSlot: (on) => ipcRenderer.invoke(IPC.serverWatchSlot, on),
    slotWatched: () => ipcRenderer.invoke(IPC.serverSlotWatched),
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
      const listener = (_e: unknown, feed: FeedView): void => cb(feed)
      ipcRenderer.on(IPC.feedChanged, listener)
      return () => ipcRenderer.removeListener(IPC.feedChanged, listener)
    },
    openLink: (newsId) => ipcRenderer.send(IPC.feedOpenLink, newsId),
  },
  system: {
    info: () => ipcRenderer.invoke(IPC.systemInfo),
    preflight: () => ipcRenderer.invoke(IPC.systemPreflight),
    lowEnd: () => ipcRenderer.invoke(IPC.systemLowEnd),
    cleanupScan: () => ipcRenderer.invoke(IPC.systemCleanupScan),
    cleanupRun: () => ipcRenderer.invoke(IPC.systemCleanupRun),
    metered: () => ipcRenderer.invoke(IPC.systemMetered),
    notificationsBlocked: () => ipcRenderer.invoke(IPC.systemNotificationsBlocked),
    openNotificationSettings: () => ipcRenderer.send(IPC.systemOpenNotificationSettings),
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
  skins: {
    get: (id, refresh) => ipcRenderer.invoke(IPC.skinsGet, id ?? null, !!refresh),
    onChange: (cb) => {
      const listener = (_e: unknown, id: string): void => cb(id)
      ipcRenderer.on(IPC.skinsChanged, listener)
      return () => ipcRenderer.removeListener(IPC.skinsChanged, listener)
    },
    wardrobe: (capes) => ipcRenderer.invoke(IPC.skinsWardrobe, capes !== false),
    importFile: () => ipcRenderer.invoke(IPC.skinsImportFile),
    importPlayer: (name) => ipcRenderer.invoke(IPC.skinsImportPlayer, name),
    edit: (hash, patch) => ipcRenderer.invoke(IPC.skinsEdit, hash, patch),
    keep: (hash, name) => ipcRenderer.invoke(IPC.skinsKeep, hash, name),
    remove: (hash) => ipcRenderer.invoke(IPC.skinsRemove, hash),
    wear: (hash, slim) => ipcRenderer.invoke(IPC.skinsWear, hash, slim),
    cape: (id) => ipcRenderer.invoke(IPC.skinsCape, id),
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
    recap: () => ipcRenderer.invoke(IPC.gameRecap),
    dismissRecap: () => ipcRenderer.send(IPC.gameDismissRecap),
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
