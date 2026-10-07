import { totalmem } from 'node:os'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { app } from 'electron'
import { createMinecraftProcessWatcher, launch } from '@xmcl/core'
import type { GameProgress, GameStage, GameState } from '@shared/game'
import { getLaunchCredentials } from '../auth/accounts'
import { AuthError } from '../auth/errors'
import { ensureGameInstalled, instanceLogPath } from './install'
import { gamePaths } from './target'
import { getContent } from '../remote/content'
import { syncClient } from '../sync/sync'
import { GameError, toGameError } from './util'

let state: GameState = { phase: 'idle', progress: null, runningAccounts: [], error: null }
let onState: (s: GameState) => void = () => {}

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

/** Install if needed, then start Minecraft for the given account. */
export async function play(accountId: string): Promise<void> {
  if (state.phase === 'preparing') return
  if (state.runningAccounts.includes(accountId)) {
    set({ error: { code: 'alreadyRunning' } })
    return
  }
  set({ phase: 'preparing', progress: null, error: null })

  try {
    const report = progressReporter()
    const { manifest } = await getContent(true).catch((err) => {
      throw new GameError('content', String(err))
    })
    const { versionId, javaPath } = await ensureGameInstalled({ minecraft: manifest.minecraft, fabricLoader: manifest.loader.version }, report)
    const synced = await syncClient(manifest, report('mods'))
    console.log(`[game] client ${manifest.clientVersion} in sync: ${synced.downloaded} downloaded, ${synced.placed} placed, ${synced.removed} removed`)

    report('launching')(null)
    const creds = await getLaunchCredentials(accountId).catch((err) => {
      throw new GameError(err instanceof AuthError && err.code === 'microsoftDenied' ? 'sessionExpired' : 'notSignedIn', String(err))
    })

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
      // The game keeps running if the launcher is closed.
      extraExecOption: { detached: true, windowsHide: true },
    })
    proc.unref()
    watch(proc, accountId)
    set({ phase: 'running', progress: null, runningAccounts: [...state.runningAccounts, accountId] })
  } catch (err) {
    const e = toGameError(err)
    console.error('[game] play failed:', e.message)
    set({ phase: state.runningAccounts.length ? 'running' : 'idle', progress: null, error: { code: e.code, detail: e.message } })
  }
}

function watch(proc: Parameters<typeof createMinecraftProcessWatcher>[0], accountId: string): void {
  const startedAt = Date.now()
  const watcher = createMinecraftProcessWatcher(proc)
  watcher.on('minecraft-exit', ({ code, crashReportLocation }: { code: number; crashReportLocation?: string }) => {
    const runningAccounts = state.runningAccounts.filter((id) => id !== accountId)
    // Exit code 0 = player quit normally. Anything else after a short time is a crash.
    const crashed = code !== 0 && code !== null
    set({
      phase: runningAccounts.length ? 'running' : state.phase === 'preparing' ? 'preparing' : 'idle',
      runningAccounts,
      error: crashed
        ? { code: 'crashed', detail: crashReportLocation ?? lastLogLines() ?? `exit code ${code} after ${Math.round((Date.now() - startedAt) / 1000)} s` }
        : state.error,
    })
  })
}

function lastLogLines(): string | undefined {
  const path = instanceLogPath()
  if (!existsSync(path)) return undefined
  return readFileSync(path, 'utf8').trimEnd().split('\n').slice(-8).join('\n')
}
