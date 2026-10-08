/** Launcher self-update state (electron-updater, GitHub releases). */
export type LauncherUpdateState =
  | { phase: 'disabled' } // development build: updates only exist for the installed launcher
  | { phase: 'idle'; checkedAt: number | null }
  | { phase: 'checking' }
  | { phase: 'downloading'; version: string; ratio: number }
  | { phase: 'ready'; version: string }
  | { phase: 'error'; message: string }
