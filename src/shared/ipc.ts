import type { PlaytimeSummary, ServerStatus } from './server'
import type { AccountsState, AuthResult } from './auth'
import type { GameState, JavaRuntimeInfo, PlayOptions, RepairMode, RepairReport } from './game'
import type { Settings } from './settings'
import type { ClientSummary } from './client'

/** IPC contract shared by main, preload and renderer. Every channel is listed here. */

export const IPC = {
  windowMinimize: 'window:minimize',
  windowToggleMaximize: 'window:toggle-maximize',
  windowClose: 'window:close',
  windowMaximizedChanged: 'window:maximized-changed',
  openLink: 'link:open',
  appInfo: 'app:info',
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
  gameJava: 'game:java',
  gameRepair: 'game:repair',
  clientGet: 'client:get',
  modsEnabled: 'mods:enabled',
  modsSet: 'mods:set',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsChanged: 'settings:changed',
  playtimeChanged: 'playtime:changed',
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
  }
}
