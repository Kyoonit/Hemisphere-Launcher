/** Game install / launch state shared by main and renderer. */

export type GameStage = 'java' | 'minecraft' | 'fabric' | 'launching'

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
  | 'crashed' // game exited with an error
  | 'unknown'

export interface GameState {
  phase: 'idle' | 'preparing' | 'running'
  progress: GameProgress | null
  /** Accounts with a running game (one game per account) */
  runningAccounts: string[]
  /** Last problem, cleared on next PLAY */
  error: { code: GameErrorCode; detail?: string } | null
}

export interface JavaRuntimeInfo {
  path: string
  version: string
  majorVersion: number
  managed: boolean
}
