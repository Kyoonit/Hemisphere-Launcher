/** Game install / launch state shared by main and renderer. */

export type GameStage = 'account' | 'java' | 'minecraft' | 'fabric' | 'mods' | 'launching'

export interface GameProgress {
  stage: GameStage
  /** 0..1 for the current stage, null when unknown */
  ratio: number | null
  /** e.g. downloaded MB, for display */
  detail?: string
}

export type GameErrorCode =
  | 'network' // download failed
  | 'disk' // cannot write (space / permissions)
  | 'java' // Java runtime missing or broken
  | 'notSignedIn'
  | 'sessionExpired'
  | 'alreadyRunning'
  | 'busy' // files in use: Minecraft is open, so mods can't be changed
  | 'content' // client definition could not be downloaded or verified
  | 'crashed' // game exited with an error
  | 'unknown'

export interface GameState {
  phase: 'idle' | 'preparing' | 'running'
  /** what 'preparing' is doing */
  activity: 'play' | 'repair' | null
  progress: GameProgress | null
  /** Accounts with a running game (one game per account) */
  runningAccounts: string[]
  /** Last problem, cleared on next PLAY. suspects = mod ids named in the crash output */
  error: {
    code: GameErrorCode
    detail?: string
    suspects?: string[]
    /** mods Fabric refused because they don't fit this game version (name, version, what it needs) */
    incompatible?: { name: string; version: string; needs: string }[]
  } | null
  /** Preparing the next PLAY in the background (client update, file checks) */
  background: boolean
}

/** latest = current client (auto-joins if enabled); previous = "Play on <old Minecraft>" (never auto-joins) */
export type PlayTarget = 'latest' | 'previous'

export interface PlayOptions {
  target: PlayTarget
  /** move the player's own mods to mods-disabled/ first (after a crash) */
  withoutPlayerMods?: boolean
}

export type RepairMode = 'quick' | 'full'

export interface RepairReport {
  mode: RepairMode
  /** Hemisphere files checked by hash */
  verifiedFiles: number
  /** Hemisphere files fixed */
  repaired: { label: string; reason: 'missing' | 'damaged' }[]
  /** Minecraft / Fabric files that were missing or damaged (fixed) */
  minecraftRepaired: number
  downloadedBytes: number
  /** old files removed from the store */
  freedBytes: number
  /** Full reset: the player's previous config folder */
  configBackup?: string
  durationMs: number
}

export interface JavaRuntimeInfo {
  path: string
  version: string
  majorVersion: number
  managed: boolean
}
