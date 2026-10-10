import type { PlaytimeSummary, ServerStatus } from './server'
import type { AccountsState, AuthResult } from './auth'
import type { SkinInfo } from './skins'
import type { GameState, JavaRuntimeInfo, PlayOptions, RepairMode, RepairReport, SessionRecap } from './game'
import type { PreflightWarning, Settings, SystemInfo } from './settings'
import type { FeedView } from './schedule'
import type { ImportOptions, ImportProgress, ImportReport, ImportSource } from './importer'
import type { ClientSummary } from './client'
import type { LauncherUpdateState } from './launcherUpdate'
import type { ScreenshotExport, ScreenshotList } from './screenshots'
import type { PackList, PackResult, PackType } from './packs'
import type { ReportDraft, ReportPrepare, ReportResult } from './report'
import type { DevAccess, DevAction, DevState, DevUnlockResult } from './dev'
import type { LiveRestart } from './restart'
import type { ModHistoryItem, ModSetInfo, ModSetsState, SetImportResult, SetShareResult, SetSwitchResult, UndoResult } from './modSets'
import type { RestorePointInfo, RestorePreview, RestoreResult, SetupExportResult, SetupImportResult, SetupPick } from './restorePoints'
import type { InstallResult, ModItem, ModSearchResult, ModVersionChoice, PlayerModInfo, SetVersionResult, UpdateApplied, UpdateCheck } from './modBrowser'
import type { LowEndInfo, PerfSnapshot } from './performance'
import type { CleanupScan } from './cleanup'

/** IPC contract shared by main, preload and renderer. Every channel is listed here. */

export const IPC = {
  windowMinimize: 'window:minimize',
  windowToggleMaximize: 'window:toggle-maximize',
  windowClose: 'window:close',
  windowMaximizedChanged: 'window:maximized-changed',
  openLink: 'link:open',
  appInfo: 'app:info',
  launcherUpdateGet: 'launcher-update:get',
  launcherUpdateChanged: 'launcher-update:changed',
  launcherUpdateCheck: 'launcher-update:check',
  launcherUpdateInstall: 'launcher-update:install',
  serverStatusGet: 'server:status:get',
  serverStatusUpdate: 'server:status:update',
  playtimeGet: 'playtime:get',
  authState: 'auth:state',
  authChanged: 'auth:changed',
  skinsGet: 'skins:get',
  authSignIn: 'auth:sign-in',
  authCancel: 'auth:cancel',
  authSwitch: 'auth:switch',
  authSignOut: 'auth:sign-out',
  authDevOffline: 'auth:dev-offline',
  gameState: 'game:state',
  gameStateChanged: 'game:state-changed',
  gamePlay: 'game:play',
  gameDismissError: 'game:dismiss-error',
  gameRecap: 'game:recap',
  gameDismissRecap: 'game:dismissRecap',
  serverWatchSlot: 'server:watchSlot',
  serverSlotWatched: 'server:slotWatched',
  systemCleanupScan: 'system:cleanupScan',
  systemCleanupRun: 'system:cleanupRun',
  gameJava: 'game:java',
  gameRepair: 'game:repair',
  clientGet: 'client:get',
  modsEnabled: 'mods:enabled',
  modsSet: 'mods:set',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsChanged: 'settings:changed',
  playtimeChanged: 'playtime:changed',
  feedGet: 'feed:get',
  feedChanged: 'feed:changed',
  feedOpenLink: 'feed:open-link',
  systemInfo: 'system:info',
  screenshotsList: 'screenshots:list',
  screenshotsCopy: 'screenshots:copy',
  screenshotsShow: 'screenshots:show',
  screenshotsDelete: 'screenshots:delete',
  screenshotsExport: 'screenshots:export',
  backupsList: 'backups:list',
  backupsCreate: 'backups:create',
  backupsPreview: 'backups:preview',
  backupsRestore: 'backups:restore',
  backupsDelete: 'backups:delete',
  setupExport: 'setup:export',
  setupPick: 'setup:pick',
  setupImport: 'setup:import',
  setsList: 'sets:list',
  setsSave: 'sets:save',
  setsSwitch: 'sets:switch',
  setsRename: 'sets:rename',
  setsDelete: 'sets:delete',
  setsDuplicate: 'sets:duplicate',
  setsShare: 'sets:share',
  setsImport: 'sets:import',
  historyList: 'history:list',
  historyUndo: 'history:undo',
  reportPrepare: 'report:prepare',
  eventsAddToCalendar: 'events:addToCalendar',
  devGet: 'dev:get',
  restartLiveGet: 'restart:live',
  restartLiveChanged: 'restart:live-changed',
  devSet: 'dev:set',
  devAction: 'dev:action',
  devUnlock: 'dev:unlock',
  devUnlockWait: 'dev:unlockWait',
  devCheckDiscord: 'dev:checkDiscord',
  devLock: 'dev:lock',
  devAccessChanged: 'dev:accessChanged',
  devPerf: 'dev:perf',
  eventsSetReminder: 'events:setReminder',
  reportBuild: 'report:build',
  reportShow: 'report:show',
  reportDrag: 'report:drag',
  reportCopy: 'report:copy',
  reportOpenSupport: 'report:openSupport',
  packsList: 'packs:list',
  packsSetActive: 'packs:setActive',
  packsShadersOff: 'packs:shadersOff',
  packsEnableIris: 'packs:enableIris',
  packsMove: 'packs:move',
  packsRemove: 'packs:remove',
  packsVersions: 'packs:versions',
  packsSetVersion: 'packs:setVersion',
  packsSetLock: 'packs:setLock',
  packsCheckUpdates: 'packs:checkUpdates',
  packsUpdateAll: 'packs:updateAll',
  packsSearch: 'packs:search',
  packsProjectVersions: 'packs:projectVersions',
  packsInstall: 'packs:install',
  systemPreflight: 'system:preflight',
  systemLowEnd: 'system:lowEnd',
  systemMetered: 'system:metered',
  systemNotificationsBlocked: 'system:notificationsBlocked',
  systemOpenNotificationSettings: 'system:openNotificationSettings',
  systemOpenFolder: 'system:open-folder',
  systemDiagnostics: 'system:diagnostics',
  systemMoveGameDir: 'system:move-game-dir',
  systemPickJava: 'system:pick-java',
  systemMoveProgress: 'system:move-progress',
  importDetect: 'import:detect',
  importChoose: 'import:choose',
  importRun: 'import:run',
  importProgress: 'import:progress',
  modsPlayer: 'mods:player',
  modsPlayerSet: 'mods:player-set',
  modsSearch: 'mods:search',
  modsInstall: 'mods:install',
  modsList: 'mods:list',
  modsVersions: 'mods:versions',
  modsSetVersion: 'mods:set-version',
  modsSetLock: 'mods:set-lock',
  modsRemove: 'mods:remove',
  modsBackToHemisphere: 'mods:back-to-hemisphere',
  modsCheckUpdates: 'mods:check-updates',
  modsUpdateAll: 'mods:update-all',
  modsProjectVersions: 'mods:project-versions',
} as const

/** External links the renderer may open. The renderer sends a key, never a URL. */
export const LINKS = {
  discord: 'https://discord.gg/m3FGGUF',
  website: 'https://hemispheresurvival.club/',
  map: 'http://play.hemispheresurvival.club:9090/',
  rules: 'https://hemispheresurvival.club/rules',
  getMinecraft: 'https://www.minecraft.net/store/minecraft-java-bedrock-edition-pc',
  xboxProfile: 'https://www.xbox.com/live',
  microsoftFamily: 'https://account.microsoft.com/family',
} as const

export type LinkKey = keyof typeof LINKS

export interface AppInfo {
  version: string
  platform: string
  /** the installed launcher (false: a development build) */
  packaged: boolean
}

/** API exposed on `window.hemisphere` by the preload script. */
export interface HemisphereApi {
  window: {
    minimize(): void
    toggleMaximize(): void
    close(): void
    onMaximizedChange(cb: (maximized: boolean) => void): () => void
  }
  openLink(key: LinkKey): void
  appInfo(): Promise<AppInfo>
  /** Minecraft screenshots (images load from hemi-shot:// URLs, see screenshotUrl) */
  screenshots: {
    list(): Promise<ScreenshotList>
    /** to the clipboard, ready to paste into Discord */
    copy(name: string): Promise<boolean>
    showInFolder(name: string): void
    /** to the Recycle Bin */
    remove(name: string): Promise<boolean>
    /** copies them to a folder the player picks; null when the picker was cancelled */
    exportTo(names: string[]): Promise<ScreenshotExport | null>
  }
  /** Safety nets: restore points and moving a whole setup to another PC */
  backups: {
    list(): Promise<RestorePointInfo[]>
    /** a restore point now; null when there's nothing to keep yet */
    create(): Promise<{ ok: true; id: string | null } | { ok: false; reason: 'busy' | 'failed' }>
    preview(id: string): Promise<RestorePreview | null>
    restore(id: string): Promise<RestoreResult>
    remove(id: string): Promise<boolean>
    /** save dialog, then the file */
    exportSetup(): Promise<SetupExportResult>
    /** open dialog, then what the file contains */
    pickSetup(): Promise<SetupPick>
    importSetup(token: string): Promise<SetupImportResult>
  }
  /** Mod sets: named mod lists to switch between, shared as a code */
  modSets: {
    list(): Promise<ModSetsState>
    /** the mods as they are now, as a new (active) set */
    save(name: string): Promise<ModSetInfo | null>
    /** fallbackName: name for the mods as they are now when no set is active yet ("My mods") */
    switchTo(id: string, fallbackName: string): Promise<SetSwitchResult>
    rename(id: string, name: string): Promise<boolean>
    /** a copy to customise ("<name> (copy)"), not switched to */
    duplicate(id: string): Promise<ModSetInfo | null>
    remove(id: string): Promise<boolean>
    /** the code is also put on the clipboard */
    share(id: string): Promise<SetShareResult>
    importCode(code: string): Promise<SetImportResult>
  }
  /** Everyday mod changes, newest first, with undo */
  modHistory: {
    list(): Promise<ModHistoryItem[] | null>
    undo(id: string): Promise<UndoResult>
  }
  /** Resource packs and shader packs (Content page) */
  packs: {
    list(type: PackType): Promise<PackList | null>
    /** resource pack: on = on top of the others; shader: on = the one in use */
    setActive(type: PackType, file: string, on: boolean): Promise<boolean>
    shadersOff(): Promise<boolean>
    /** switches Iris on (Hemisphere's, or the player's own copy) */
    enableIris(): Promise<boolean>
    /** resource pack that is on: -1 = up (wins over more), +1 = down */
    move(file: string, delta: -1 | 1): Promise<boolean>
    remove(type: PackType, file: string): Promise<boolean>
    versions(type: PackType, file: string): Promise<ModVersionChoice[] | null>
    setVersion(type: PackType, file: string, versionId: string, lock: boolean): Promise<PackResult & { versionNumber?: string }>
    setLock(type: PackType, file: string, locked: boolean): Promise<boolean>
    checkUpdates(type: PackType): Promise<UpdateCheck | null>
    updateAll(type: PackType): Promise<UpdateApplied | null>
    search(type: PackType, query: string, offset: number): Promise<ModSearchResult | null>
    projectVersions(type: PackType, projectId: string): Promise<ModVersionChoice[] | null>
    install(type: PackType, projectId: string, confirmed: boolean, versionId?: string | null): Promise<InstallResult>
  }
  /** The daily restart as seen live (checked on the server itself around the restart) */
  restart: {
    live(): Promise<LiveRestart>
    onChange(cb: (live: LiveRestart) => void): () => void
  }
  /** Developer tab (development builds, or the installed launcher with the staff code) */
  dev: {
    get(): Promise<DevAccess>
    unlock(code: string): Promise<DevUnlockResult>
    /** seconds before the next staff code can be tried */
    unlockWait(): Promise<number>
    /** is it a Discord application id? (its name) */
    checkDiscord(id: string): Promise<{ ok: true; name: string } | { ok: false; reason: 'notApp' | 'network' }>
    lock(): Promise<boolean>
    /** the access changed by itself (locked again: the staff made a new code) */
    onAccessChanged(cb: () => void): () => void
    set(patch: Partial<DevState>): Promise<DevState | null>
    action(action: DevAction): Promise<string>
    /** memory, CPU and downloads of the launcher right now */
    perf(): Promise<PerfSnapshot | null>
  }
  /** Events calendar (from the feed) */
  events: {
    /** opens the event in the player's calendar app (.ics) */
    addToCalendar(id: string): void
    /** one notification shortly before the event; returns the events with a reminder */
    setReminder(id: string, on: boolean): Promise<string[]>
  }
  /** "Report a problem": a zip for staff + a message for the Discord ticket */
  report: {
    prepare(): Promise<ReportPrepare>
    build(draft: ReportDraft): Promise<ReportResult>
    /** the report zip in Explorer */
    showInFolder(): void
    /** starts dragging the report zip (drop it into Discord) */
    startDrag(): void
    copyMessage(message: string): void
    /** the staff's ticket channel (signed feed), else the Discord invite */
    openSupport(): void
  }
  /** Updates of the launcher itself (GitHub releases) */
  launcherUpdate: {
    get(): Promise<LauncherUpdateState>
    onChange(cb: (state: LauncherUpdateState) => void): () => void
    check(): Promise<LauncherUpdateState>
    /** restart now and install the downloaded update */
    install(): void
  }
  server: {
    getStatus(): Promise<ServerStatus>
    onStatus(cb: (status: ServerStatus) => void): () => void
    /** server full: one notification when a place frees up (on/off); returns whether it's on */
    watchSlot(on: boolean): Promise<boolean>
    slotWatched(): Promise<boolean>
  }
  playtime: {
    /** Playtime of the active account */
    get(): Promise<PlaytimeSummary>
    /** Fires when a session was recorded */
    onChange(cb: () => void): () => void
  }
  /** News, maintenance and restart schedule (signed staff feed) */
  feed: {
    get(): Promise<FeedView>
    onChange(cb: (feed: FeedView) => void): () => void
    /** Opens a news item's button link (looked up by id in the verified feed, never a raw URL) */
    openLink(newsId: string): void
  }
  system: {
    info(): Promise<SystemInfo>
    /** Low disk space / little RAM hints for the PLAY screen */
    preflight(): Promise<PreflightWarning[]>
    /** a modest PC? (the light interface turns on by itself) */
    lowEnd(): Promise<LowEndInfo>
    /** Free up space: what can go (logs, old crash reports, unfinished downloads, unused Minecraft versions) */
    cleanupScan(): Promise<CleanupScan>
    /** removes it; bytes freed, or why not now */
    cleanupRun(): Promise<{ ok: true; freed: number } | { ok: false; reason: 'busy' }>
    /** Windows says this connection is metered (phone hotspot, 4G) */
    metered(): Promise<boolean>
    /** Windows notifications are turned off (for all apps or this launcher): no alert can show */
    notificationsBlocked(): Promise<boolean>
    /** opens Windows Settings > Notifications */
    openNotificationSettings(): void
    openFolder(kind: 'game' | 'mods' | 'resourcepacks' | 'shaderpacks' | 'screenshots' | 'gameLogs' | 'crashReports' | 'launcherLogs'): void
    /** Builds the support report and copies it to the clipboard */
    copyDiagnostics(): Promise<string>
    /** Asks for a folder (Windows dialog) or uses 'default', then moves the game there */
    moveGameDir(target: 'choose' | 'default'): Promise<{ ok: boolean; reason?: string; gameDir?: string; cancelled?: boolean }>
    /** 0..1 while the game folder is being copied to another drive */
    onMoveProgress(cb: (ratio: number) => void): () => void
    /** Asks for javaw.exe (Windows dialog) and saves it if it works */
    pickJava(): Promise<{ ok: boolean; version?: string; majorVersion?: number; reason?: string; cancelled?: boolean }>
  }
  importer: {
    /** Minecraft setups found on this PC */
    detect(): Promise<ImportSource[]>
    /** Windows folder picker; null if cancelled or nothing importable there */
    chooseFolder(): Promise<ImportSource | null | 'nothing'>
    run(sourceId: string, opts: ImportOptions): Promise<{ ok: true; report: ImportReport } | { ok: false; reason: 'busy' | 'unknownSource' | 'tooManyPresets' | 'failed'; detail?: string }>
    onProgress(cb: (p: ImportProgress) => void): () => void
  }
  settings: {
    get(): Promise<Settings>
    set(patch: Partial<Settings>): Promise<Settings>
    onChange(cb: (s: Settings) => void): () => void
  }
  auth: {
    getState(): Promise<AccountsState>
    onChange(cb: (state: AccountsState) => void): () => void
    /** Opens the browser for Microsoft sign-in; resolves when finished, cancelled or failed */
    signIn(language: string): Promise<AuthResult>
    cancel(): void
    switchTo(id: string): Promise<void>
    signOut(id: string): Promise<void>
    addDevOffline(name: string): Promise<AuthResult>
  }
  /** Skins (1.4): an account's skin and cape for the 3D views (default: the active account) */
  skins: {
    get(id?: string, refresh?: boolean): Promise<SkinInfo | null>
  }
  game: {
    getState(): Promise<GameState>
    onState(cb: (state: GameState) => void): () => void
    /** Install if needed and launch with the active account */
    play(opts?: PlayOptions): void
    /** Close the error / crash card */
    dismissError(): void
    /** the last session (time played, screenshots), shortly after the game closed */
    recap(): Promise<SessionRecap | null>
    dismissRecap(): void
    /** Managed runtime (if installed) + Java found on this PC */
    javaInfo(): Promise<JavaRuntimeInfo[]>
    /** Verify and fix the installation (progress arrives through onState) */
    repair(mode: RepairMode): Promise<RepairReport | { error: GameState['error'] }>
  }
  client: {
    /** Verified Hemisphere client definition, or null if never downloaded and offline */
    get(): Promise<ClientSummary | null>
    /** ids of enabled mods (player choices + defaults + needed libraries) */
    enabledMods(): Promise<string[]>
    /** Toggle a mod; returns the new enabled set and other mods switched as a consequence */
    setModEnabled(id: string, on: boolean): Promise<{ enabled: string[]; alsoChanged: string[] }>
    /** .jar files the player added themselves, with their Modrinth identity and the staff policy */
    playerMods(): Promise<PlayerModInfo[]>
    /** Modrinth search: Fabric mods for Hemisphere's Minecraft version */
    search(query: string, offset: number): Promise<ModSearchResult | null>
    /** Installs a Modrinth project (+ required dependencies), newest version or versionId. confirmed = accepted an "ask staff" warning */
    install(projectId: string, confirmed: boolean, versionId?: string | null): Promise<InstallResult>
    /** Versions of a Modrinth project for this Minecraft version (Find mods) */
    projectVersions(projectId: string): Promise<ModVersionChoice[] | null>
    /** Every mod (Hemisphere's and the player's), same actions for all; keys "h:<id>" / "p:<file>" */
    list(): Promise<ModItem[] | null>
    versions(key: string): Promise<ModVersionChoice[] | null>
    setVersion(key: string, versionId: string, lock: boolean): Promise<SetVersionResult>
    setLock(key: string, locked: boolean): Promise<boolean>
    /** To the Recycle Bin (a Hemisphere mod is taken over first) */
    remove(key: string): Promise<boolean>
    /** A taken-over Hemisphere mod goes back to Hemisphere's version and updates */
    backToHemisphere(key: string): Promise<boolean>
    checkUpdates(): Promise<UpdateCheck | null>
    updateAll(): Promise<UpdateApplied | null>
    setPlayerMod(file: string, enabled: boolean): Promise<boolean>
  }
}
