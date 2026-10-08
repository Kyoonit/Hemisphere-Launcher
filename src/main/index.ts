
import { app, BrowserWindow, clipboard, dialog, nativeImage, shell } from 'electron'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { gamePaths } from './core/game/target'
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
import { dismissGameError, gameEvents, getGameState, onGameState, play, prepareInBackground, repair, withModsHeld } from './core/game/gameService'
import { getSettings, onSettingsChanged, updateSettings } from './core/settings/settings'
import { AUTOSTART_ARG } from '@shared/settings'
import { recoverSessions } from './core/playtime/playtimeStore'
import { instanceLogPath } from './core/game/install'
import { readInstanceState } from './core/sync/sync'
import { decideUpdate } from '@shared/update'
import { detectSystemJava, inspectJava } from './core/game/java'
import { installedJavaPath } from './core/game/install'
import { getContent } from './core/remote/content'
import { getEnabledMods, reattachMod, setModEnabled } from './core/sync/sync'
import { getModIcons } from './core/remote/modIcons'
import { getFeed, startFeedPolling } from './core/remote/feed'
import { installFileLogger } from './core/logging/logger'
import { copyDiagnostics, moveGameFolder, openFolder, preflightWarnings, systemInfo, type FolderKind } from './core/system/system'
import { detectGpus } from './core/system/gpu'
import { detectSources, importFrom, setPlayerModEnabled, sourceFromFolder } from './core/importer/importer'
import { canEnablePlayerMod, hemisphereMods, installMod, knownPlayerProjects, listPlayerMods, playerJars } from './core/modrinth/playerMods'
import { backToHemisphere, checkAllUpdates, listHistory, listMods, undoHistory, removeFor, setLockFor, setVersionFor, updateAll, versionsFor } from './core/modrinth/allMods'
import { pickVersion, projectVersions, safeIcon, searchMods } from './core/modrinth/api'
import { MODRINTH_ID, policyFor, type InstallResult, type ModItem, type ModSearchResult, type ModVersionChoice, type SetVersionResult, type UpdateApplied, type UpdateCheck } from '@shared/modBrowser'
import type { ClientManifest } from '@shared/manifest'
import type { ImportOptions, ImportSource } from '@shared/importer'
import type { ClientSummary } from '@shared/client'
import { loadWindowState, trackWindowState } from './core/system/windowState'
import { handle, hardenApp, on, trustWindow } from './security'
import { copyScreenshot, deleteScreenshot, exportScreenshots, listScreenshots, registerScreenshotScheme, serveScreenshots, showScreenshotInFolder } from './core/system/screenshots'
import { checkForUpdates, getUpdateState, installUpdateNow, onUpdateState, startUpdater } from './core/system/updater'
import { createRestorePoint, deleteRestorePoint, isRestorePointId, listRestorePoints, previewRestore, restorePoint } from './core/backup/restorePoints'
import { checkPackUpdates, installPack, knownPackProjects, listPacks, moveResourcePack, packVersions, removePack, setPackActive, setPackLock, setPackVersion, shadersOff, updatePacks } from './core/packs/packs'
import { PACK_TYPES, type PackType } from '@shared/packs'
import { buildReport, lastReportZip, prepareReport } from './core/support/report'
import { keepInTrayOnClose, onCommunitySettings, onGameExited, onGameLaunched, onServerStatus, startCommunity } from './core/community/community'
import { eventIcs } from '@shared/events'
import { writeFile } from 'node:fs/promises'
import { REPORT_CATEGORIES, REPORT_FREQUENCY, REPORT_PARTS, REPORT_WHEN, type ReportDraft } from '@shared/report'
import { deleteSet, duplicateSet, importSetCode, isSetId, listSets, renameSet, saveSet, shareSet, switchSet } from './core/backup/modSets'
import { exportSetup, importSetup, readSetup, rememberSetup, SETUP_EXTENSION, summarize, takeSetup } from './core/backup/setup'

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
  keepInTrayOnClose(win)
  win.once('ready-to-show', () => {
    if (saved?.maximized) win?.maximize()
    // Started with Windows: stay out of the way (in the tray when the player keeps it there, else the taskbar).
    if (process.argv.includes(AUTOSTART_ARG)) {
      if (!getSettings().closeToTray) win?.minimize()
    }
    else win?.show()
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
  handle(IPC.screenshotsList, () => listScreenshots())
  handle(IPC.screenshotsCopy, (_e, name: unknown) => (typeof name === 'string' ? copyScreenshot(name) : false))
  on(IPC.screenshotsShow, (_e, name: unknown) => typeof name === 'string' && showScreenshotInFolder(name))
  handle(IPC.screenshotsDelete, (_e, name: unknown) => (typeof name === 'string' ? deleteScreenshot(name) : false))
  handle(IPC.screenshotsExport, async (_e, names: unknown) => {
    if (!Array.isArray(names) || !names.length) return null
    const pick = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'], title: 'Copy screenshots to' })
    if (pick.canceled || !pick.filePaths[0]) return null
    return exportScreenshots(names.filter((n): n is string => typeof n === 'string'), pick.filePaths[0])
  })
  handle(IPC.systemPreflight, () => preflightWarnings())
  on(IPC.systemOpenFolder, (_e, kind: unknown) => {
    const kinds: FolderKind[] = ['game', 'mods', 'resourcepacks', 'shaderpacks', 'screenshots', 'gameLogs', 'crashReports', 'launcherLogs']
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
    return moveGameFolder(dir, g.phase === 'preparing' || g.background || g.runningAccounts.length > 0, (ratio) => {
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
    if (g.phase === 'preparing' || g.background || g.runningAccounts.length) return { ok: false, reason: 'busy' }
    const o = (opts ?? {}) as Record<string, unknown>
    const options: ImportOptions = { settings: !!o.settings, servers: !!o.servers, resourcepacks: !!o.resourcepacks, shaderpacks: !!o.shaderpacks, config: !!o.config, mods: !!o.mods }
    try {
      const { manifest } = await getContent()
      await createRestorePoint({ kind: 'import' }, { clientVersion: manifest.clientVersion, minecraft: manifest.minecraft })
      const report = await importFrom(source, options, manifest, (p) => win?.webContents.send(IPC.importProgress, p))
      return { ok: true, report }
    } catch (err) {
      console.error('[import] failed:', err)
      return { ok: false, reason: 'failed', detail: String(err) }
    }
  })
  const detachedSet = async () => new Set((await readInstanceState()).detached)
  handle(IPC.modsPlayer, async () => {
    const content = await getContent().catch(() => null)
    const hemisphere = content ? hemisphereMods(content.manifest, await detachedSet()) : null
    return listPlayerMods(Object.keys((await readInstanceState()).owned), getFeed().modPolicy, hemisphere, content?.manifest.minecraft ?? null)
  })
  // Changing mods while the game runs (or while the launcher is installing) is refused.
  const modsBusy = () => {
    const g = getGameState()
    return g.phase === 'preparing' || g.background || g.runningAccounts.length > 0
  }
  /** Mod keys from the interface: "h:<Hemisphere mod id>" or "p:<file name>". */
  const isModKey = (k: unknown): k is string => typeof k === 'string' && /^(h:[a-z0-9-]{1,64}|p:[^\\/:*?"<>|]{1,200}\.jar)$/i.test(k)
  const withManifest = async <T,>(fallback: T, job: (manifest: ClientManifest) => Promise<T>): Promise<T> => {
    try {
      return await job((await getContent()).manifest)
    } catch (err) {
      console.warn('[mods]', err)
      return fallback
    }
  }

  handle(IPC.modsList, () => withManifest<ModItem[] | null>(null, (m) => listMods(m, getFeed().modPolicy)))
  handle(IPC.modsVersions, (_e, key: unknown) => (isModKey(key) ? withManifest<ModVersionChoice[] | null>(null, (m) => versionsFor(m, key)) : null))
  handle(IPC.modsSetVersion, async (_e, key: unknown, versionId: unknown, lock: unknown): Promise<SetVersionResult> => {
    if (!isModKey(key) || typeof versionId !== 'string' || !MODRINTH_ID.test(versionId)) return { ok: false, reason: 'notFound' }
    if (modsBusy()) return { ok: false, reason: 'busy' }
    return withManifest<SetVersionResult>({ ok: false, reason: 'network' }, (m) => setVersionFor(m, key, versionId, lock === true))
  })
  handle(IPC.modsSetLock, async (_e, key: unknown, locked: unknown) => {
    if (!isModKey(key) || typeof locked !== 'boolean' || modsBusy()) return false
    return withManifest(false, (m) => setLockFor(m, key, locked))
  })
  handle(IPC.modsRemove, async (_e, key: unknown) => {
    if (!isModKey(key) || modsBusy()) return false
    return withManifest(false, (m) => removeFor(m, key))
  })
  handle(IPC.modsBackToHemisphere, async (_e, key: unknown) => {
    if (!isModKey(key) || modsBusy()) return false
    const ok = await withManifest(false, (m) => backToHemisphere(m, key))
    if (ok) void prepareInBackground() // place Hemisphere's version now rather than at the next PLAY
    return ok
  })
  handle(IPC.modsCheckUpdates, () => withManifest<UpdateCheck | null>(null, (m) => checkAllUpdates(m)))
  handle(IPC.modsUpdateAll, async () => (modsBusy() ? null : withManifest<UpdateApplied | null>(null, (m) => updateAll(m))))

  handle(IPC.modsSearch, async (_e, query: unknown, offset: unknown): Promise<ModSearchResult | null> => {
    if (typeof query !== 'string' || typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0 || offset > 10_000) return null
    try {
      const { manifest } = await getContent()
      const hemisphere = hemisphereMods(manifest, await detachedSet()).projects
      // Browsing (no search text): leave out what Hemisphere already manages. A search by name still shows it, marked.
      const res = await searchMods(query, manifest.minecraft, offset, query.trim() ? [] : [...hemisphere])
      const mine = knownPlayerProjects()
      const policy = getFeed().modPolicy
      return {
        minecraft: manifest.minecraft,
        total: res.total_hits,
        offset: res.offset,
        hits: res.hits.map((h) => ({
          projectId: h.project_id,
          slug: h.slug,
          title: h.title,
          description: h.description.slice(0, 300),
          author: h.author,
          icon: safeIcon(h.icon_url),
          downloads: h.downloads,
          ...policyFor(policy, h.project_id),
          state: hemisphere.has(h.project_id) ? 'inHemisphere' : mine.has(h.project_id) ? 'installed' : 'available',
        })),
      }
    } catch (err) {
      console.warn('[mods] search failed:', err)
      return null
    }
  })
  handle(IPC.modsProjectVersions, async (_e, projectId: unknown): Promise<ModVersionChoice[] | null> => {
    if (typeof projectId !== 'string' || !MODRINTH_ID.test(projectId)) return null
    return withManifest<ModVersionChoice[] | null>(null, async (m) => {
      const versions = (await projectVersions(projectId, m.minecraft)).sort((a, b) => b.date_published.localeCompare(a.date_published))
      const latest = pickVersion(versions)
      return versions.slice(0, 60).map((v) => ({
        id: v.id,
        versionNumber: v.version_number,
        name: v.name,
        type: v.version_type,
        published: v.date_published,
        current: false,
        latest: v.id === latest?.id,
        locked: false,
      }))
    })
  })
  handle(IPC.modsInstall, async (_e, projectId: unknown, confirmed: unknown, versionId: unknown): Promise<InstallResult> => {
    if (typeof projectId !== 'string' || !MODRINTH_ID.test(projectId)) return { ok: false, reason: 'notCompatible' }
    if (versionId !== undefined && versionId !== null && (typeof versionId !== 'string' || !MODRINTH_ID.test(versionId))) return { ok: false, reason: 'notCompatible' }
    if (modsBusy()) return { ok: false, reason: 'busy' }
    const { manifest } = await getContent()
    const state = await readInstanceState()
    return installMod(projectId, confirmed === true, manifest, Object.keys(state.owned), getFeed().modPolicy, new Set(state.detached), (versionId as string | null) ?? null)
  })
  handle(IPC.modsPlayerSet, async (_e, file: unknown, enabled: unknown) => {
    const g = getGameState()
    if (typeof file !== 'string' || typeof enabled !== 'boolean' || g.runningAccounts.length) return false
    // A copy of a mod Hemisphere still manages stays off until it's removed.
    if (enabled && !canEnablePlayerMod(file, (await getContent()).manifest, await detachedSet())) return false
    return setPlayerModEnabled(file, enabled, Object.keys((await readInstanceState()).owned))
  })
  // Safety nets. Restoring or importing changes mods and settings: refused while the game runs or the launcher installs.
  const clientInfo = async () => {
    const m = await getContent()
      .then((c) => c.manifest)
      .catch(() => null)
    return m ? { manifest: m, client: { clientVersion: m.clientVersion, minecraft: m.minecraft } } : { manifest: null, client: null }
  }
  handle(IPC.backupsList, () => listRestorePoints())
  handle(IPC.backupsCreate, async () => {
    if (modsBusy()) return { ok: false, reason: 'busy' }
    try {
      return { ok: true, id: await createRestorePoint({ kind: 'manual' }, (await clientInfo()).client) }
    } catch {
      return { ok: false, reason: 'failed' }
    }
  })
  handle(IPC.backupsPreview, (_e, id: unknown) => (isRestorePointId(id) ? previewRestore(id) : null))
  handle(IPC.backupsRestore, async (_e, id: unknown) => {
    if (!isRestorePointId(id)) return { ok: false, reason: 'notFound' }
    const manifest = (await clientInfo()).manifest
    // waits for the background preparation; Hemisphere's mods for the restored choices are prepared right after
    return (await withModsHeld(() => restorePoint(id, manifest))) ?? { ok: false, reason: 'busy' }
  })
  handle(IPC.backupsDelete, (_e, id: unknown) => (isRestorePointId(id) ? deleteRestorePoint(id) : false))
  handle(IPC.setupExport, async () => {
    const d = new Date()
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const pick = await dialog.showSaveDialog(win!, {
      title: 'Hemisphere setup',
      defaultPath: join(app.getPath('documents'), `Hemisphere setup ${stamp}.${SETUP_EXTENSION}`),
      filters: [{ name: 'Hemisphere setup', extensions: [SETUP_EXTENSION] }],
    })
    if (pick.canceled || !pick.filePath) return { ok: false, reason: 'cancelled' }
    return exportSetup(pick.filePath, app.getVersion(), (await clientInfo()).client)
  })
  handle(IPC.setupPick, async () => {
    const pick = await dialog.showOpenDialog(win!, { properties: ['openFile'], title: 'Hemisphere setup', filters: [{ name: 'Hemisphere setup', extensions: [SETUP_EXTENSION] }] })
    if (pick.canceled || !pick.filePaths[0]) return { ok: false, reason: 'cancelled' }
    const { manifest } = await clientInfo()
    const setup = await readSetup(pick.filePaths[0])
    if (!setup || !manifest) return { ok: false, reason: 'invalid' }
    return { ok: true, token: rememberSetup(setup), summary: summarize(pick.filePaths[0], setup, manifest.minecraft) }
  })
  handle(IPC.setupImport, async (_e, token: unknown) => {
    const setup = takeSetup(token)
    const { manifest } = await clientInfo()
    if (!setup || !manifest) return { ok: false, reason: 'invalid' }
    return (await withModsHeld(() => importSetup(setup, manifest, getFeed().modPolicy))) ?? { ok: false, reason: 'busy' }
  })
  // Mod sets and history. Switching, importing and undoing change mods: refused while the game runs or the launcher installs.
  handle(IPC.setsList, () => listSets())
  handle(IPC.setsSave, (_e, name: unknown) => saveSet(name))
  handle(IPC.setsSwitch, async (_e, id: unknown, fallbackName: unknown) => {
    if (!isSetId(id)) return { ok: false, reason: 'notFound' }
    const manifest = (await clientInfo()).manifest
    // waits for the background preparation; Hemisphere's mods for the set's choices are prepared right after
    return (await withModsHeld(() => switchSet(id, manifest, fallbackName))) ?? { ok: false, reason: 'busy' }
  })
  handle(IPC.setsRename, (_e, id: unknown, name: unknown) => (isSetId(id) ? renameSet(id, name) : false))
  handle(IPC.setsDelete, (_e, id: unknown) => (isSetId(id) ? deleteSet(id) : false))
  handle(IPC.setsDuplicate, (_e, id: unknown) => (isSetId(id) ? duplicateSet(id) : null))
  handle(IPC.setsShare, async (_e, id: unknown) => {
    const { manifest } = await clientInfo()
    if (!isSetId(id) || !manifest) return { ok: false, reason: 'notFound' }
    const result = await shareSet(id, manifest.minecraft)
    if (result.ok) clipboard.writeText(result.code)
    return result
  })
  handle(IPC.setsImport, async (_e, code: unknown) => {
    const { manifest } = await clientInfo()
    return manifest ? importSetCode(code, manifest, getFeed().modPolicy) : { ok: false, reason: 'failed' }
  })
  handle(IPC.historyList, () => withManifest(null, (m) => listHistory(m, getFeed().modPolicy)))
  handle(IPC.historyUndo, async (_e, id: unknown) => {
    if (typeof id !== 'string' || id.length > 40) return { ok: false, reason: 'notPossible' }
    if (modsBusy()) return { ok: false, reason: 'busy' }
    return withManifest({ ok: false, reason: 'network' }, (m) => undoHistory(id, m, getFeed().modPolicy))
  })
  // Resource packs and shaders. Changing them while the game runs is refused (Minecraft and Iris rewrite their
  // settings when they close).
  const isPackType = (t: unknown): t is PackType => PACK_TYPES.includes(t as PackType)
  const isPackFile = (f: unknown): f is string => typeof f === 'string' && f.length > 0 && f.length <= 200 && !/[\\/:*?"<>|]/.test(f) && f !== '.' && f !== '..'
  const IRIS = 'YL57xq9U'
  const irisJar = (f: string) => /^iris[-_].*\.jar$/i.test(f)
  /**
   * Iris will load: Hemisphere's Iris switched on (placed with the next Play at the latest), or, when the player took
   * it over, their own Iris jar switched on (in mods/).
   */
  const irisReady = async (manifest: ClientManifest) => {
    const state = await readInstanceState()
    const iris = manifest.mods.find((m) => m.source?.modrinth.projectId === IRIS)
    if (iris && !state.detached.includes(iris.id)) return (await getEnabledMods(manifest)).includes(iris.id)
    const mods = join(gamePaths().instance, 'mods')
    return existsSync(mods) && readdirSync(mods).some((f) => irisJar(f) && !Object.keys(state.owned).some((o) => o.toLowerCase() === `mods/${f}`.toLowerCase()))
  }
  /** "Turn on Iris": the player's own Iris (switched back on), else Hemisphere's (managed again if needed). */
  const enableIris = async (manifest: ClientManifest): Promise<boolean> => {
    const state = await readInstanceState()
    const iris = manifest.mods.find((m) => m.source?.modrinth.projectId === IRIS)
    if (iris && state.detached.includes(iris.id)) {
      const own = playerJars(Object.keys(state.owned)).find((j) => irisJar(j.file))
      if (own) return own.enabled || (await setPlayerModEnabled(own.file, true, Object.keys(state.owned)))
      await reattachMod(iris.id)
    } else if (iris) await setModEnabled(manifest, iris.id, true)
    else return false
    void prepareInBackground() // place it now rather than at the next Play
    return true
  }
  handle(IPC.packsList, async (_e, type: unknown) =>
    isPackType(type) ? withManifest(null, async (m) => listPacks(type, m.minecraft, getFeed().modPolicy, type === 'shader' ? await irisReady(m) : false)) : null,
  )
  handle(IPC.packsSetActive, async (_e, type: unknown, file: unknown, on: unknown) =>
    isPackType(type) && isPackFile(file) && typeof on === 'boolean' && !modsBusy() ? setPackActive(type, file, on) : false,
  )
  handle(IPC.packsEnableIris, async () => (modsBusy() ? false : withManifest(false, (m) => enableIris(m))))
  handle(IPC.packsShadersOff, async () => (modsBusy() ? false : shadersOff().then(() => true)))
  handle(IPC.packsMove, async (_e, file: unknown, delta: unknown) => (isPackFile(file) && (delta === -1 || delta === 1) && !modsBusy() ? moveResourcePack(file, delta) : false))
  handle(IPC.packsRemove, async (_e, type: unknown, file: unknown) => (isPackType(type) && isPackFile(file) && !modsBusy() ? removePack(type, file) : false))
  handle(IPC.packsVersions, async (_e, type: unknown, file: unknown) =>
    isPackType(type) && isPackFile(file) ? withManifest<ModVersionChoice[] | null>(null, (m) => packVersions(type, file, m.minecraft)) : null,
  )
  handle(IPC.packsSetVersion, async (_e, type: unknown, file: unknown, versionId: unknown, lock: unknown) => {
    if (!isPackType(type) || !isPackFile(file) || typeof versionId !== 'string' || !MODRINTH_ID.test(versionId)) return { ok: false, reason: 'notFound' }
    if (modsBusy()) return { ok: false, reason: 'busy' }
    return withManifest({ ok: false, reason: 'network' }, (m) => setPackVersion(type, file, versionId, m.minecraft, lock === true))
  })
  handle(IPC.packsSetLock, async (_e, type: unknown, file: unknown, locked: unknown) =>
    isPackType(type) && isPackFile(file) && typeof locked === 'boolean' && !modsBusy() ? withManifest(false, (m) => setPackLock(type, file, locked, m.minecraft)) : false,
  )
  handle(IPC.packsCheckUpdates, async (_e, type: unknown) => (isPackType(type) ? withManifest<UpdateCheck | null>(null, (m) => checkPackUpdates(type, m.minecraft)) : null))
  handle(IPC.packsUpdateAll, async (_e, type: unknown) =>
    isPackType(type) && !modsBusy()
      ? withManifest<UpdateApplied | null>(null, async (m) => {
          // like the mods' Update all: a restore point first
          const restorePoint = await createRestorePoint({ kind: 'updateAll' }, { clientVersion: m.clientVersion, minecraft: m.minecraft })
          return { ...(await updatePacks(type, m.minecraft)), restorePoint }
        })
      : null,
  )
  handle(IPC.packsSearch, async (_e, type: unknown, query: unknown, offset: unknown): Promise<ModSearchResult | null> => {
    if (!isPackType(type) || typeof query !== 'string' || typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0 || offset > 10_000) return null
    try {
      const { manifest } = await getContent()
      const res = await searchMods(query, manifest.minecraft, offset, [], 20, type)
      const mine = knownPackProjects(type)
      const policy = getFeed().modPolicy
      return {
        minecraft: manifest.minecraft,
        total: res.total_hits,
        offset: res.offset,
        hits: res.hits.map((h) => ({
          projectId: h.project_id,
          slug: h.slug,
          title: h.title,
          description: h.description.slice(0, 300),
          author: h.author,
          icon: safeIcon(h.icon_url),
          downloads: h.downloads,
          ...policyFor(policy, h.project_id),
          state: mine.has(h.project_id) ? 'installed' : 'available',
        })),
      }
    } catch (err) {
      console.warn('[packs] search failed:', err)
      return null
    }
  })
  handle(IPC.packsProjectVersions, async (_e, type: unknown, projectId: unknown): Promise<ModVersionChoice[] | null> => {
    if (!isPackType(type) || typeof projectId !== 'string' || !MODRINTH_ID.test(projectId)) return null
    return withManifest<ModVersionChoice[] | null>(null, async (m) => {
      const versions = (await projectVersions(projectId, m.minecraft, type)).sort((a, b) => b.date_published.localeCompare(a.date_published))
      const latest = pickVersion(versions)
      return versions.slice(0, 60).map((v) => ({ id: v.id, versionNumber: v.version_number, name: v.name, type: v.version_type, published: v.date_published, current: false, latest: v.id === latest?.id, locked: false }))
    })
  })
  handle(IPC.packsInstall, async (_e, type: unknown, projectId: unknown, confirmed: unknown, versionId: unknown): Promise<InstallResult> => {
    if (!isPackType(type) || typeof projectId !== 'string' || !MODRINTH_ID.test(projectId)) return { ok: false, reason: 'notCompatible' }
    if (versionId !== null && versionId !== undefined && (typeof versionId !== 'string' || !MODRINTH_ID.test(versionId))) return { ok: false, reason: 'notCompatible' }
    if (modsBusy()) return { ok: false, reason: 'busy' }
    return withManifest<InstallResult>({ ok: false, reason: 'network' }, (m) => installPack(type, projectId, confirmed === true, m.minecraft, getFeed().modPolicy, (versionId as string | null) ?? null))
  })
  // Report a problem: the draft comes from the page, so every field is checked here.
  handle(IPC.reportPrepare, () => prepareReport())
  handle(IPC.reportBuild, async (_e, raw: unknown) => {
    const d = (raw ?? {}) as Partial<ReportDraft>
    const parts = (d.parts ?? {}) as Record<string, unknown>
    const draft: ReportDraft = {
      category: REPORT_CATEGORIES.includes(d.category as never) ? d.category! : 'other',
      title: typeof d.title === 'string' ? d.title : '',
      description: typeof d.description === 'string' ? d.description : '',
      expected: typeof d.expected === 'string' ? d.expected : '',
      steps: typeof d.steps === 'string' ? d.steps : '',
      when: REPORT_WHEN.includes(d.when as never) ? d.when! : 'now',
      frequency: REPORT_FREQUENCY.includes(d.frequency as never) ? d.frequency! : 'once',
      discord: typeof d.discord === 'string' ? d.discord : '',
      parts: Object.fromEntries(REPORT_PARTS.map((p) => [p, parts[p] !== false])) as ReportDraft['parts'],
      removeChat: d.removeChat !== false,
      screenshots: Array.isArray(d.screenshots) ? d.screenshots.filter((s): s is string => typeof s === 'string').slice(0, 5) : [],
    }
    const manifest = await getContent()
      .then((c) => c.manifest)
      .catch(() => null)
    return buildReport(draft, manifest, getFeed().modPolicy, app.getVersion())
  })
  on(IPC.reportShow, () => {
    const zip = lastReportZip()
    if (zip) shell.showItemInFolder(zip)
  })
  on(IPC.reportDrag, (e) => {
    const zip = lastReportZip()
    if (!zip) return
    const icon = nativeImage.createFromPath(join(__dirname, '../../resources/icon.png')).resize({ width: 48, height: 48 })
    e.sender.startDrag({ file: zip, icon })
  })
  on(IPC.reportCopy, (_e, message: unknown) => {
    if (typeof message === 'string' && message.length <= 4000) clipboard.writeText(message)
  })
  on(IPC.reportOpenSupport, () => void shell.openExternal(getFeed().support?.url ?? LINKS.discord))
  // Events: "Add to calendar" opens a calendar file in the player's calendar app; reminders are one per event.
  on(IPC.eventsAddToCalendar, (_e, id: unknown) => {
    const ev = getFeed().events?.find((x) => x.id === id)
    if (!ev) return
    const s = getSettings().language
    const file = join(app.getPath('temp'), `hemisphere-${ev.id}.ics`)
    void writeFile(file, eventIcs(ev, s === 'auto' ? app.getLocale() : s)).then(() => shell.openPath(file))
  })
  handle(IPC.eventsSetReminder, async (_e, id: unknown, on: unknown) => {
    if (typeof id !== 'string' || typeof on !== 'boolean' || !getFeed().events?.some((x) => x.id === id)) return getSettings().eventReminders
    const list = getSettings().eventReminders.filter((x) => x !== id)
    return (await updateSettings({ eventReminders: on ? [...list, id].slice(-50) : list })).eventReminders
  })
  handle(IPC.feedGet, () => getFeed())
  on(IPC.feedOpenLink, (_e, id: unknown) => {
    const feed = getFeed()
    // a news item's or an event's button (looked up in the verified feed, never a raw URL)
    const url = feed.news.find((n) => n.id === id)?.link?.url ?? feed.events?.find((e) => e.id === id)?.link?.url
    if (url?.startsWith('https://')) void shell.openExternal(url)
  })
  handle(IPC.settingsGet, () => getSettings())
  handle(IPC.settingsSet, async (_e, patch: unknown) => {
    // gameDir is only changed through the move (files must follow); javaPath only through the picker (validated).
    const { gameDir: _g, javaPath, ...rest } = (typeof patch === 'object' && patch ? patch : {}) as Record<string, unknown>
    const next = await updateSettings({ ...rest, ...(javaPath === null ? { javaPath: null } : {}) })
    if (rest.backgroundUpdates === true) void prepareInBackground()
    return next
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
        installedVersion: installed.clientVersion ?? null,
        changelog: manifest.changelog ?? [],
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
  handle(IPC.launcherUpdateGet, () => getUpdateState())
  handle(IPC.launcherUpdateCheck, () => checkForUpdates())
  on(IPC.launcherUpdateInstall, () => installUpdateNow())
}

// The installed launcher never accepts a remote debugger (it would give any local program control of the
// launcher and its Microsoft session). Development builds keep it for testing.
if (app.isPackaged && (app.commandLine.hasSwitch('remote-debugging-port') || app.commandLine.hasSwitch('remote-debugging-pipe'))) {
  app.exit(1)
}

/** Keeps the Windows startup entry in line with the setting (e.g. after reinstalling). */
function syncLoginItem(): void {
  if (!app.isPackaged) return
  const want = getSettings().startWithWindows
  if (app.getLoginItemSettings({ args: [AUTOSTART_ARG] }).openAtLogin !== want) app.setLoginItemSettings({ openAtLogin: want, args: [AUTOSTART_ARG] })
}

// Screenshot images reach the page through hemi-shot:// (registered before the app is ready).
registerScreenshotScheme()

// One launcher at a time: a second start focuses the existing window.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      if (!win.isVisible()) win.show()
      win.focus()
    }
  })

  app.whenReady().then(async () => {
    installFileLogger()
    hardenApp()
    serveScreenshots()
    app.setAppUserModelId('club.hemispheresurvival.launcher')
    await loadAccounts()
    onAccountsChanged(() => win?.webContents.send(IPC.authChanged, getAccountsState()))
    onGameState((s) => win?.webContents.send(IPC.gameStateChanged, s))
    onSettingsChanged((s) => {
      win?.webContents.send(IPC.settingsChanged, s)
      onCommunitySettings(s)
    })
    // Launcher window while playing: hide (default), keep, or close. It comes back when the game exits.
    gameEvents.onLaunched = () => {
      void readInstanceState().then((s) => onGameLaunched(s.minecraft))
      const mode = getSettings().onGameStart
      if (mode === 'hide') win?.hide()
      else if (mode === 'close') setTimeout(() => app.quit(), 1500)
    }
    gameEvents.onExited = ({ crashed, anyRunning }) => {
      onGameExited(anyRunning)
      if (!anyRunning) setTimeout(() => void prepareInBackground(), 60_000) // e.g. an update published while playing
      if (win && (crashed || !anyRunning) && !win.isVisible()) win.show()
      if (crashed) win?.focus()
    }
    gameEvents.onPlaytimeChanged = () => win?.webContents.send(IPC.playtimeChanged)
    void recoverSessions(instanceLogPath(), () => win?.webContents.send(IPC.playtimeChanged))
    registerIpc()
    createWindow()
    startCommunity({
      window: () => win,
      feed: () => getFeed(),
      play: () => {
        const active = getAccountsState().activeId
        const g = getGameState()
        if (!active || g.phase === 'preparing' || g.runningAccounts.includes(active)) return false
        void play(active, { target: 'latest' })
        return true
      },
    })
    startStatusPolling((status) => {
      lastStatus = status
      win?.webContents.send(IPC.serverStatusUpdate, status)
      onServerStatus(status)
    })
    void refreshAccount() // renew the active session silently in the background
    startFeedPolling((feed) => win?.webContents.send(IPC.feedChanged, feed))
    onUpdateState((s) => win?.webContents.send(IPC.launcherUpdateChanged, s))
    void detectGpus()
    // Get the next PLAY ready shortly after start (once the window and status are up), then twice an hour.
    setTimeout(() => void prepareInBackground(), 15_000)
    setInterval(() => void prepareInBackground(), 30 * 60_000).unref()
    startUpdater()
    syncLoginItem()
  })

  app.on('window-all-closed', () => app.quit())
}
