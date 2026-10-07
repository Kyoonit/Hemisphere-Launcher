import { totalmem } from 'node:os'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { app } from 'electron'
import type { ChildProcess } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { launch } from '@xmcl/core'
import type { GameProgress, GameStage, GameState, PlayOptions, RepairMode, RepairReport } from '@shared/game'
import { SERVER } from '@shared/server'
import { getLaunchCredentials } from '../auth/accounts'
import { AuthError } from '../auth/errors'
import { ensureGameInstalled, instanceLogPath, type GameRepairInfo } from './install'
import { gamePaths } from './target'
import { getContent, getPreviousManifest } from '../remote/content'
import { checkWhitelist } from '../hemisphere-api/whitelist'
import { getSettings } from '../settings/settings'
import { endSession, startSession } from '../playtime/playtimeStore'
import { cleanStore, syncClient } from '../sync/sync'
import { GameError, toGameError } from './util'

let state: GameState = { phase: 'idle', activity: null, progress: null, runningAccounts: [], error: null }
let onState: (s: GameState) => void = () => {}

/** Window behaviour + UI refresh hooks, set by the main process. */
export const gameEvents = {
  onLaunched: (_accountId: string) => {},
  onExited: (_info: { accountId: string; crashed: boolean; anyRunning: boolean }) => {},
  onPlaytimeChanged: () => {},
}

export const getGameState = () => state
export function onGameState(cb: (s: GameState) => void): void {
  onState = cb
}

function set(patch: Partial<GameState>): void {
  state = { ...state, ...patch }
  onState(state)
}

/** Progress events arrive hundreds of times per second; forward at most ~10/s. */
function progressReporter() {
  let last = 0
  return (stage: GameStage) =>
    (ratio: number | null, detail?: string) => {
      const now = Date.now()
      if (ratio !== null && ratio < 1 && now - last < 100 && state.progress?.stage === stage) return
      last = now
      const progress: GameProgress = { stage, ratio: ratio === null ? null : Math.min(1, ratio), detail }
      set({ progress })
    }
}

/** Default memory from the PC's RAM (becomes a setting in Phase 13). */
export function recommendedMemoryMb(): number {
  const gb = totalmem() / 1024 ** 3
  return gb <= 6 ? 2048 : gb <= 8 ? 3072 : gb <= 16 ? 4096 : 6144
}

/**
 * The PLAY flow:  account (session + whitelist) → client definition → Minecraft/Java/Fabric → Hemisphere mods →
 * launch → (auto-join Hemisphere if enabled and on the latest client).
 */
export async function play(accountId: string, opts: PlayOptions = { target: 'latest' }): Promise<void> {
  if (state.phase === 'preparing') return
  if (state.runningAccounts.includes(accountId)) {
    set({ error: { code: 'alreadyRunning' } })
    return
  }
  set({ phase: 'preparing', activity: 'play', progress: null, error: null })

  try {
    const report = progressReporter()

    // 1. Account: fresh Minecraft session, then the whitelist (unknown = don't block).
    report('account')(null)
    const creds = await getLaunchCredentials(accountId).catch((err) => {
      throw new GameError(err instanceof AuthError && err.code === 'microsoftDenied' ? 'sessionExpired' : 'notSignedIn', String(err))
    })
    if (creds.userType === 'msa' && !opts.skipWhitelist && (await checkWhitelist(creds.uuid)) === false)
      throw new GameError('notWhitelisted')

    // 2. Client definition: latest, or the previous one for "Play on <old version>".
    const content = await getContent(true).catch((err) => {
      throw new GameError('content', String(err))
    })
    const manifest = opts.target === 'previous' ? await getPreviousManifest() : content.manifest
    if (!manifest) throw new GameError('content', 'previous client not available')

    // 3-5. Minecraft + Java + Fabric, then Hemisphere mods (only what changed).
    const { versionId, javaPath } = await ensureGameInstalled({ minecraft: manifest.minecraft, fabricLoader: manifest.loader.version }, report)
    const synced = await syncClient(manifest, report('mods'))
    console.log(`[game] client ${manifest.clientVersion} in sync: ${synced.downloaded} downloaded, ${synced.placed} placed, ${synced.removed} removed`)

    // 6. Launch (+ join Hemisphere directly when enabled; never from an older client).
    report('launching')(null)
    const autoJoin = getSettings().autoJoin && opts.target === 'latest'

    const paths = gamePaths()
    const memory = recommendedMemoryMb()
    // Pass fully resolved paths: if Windows redirects the folder (app containers, sync or security tools), Java sees
    // the real location and Fabric would otherwise treat its own loader as two different files and crash.
    const real = (p: string) => realpathSync.native(p)
    const proc = await launch({
      gamePath: real(paths.instance),
      resourcePath: real(paths.minecraft),
      javaPath: real(javaPath),
      version: versionId,
      gameProfile: { name: creds.name, id: creds.uuid },
      accessToken: creds.accessToken,
      userType: creds.userType as 'mojang', // Minecraft accepts "msa"; xmcl's type predates it
      launcherName: 'hemisphere-launcher',
      launcherBrand: `Hemisphere Launcher ${app.getVersion()}`,
      minMemory: Math.min(1024, memory),
      maxMemory: memory,
      // The game is fully independent of the launcher: its own process group, and no pipes. Minecraft writes its
      // own logs; if the launcher's end of a pipe closed (launcher closed while playing), the game would freeze.
      extraExecOption: { detached: true, windowsHide: true, stdio: 'ignore' },
      ...(autoJoin ? { quickPlayMultiplayer: `${SERVER.host}:${SERVER.port}` } : {}),
    })
    proc.unref()
    if (proc.pid) await startSession(accountId, proc.pid).catch(() => {})
    watch(proc, accountId)
    set({ phase: 'running', activity: null, progress: null, runningAccounts: [...state.runningAccounts, accountId] })
    gameEvents.onLaunched(accountId)
  } catch (err) {
    const e = toGameError(err)
    console.error('[game] play failed:', e.message)
    set({ phase: state.runningAccounts.length ? 'running' : 'idle', activity: null, progress: null, error: { code: e.code, detail: e.message } })
  }
}

/**
 * Repair: re-checks every file by hash (Minecraft, Java, Fabric, Hemisphere mods and configs) and fixes only what's
 * wrong. "full" also moves config/ aside (backup) and restores Hemisphere's configs. Worlds, screenshots, keybinds
 * (options.txt) and the server list are never touched.
 */
export async function repair(mode: RepairMode): Promise<RepairReport | { error: GameState['error'] }> {
  if (state.phase === 'preparing') return { error: { code: 'unknown', detail: 'already busy' } }
  if (state.runningAccounts.length) return { error: { code: 'busy' } }
  const started = Date.now()
  set({ phase: 'preparing', activity: 'repair', progress: null, error: null })
  try {
    const report = progressReporter()
    const { manifest } = await getContent(true).catch((err) => {
      throw new GameError('content', String(err))
    })
    const info: GameRepairInfo = { minecraftIssues: [] }
    await ensureGameInstalled({ minecraft: manifest.minecraft, fabricLoader: manifest.loader.version }, report, true, info)
    const synced = await syncClient(manifest, report('mods'), {
      verifyAll: true,
      restoreMissingDefaults: true,
      resetConfigs: mode === 'full',
    })
    const freedBytes = await cleanStore(manifest)
    set({ phase: 'idle', activity: null, progress: null })
    return {
      mode,
      verifiedFiles: synced.verified,
      repaired: synced.repaired.map(({ label, reason }) => ({ label, reason })),
      minecraftRepaired: info.minecraftIssues.length,
      downloadedBytes: synced.downloadedBytes,
      freedBytes,
      configBackup: synced.configBackup,
      durationMs: Date.now() - started,
    }
  } catch (err) {
    const e = toGameError(err)
    console.error('[game] repair failed:', e.message)
    const error = { code: e.code, detail: e.message }
    set({ phase: 'idle', activity: null, progress: null, error })
    return { error }
  }
}

function watch(proc: ChildProcess, accountId: string): void {
  const startedAt = Date.now()
  proc.once('exit', (code) => {
    void endSession(accountId).then((recorded) => recorded && gameEvents.onPlaytimeChanged())
    const runningAccounts = state.runningAccounts.filter((id) => id !== accountId)
    // Exit code 0 = player quit normally. Anything else is a crash.
    const crashed = code !== 0 && code !== null
    set({
      phase: runningAccounts.length ? 'running' : state.phase === 'preparing' ? 'preparing' : 'idle',
      runningAccounts,
      error: crashed
        ? { code: 'crashed', detail: newCrashReport(startedAt) ?? lastLogLines() ?? `exit code ${code} after ${Math.round((Date.now() - startedAt) / 1000)} s` }
        : state.error,
    })
    gameEvents.onExited({ accountId, crashed, anyRunning: runningAccounts.length > 0 })
  })
}

/** The crash report Minecraft wrote during this session, if any. */
function newCrashReport(since: number): string | undefined {
  const dir = join(gamePaths().instance, 'crash-reports')
  try {
    return readdirSync(dir)
      .map((name) => ({ path: join(dir, name), mtime: statSync(join(dir, name)).mtimeMs }))
      .filter((f) => f.mtime >= since)
      .sort((a, b) => b.mtime - a.mtime)[0]?.path
  } catch {
    return undefined
  }
}

function lastLogLines(): string | undefined {
  const path = instanceLogPath()
  if (!existsSync(path)) return undefined
  return readFileSync(path, 'utf8').trimEnd().split('\n').slice(-8).join('\n')
}
