/**
 * Phase 24: "Report a problem". The player describes the problem; the launcher builds a zip for staff (logs, crash
 * reports, mods, packs, recent changes, system info, an automatic "quick look"), private details removed, plus a
 * ready-to-paste Discord message. The player sends both in a Discord ticket.
 */

export const REPORT_CATEGORIES = ['crash', 'launcher', 'connect', 'mods', 'performance', 'account', 'server', 'other'] as const
export type ReportCategory = (typeof REPORT_CATEGORIES)[number]

/** What can go in the zip (the player chooses). */
export const REPORT_PARTS = ['system', 'launcherLog', 'gameLog', 'crashReports', 'mods', 'packs', 'changes', 'settings', 'screenshots'] as const
export type ReportPart = (typeof REPORT_PARTS)[number]

export const REPORT_WHEN = ['now', 'today', 'earlier'] as const
export const REPORT_FREQUENCY = ['always', 'sometimes', 'once'] as const

export interface ReportDraft {
  category: ReportCategory
  title: string
  /** what happened */
  description: string
  /** what the player expected instead */
  expected: string
  /** how to make it happen again */
  steps: string
  when: (typeof REPORT_WHEN)[number]
  frequency: (typeof REPORT_FREQUENCY)[number]
  /** so staff can reach them */
  discord: string
  parts: Record<ReportPart, boolean>
  /** chat lines of the game log are removed (other players' messages) */
  removeChat: boolean
  /** screenshot file names (from the gallery) */
  screenshots: string[]
}

export interface ReportPartInfo {
  id: ReportPart
  available: boolean
  /** approximate size in the zip, bytes (before compression) */
  size: number
  /** "3 crash reports", "latest.log, 2.1 MB"… (count used for plurals) */
  count: number
}

export interface ReportPrepare {
  parts: ReportPartInfo[]
  /** the active Minecraft name (staff need it) */
  player: string | null
  /** the last crash, if it's recent (for "Report this crash" and the suggested category) */
  lastCrash: { at: number; summary: string } | null
  /** remembered from the last report */
  discord: string
}

export type ReportResult =
  | {
      ok: true
      id: string
      zipPath: string
      zipName: string
      bytes: number
      /** ready to paste in the ticket (also copied) */
      message: string
      files: string[]
      quickLook: string[]
    }
  | { ok: false; reason: 'invalid' | 'failed'; detail?: string }

/** Discord messages are cut at 2000 characters. */
export const DISCORD_LIMIT = 2000
export const REPORT_TEXT_MAX = { title: 120, description: 4000, expected: 1000, steps: 2000, discord: 40 }
