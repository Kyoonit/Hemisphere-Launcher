import { app } from 'electron'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type { PlaytimeSummary } from '@shared/server'

/**
 * Local playtime per account (playtime.json in the launcher's data folder). Never uploaded.
 *
 * Recording: a session file is written when the game starts. When the game exits, the session is added.
 * If the launcher was closed while playing, the session is recovered at the next start: the game's end time is
 * the last write of its latest.log (Minecraft writes to it until it quits).
 */
const AccountPlaytimeSchema = z.object({
  totalMs: z.number().nonnegative(),
  sessions: z.number().int().nonnegative(),
  lastSessionMs: z.number().nonnegative().nullable(),
  /** "YYYY-MM-DD" (local date) -> ms played that day */
  days: z.record(z.string(), z.number().nonnegative()),
})
const PlaytimeFileSchema = z.object({ accounts: z.record(z.string(), AccountPlaytimeSchema) })
type PlaytimeFile = z.infer<typeof PlaytimeFileSchema>

const SessionSchema = z.object({ accountId: z.string(), pid: z.number().int(), startedAt: z.number() })

/** Sessions shorter than this are game crashes on load, not play. */
const MIN_SESSION_MS = 30_000
/** Guard against a wrong PC clock or a stuck process. */
const MAX_SESSION_MS = 24 * 60 * 60_000

const EMPTY: PlaytimeSummary = { totalMs: 0, lastSessionMs: null, weekMs: 0, sessions: 0 }

const filePath = () => join(app.getPath('userData'), 'playtime.json')
const sessionDir = () => join(app.getPath('userData'), 'playtime-sessions')
const sessionPath = (accountId: string) => join(sessionDir(), `${accountId}.json`)

export function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function readAll(): Promise<PlaytimeFile> {
  try {
    const parsed = PlaytimeFileSchema.safeParse(JSON.parse(await readFile(filePath(), 'utf8')))
    return parsed.success ? parsed.data : { accounts: {} }
  } catch {
    return { accounts: {} }
  }
}

export async function getPlaytime(accountId: string): Promise<PlaytimeSummary> {
  const acc = (await readAll()).accounts[accountId]
  if (!acc) return EMPTY
  let weekMs = 0
  for (let i = 0; i < 7; i++) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    weekMs += acc.days[localDateKey(d)] ?? 0
  }
  return { totalMs: acc.totalMs, lastSessionMs: acc.lastSessionMs, weekMs, sessions: acc.sessions }
}

/** Splits [start, end) across local calendar days (a session past midnight counts for both days). */
export function splitByDay(start: number, end: number): Record<string, number> {
  const out: Record<string, number> = {}
  let t = start
  while (t < end) {
    const d = new Date(t)
    const nextMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()
    const slice = Math.min(end, nextMidnight) - t
    out[localDateKey(d)] = (out[localDateKey(d)] ?? 0) + slice
    t += slice
  }
  return out
}

let writeQueue: Promise<unknown> = Promise.resolve()

/** Adds one finished session. Returns false if it was too short/long to count. */
export function recordSession(accountId: string, startedAt: number, endedAt: number): Promise<boolean> {
  const run = writeQueue.then(async () => {
    const ms = endedAt - startedAt
    if (ms < MIN_SESSION_MS || ms > MAX_SESSION_MS) return false
    const data = await readAll()
    const acc = (data.accounts[accountId] ??= { totalMs: 0, sessions: 0, lastSessionMs: null, days: {} })
    acc.totalMs += ms
    acc.sessions += 1
    acc.lastSessionMs = ms
    for (const [day, part] of Object.entries(splitByDay(startedAt, endedAt))) acc.days[day] = (acc.days[day] ?? 0) + part
    // keep ~ one year of daily buckets
    for (const day of Object.keys(acc.days).sort().slice(0, -400)) delete acc.days[day]
    const tmp = `${filePath()}.tmp`
    await writeFile(tmp, JSON.stringify(data))
    await rename(tmp, filePath())
    return true
  })
  writeQueue = run.catch(() => {})
  return run
}

/** Called right after the game process starts. */
export async function startSession(accountId: string, pid: number): Promise<void> {
  await mkdir(sessionDir(), { recursive: true })
  await writeFile(sessionPath(accountId), JSON.stringify({ accountId, pid, startedAt: Date.now() }))
}

/** Called when the game exits while the launcher is running. */
export async function endSession(accountId: string): Promise<boolean> {
  try {
    const s = SessionSchema.parse(JSON.parse(await readFile(sessionPath(accountId), 'utf8')))
    await rm(sessionPath(accountId), { force: true })
    return recordSession(s.accountId, s.startedAt, Date.now())
  } catch {
    return false
  }
}

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0) // signal 0 = existence check only
    return true
  } catch {
    return false
  }
}

/**
 * At launcher start: finish sessions left open because the launcher was closed during play.
 * Still-running games are watched until they exit. `logPath` = the instance's latest.log.
 */
export async function recoverSessions(logPath: string, onRecorded: () => void): Promise<void> {
  const files = await readdir(sessionDir()).catch(() => [] as string[])
  for (const name of files) {
    const path = join(sessionDir(), name)
    let s: z.infer<typeof SessionSchema>
    try {
      s = SessionSchema.parse(JSON.parse(await readFile(path, 'utf8')))
    } catch {
      await rm(path, { force: true })
      continue
    }
    const finish = async () => {
      const logMtime = (await stat(logPath).catch(() => null))?.mtimeMs ?? 0
      const end = logMtime > s.startedAt ? Math.min(logMtime, Date.now()) : s.startedAt
      await rm(path, { force: true })
      if (await recordSession(s.accountId, s.startedAt, end)) onRecorded()
    }
    if (!isAlive(s.pid)) await finish()
    else {
      const timer = setInterval(() => {
        if (!isAlive(s.pid)) {
          clearInterval(timer)
          void finish()
        }
      }, 15_000)
    }
  }
}
