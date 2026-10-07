import { app } from 'electron'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type { PlaytimeSummary } from '@shared/server'

/**
 * Local playtime per account, stored in %APPDATA%/Hemisphere Launcher/playtime.json.
 * Phase 5 only reads it; sessions are recorded when real launching arrives (Phase 11).
 */
const AccountPlaytimeSchema = z.object({
  totalMs: z.number().nonnegative(),
  sessions: z.number().int().nonnegative(),
  lastSessionMs: z.number().nonnegative().nullable(),
  /** "YYYY-MM-DD" (local date) -> ms played that day */
  days: z.record(z.string(), z.number().nonnegative()),
})
const PlaytimeFileSchema = z.object({ accounts: z.record(z.string(), AccountPlaytimeSchema) })

const EMPTY: PlaytimeSummary = { totalMs: 0, lastSessionMs: null, weekMs: 0, sessions: 0 }

const filePath = () => join(app.getPath('userData'), 'playtime.json')

function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export async function getPlaytime(accountId: string): Promise<PlaytimeSummary> {
  let data: z.infer<typeof PlaytimeFileSchema>
  try {
    const parsed = PlaytimeFileSchema.safeParse(JSON.parse(await readFile(filePath(), 'utf8')))
    if (!parsed.success) return EMPTY
    data = parsed.data
  } catch {
    return EMPTY // no file yet
  }
  const acc = data.accounts[accountId]
  if (!acc) return EMPTY

  let weekMs = 0
  for (let i = 0; i < 7; i++) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    weekMs += acc.days[localDateKey(d)] ?? 0
  }
  return { totalMs: acc.totalMs, lastSessionMs: acc.lastSessionMs, weekMs, sessions: acc.sessions }
}
