/**
 * Safety nets (Phase 20): restore points taken before risky changes, and a whole setup packed into one file to carry
 * to another PC. Neither ever contains accounts.
 */

/** Why a restore point was taken (shown as "Before …"). */
export type RestoreReason =
  | { kind: 'clientUpdate'; from: string; to: string }
  | { kind: 'import' }
  | { kind: 'updateAll' }
  | { kind: 'version'; mod: string }
  | { kind: 'restore'; to: number }
  | { kind: 'setupImport' }
  | { kind: 'repair' }
  | { kind: 'manual' }

export interface RestorePointInfo {
  id: string
  createdAt: number
  reason: RestoreReason
  clientVersion: string | null
  minecraft: string | null
  /** the player's own mods (and Hemisphere mods they took over) */
  mods: number
  configFiles: number
  hasOptions: boolean
  hasServers: boolean
}

/** What restoring would change, compared with now. */
export interface RestorePreview {
  /** mods that come back */
  back: string[]
  /** mods that go away (they stay in the "Before restoring" point) */
  away: string[]
  /** same mod, other version: "Sodium 0.7.0 -> 0.6.1" */
  changed: { name: string; from: string; to: string }[]
  /** mods switched on or off */
  switched: number
  options: boolean
  servers: boolean
  /** config files that differ */
  configs: number
}

export type RestoreResult = { ok: true; safetyPoint: string | null; missing: string[] } | { ok: false; reason: 'busy' | 'notFound' | 'failed'; detail?: string }

/** Launcher settings a setup file carries (never the game folder, Java path or accounts). */
export const SETUP_SETTINGS = ['autoJoin', 'onGameStart', 'language', 'memoryMb', 'resolution', 'jvmArgs', 'backgroundUpdates', 'highPerformanceGpu'] as const

export interface SetupSummary {
  /** file name, for the confirmation */
  name: string
  createdAt: number
  clientVersion: string | null
  minecraft: string | null
  /** Minecraft version of this PC's client; mods are switched to their version for it when they differ */
  currentMinecraft: string
  mods: number
  /** mods that aren't on Modrinth, carried inside the file */
  embedded: number
  configFiles: number
  options: boolean
  servers: boolean
  launcherSettings: boolean
}

export type SetupPick = { ok: true; token: string; summary: SetupSummary } | { ok: false; reason: 'cancelled' | 'invalid' }

export type SetupImportResult =
  | {
      ok: true
      installed: number
      /** switched to another version (the setup came from another Minecraft version) */
      updated: string[]
      skipped: { name: string; reason: 'blocked' | 'notAvailable' | 'download' }[]
      safetyPoint: string | null
    }
  | { ok: false; reason: 'busy' | 'invalid' | 'failed'; detail?: string }

export type SetupExportResult = { ok: true; path: string; bytes: number; mods: number; embedded: number } | { ok: false; reason: 'cancelled' | 'failed'; detail?: string }

export const MAX_RESTORE_POINTS = 10
