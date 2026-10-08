import type { PlaytimeSummary, ServerStatus } from './server'
import type { AccountsState, AuthResult } from './auth'
import type { GameState, JavaRuntimeInfo, PlayOptions, RepairMode, RepairReport } from './game'
import type { PreflightWarning, Settings, SystemInfo } from './settings'
import type { Feed } from './feed'
import type { ImportOptions, ImportProgress, ImportReport, ImportSource } from './importer'
import type { ClientSummary } from './client'
import type { LauncherUpdateState } from './launcherUpdate'
import type { ScreenshotList } from './screenshots'
import type { InstallResult, ModItem, ModSearchResult, ModVersionChoice, PlayerModInfo, SetVersionResult, UpdateApplied, UpdateCheck } from './modBrowser'

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
  authSignIn: 'auth:sign-in',
  authCancel: 'auth:cancel',
  authSwitch: 'auth:switch',
  authSignOut: 'auth:sign-out',
  authDevOffline: 'auth:dev-offline',
  gameState: 'game:state',
  gameStateChanged: 'game:state-changed',
  gamePlay: 'game:play',
  gameDismissError: 'game:dismiss-error',
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
  systemPreflight: 'system:preflight',
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
  }
  playtime: {
    /** Playtime of the active account */
    get(): Promise<PlaytimeSummary>
    /** Fires when a session was recorded */
    onChange(cb: () => void): () => void
  }
  /** News, maintenance and restart schedule (signed staff feed) */
  feed: {
    get(): Promise<Feed>
    onChange(cb: (feed: Feed) => void): () => void
    /** Opens a news item's button link (looked up by id in the verified feed, never a raw URL) */
    openLink(newsId: string): void
  }
  system: {
    info(): Promise<SystemInfo>
    /** Low disk space / little RAM hints for the PLAY screen */
    preflight(): Promise<PreflightWarning[]>
    openFolder(kind: 'game' | 'mods' | 'screenshots' | 'gameLogs' | 'crashReports' | 'launcherLogs'): void
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
    run(sourceId: string, opts: ImportOptions): Promise<{ ok: true; report: ImportReport } | { ok: false; reason: 'busy' | 'unknownSource' | 'failed'; detail?: string }>
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
  game: {
    getState(): Promise<GameState>
    onState(cb: (state: GameState) => void): () => void
    /** Install if needed and launch with the active account */
    play(opts?: PlayOptions): void
    /** Close the error / crash card */
    dismissError(): void
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
