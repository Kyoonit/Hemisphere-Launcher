import { freemem, totalmem } from 'node:os'
import { autoMemoryMb, withGcArgs } from '@shared/memory'
import { existsSync, readFileSync } from 'node:fs'
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
import { backgroundDownloadsAllowed } from '../system/network'
import { gamePaths } from './target'
import { getContent, getPreviousManifest } from '../remote/content'
import { getSettings } from '../settings/settings'
import { parseJvmArgs } from '@shared/settings'
import { inspectJava } from './java'
import { physicalPath } from '../system/redirect'
import { applyGpuPreference } from '../system/gpu'
import { disableAllPlayerMods } from '../importer/importer'
import { parkDuplicates } from '../modrinth/playerMods'
import { parseIncompatibleMods } from '@shared/crash'
import { readInstanceState } from '../sync/sync'
import { endSession, startSession } from '../playtime/playtimeStore'
import { cleanStore, syncClient } from '../sync/sync'
import { createRestorePoint } from '../backup/restorePoints'
import { devEnabled } from '../dev/devTools'
import type { ClientManifest } from '@shared/manifest'
import { GameError, toGameError } from './util'

let state: GameState = { phase: 'idle', activity: null, progress: null, runningAccounts: [], error: null, background: false }
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

/** Developer tab only (development build or staff code): show a pretend game state (crash card, errors, progress). */
export function simulateGameState(patch: Partial<GameState>): void {
  if (devEnabled()) set(patch)
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

/** Recommended memory for this PC (used when the player hasn't chosen one). */
// ------------------------------------------------------------------------------ background preparation
let backgroundJob: Promise<void> | null = null

async function waitForBackground(): Promise<void> {
  await backgroundJob?.catch(() => {})
}

/**
 * Prepares the next PLAY while the launcher is open: installs a client update for the same Minecraft version and
 * checks Minecraft, Java and Fabric. It never switches to a new Minecraft version (that stays the player's choice:
 * "Update to …"), and never runs during a game, a launch or a repair. PLAY started meanwhile simply waits for it
 * (showing its progress) and then has nothing left to do.
 */
/** A whole-mod-folder change (set switch, restore, setup import) is running: background preparation waits. */
let modsHeld = 0
/** The running held change, for PLAY and repair to wait for. */
let heldJob: Promise<unknown> = Promise.resolve()
const gameBusy = () => state.phase === 'preparing' || state.runningAccounts.length > 0

/**
 * Runs a change to the mods with the background preparation out of the way: waits for a running one, keeps a new one
 * from starting meanwhile (its sync would save an older copy of the player's choices over the change), then prepares
 * the result. Refused (null) while a game runs or PLAY/repair is preparing.
 */
export async function withModsHeld<T>(job: () => Promise<T>): Promise<T | null> {
  if (gameBusy()) return null
  modsHeld++
  const run = (async () => {
    await waitForBackground()
    return gameBusy() ? null : job()
  })()
  heldJob = run.catch(() => {})
  try {
    return await run
  } finally {
    modsHeld--
    if (!modsHeld) void prepareInBackground()
  }
}

export function prepareInBackground(): Promise<void> {
  if (backgroundJob) return backgroundJob
  if (modsHeld) return Promise.resolve()
  if (state.phase !== 'idle' || state.runningAccounts.length || !getSettings().backgroundUpdates) return Promise.resolve()
  backgroundJob = (async () => {
    // metered connection (phone hotspot, 4G): PLAY downloads what's needed, nothing is fetched ahead
    if (!(await backgroundDownloadsAllowed())) return void (backgroundJob = null)
    set({ background: true })
    const started = Date.now()
    try {
      const { manifest } = await getContent(true)
      const installed = await readInstanceState()
      if (installed.minecraft && installed.minecraft !== manifest.minecraft) return // new Minecraft version: player decides
      const report = progressReporter()
      await ensureGameInstalled({ minecraft: manifest.minecraft, fabricLoader: manifest.loader.version }, report)
      await pointBeforeClientChange(installed.clientVersion, manifest)
      const synced = await syncClient(manifest, report('mods'))
      console.log(`[background] client ${manifest.clientVersion} ready (${synced.downloaded} downloaded, ${synced.placed} placed) in ${Math.round((Date.now() - started) / 1000)} s`)
    } catch (err) {
      console.warn('[background] skipped:', toGameError(err).message)
    } finally {
      backgroundJob = null
      set({ background: false, ...(state.phase === 'idle' ? { progress: null } : {}) })
    }
  })()
  return backgroundJob
}

/** xmcl's launch precheck errors for missing/corrupt version json, client jar or libraries. */
function isMissingGameFiles(err: unknown): boolean {
  const code = (err as { error?: unknown } | null)?.error
  return code === 'MissingLibraries' || code === 'CorruptedVersionJar' || code === 'MissingVersionJson'
}

/** A new (or older) client is about to replace the installed one: keep a restore point of the player's setup first. */
async function pointBeforeClientChange(installed: string | null, manifest: ClientManifest): Promise<void> {
  if (installed && installed !== manifest.clientVersion)
    await createRestorePoint({ kind: 'clientUpdate', from: installed, to: manifest.clientVersion }, { clientVersion: installed, minecraft: manifest.minecraft })
}

/** Hides the last error card (the player closed it). */
export function dismissGameError(): void {
  if (state.error) set({ error: null })
}

export function recommendedMemoryMb(): number {
  const gb = totalmem() / 1024 ** 3
  return gb <= 6 ? 2048 : gb <= 8 ? 3072 : gb <= 16 ? 4096 : 6144
}

/**
 * The PLAY flow:  account (fresh session) → client definition → Minecraft/Java/Fabric → Hemisphere mods →
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
    await heldJob // a set switch or restore in progress finishes first
    await waitForBackground() // its progress shows while we wait; afterwards the steps below have nothing left to do
    const report = progressReporter()

    if (opts.withoutPlayerMods) {
      const moved = await disableAllPlayerMods(Object.keys((await readInstanceState()).owned))
      console.log(`[game] launching without player mods (${moved} parked in mods-disabled)`)
    }

    // 1. Account: fresh Minecraft session.
    report('account')(null)
    const creds = await getLaunchCredentials(accountId).catch((err) => {
      throw new GameError(err instanceof AuthError && err.code === 'microsoftDenied' ? 'sessionExpired' : 'notSignedIn', String(err))
    })

    // 2. Client definition: latest, or the previous one for "Play on <old version>".
    const content = await getContent(true).catch((err) => {
      throw new GameError('content', String(err))
    })
    const manifest = opts.target === 'previous' ? await getPreviousManifest() : content.manifest
    if (!manifest) throw new GameError('content', 'previous client not available')

    // 3-5. Minecraft + Java + Fabric, then Hemisphere mods (only what changed).
    const target = { minecraft: manifest.minecraft, fabricLoader: manifest.loader.version }
    let { versionId, javaPath } = await ensureGameInstalled(target, report)
    await pointBeforeClientChange((await readInstanceState()).clientVersion, manifest)
    // The player's own mods (and Hemisphere mods they took over) are never updated by PLAY: they choose when, in
    // Mods. If one doesn't work with this version, the crash card names it.
    const synced = await syncClient(manifest, report('mods'))
    const afterSync = await readInstanceState()
    await parkDuplicates(Object.keys(afterSync.owned), manifest, new Set(afterSync.detached)).catch((err) => console.warn('[game] duplicate check failed:', err))
    console.log(`[game] client ${manifest.clientVersion} in sync: ${synced.downloaded} downloaded, ${synced.placed} placed, ${synced.removed} removed`)

    // 6. Launch (+ join Hemisphere directly when enabled; never from an older client).
    report('launching')(null)
    const autoJoin = getSettings().autoJoin && opts.target === 'latest'

    const paths = gamePaths()
    const settings = getSettings()
    // automatic memory adapts to what's free right now (other programs open): too much makes Windows swap
    const memory = settings.memoryMb ?? autoMemoryMb(recommendedMemoryMb(), Math.round(freemem() / 1024 ** 2))
    if (settings.memoryMb === null) console.log(`[game] memory: ${memory} MB (recommended ${recommendedMemoryMb()} MB, ${Math.round(freemem() / 1024 ** 2)} MB free)`)
    const resolution =
      settings.resolution === 'fullscreen'
        ? { fullscreen: true }
        : settings.resolution !== 'auto'
          ? { width: Number(settings.resolution.split('x')[0]), height: Number(settings.resolution.split('x')[1]) }
          : undefined
    // Pass the physical paths: if Windows redirects the folder (app containers, sync or security tools), Java sees
    // the real location and Fabric would otherwise treat its own loader as two different files and crash.
    const real = (p: string) => physicalPath(p, app.getPath('userData'))
    // Java to run, with Windows' "High performance" graphics preference on PCs with two graphics chips.
    const javaFor = async (installed: string) => {
      const exe = real(await chooseJava(installed))
      await applyGpuPreference(exe, settings.highPerformanceGpu).catch((err) => console.warn('[gpu] preference not applied:', err))
      return exe
    }
    const start = async () =>
      launch({
        gamePath: real(paths.instance),
        resourcePath: real(paths.minecraft),
        javaPath: await javaFor(javaPath),
        version: versionId,
        gameProfile: { name: creds.name, id: creds.uuid },
        accessToken: creds.accessToken,
        userType: creds.userType as 'mojang', // Minecraft accepts "msa"; xmcl's type predates it
        launcherName: 'hemisphere-launcher',
        launcherBrand: `Hemisphere Launcher ${app.getVersion()}`,
        minMemory: Math.min(1024, memory),
        maxMemory: memory,
        ...(resolution ? { resolution } : {}),
        // the official launcher's garbage collector settings (smoother frame times), unless the player chose their own
        extraJVMArgs: withGcArgs(parseJvmArgs(settings.jvmArgs).args),
        // The game is fully independent of the launcher: its own process group, and no pipes. Minecraft writes its
        // own logs; if the launcher's end of a pipe closed (launcher closed while playing), the game would freeze.
        extraExecOption: { detached: true, windowsHide: true, stdio: 'ignore' },
        ...(autoJoin ? { quickPlayMultiplayer: `${SERVER.host}:${SERVER.port}` } : {}),
      })
    let proc: Awaited<ReturnType<typeof launch>>
    try {
      proc = await start()
    } catch (err) {
      // Minecraft's own pre-launch check found missing or damaged game files (deleted by the player, an antivirus,
      // a disk error…): check everything, download what is missing and try once more, like Repair would.
      if (!isMissingGameFiles(err)) throw err
      console.warn(`[game] ${(err as Error).message} — checking the installation and trying again`)
      ;({ versionId, javaPath } = await ensureGameInstalled(target, report, true))
      report('launching')(null)
      proc = await start()
    }
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
    await heldJob
    await waitForBackground()
    const report = progressReporter()
    const { manifest } = await getContent(true).catch((err) => {
      throw new GameError('content', String(err))
    })
    const info: GameRepairInfo = { minecraftIssues: [] }
    await ensureGameInstalled({ minecraft: manifest.minecraft, fabricLoader: manifest.loader.version }, report, true, info)
    if (mode === 'full') await createRestorePoint({ kind: 'repair' }, { clientVersion: manifest.clientVersion, minecraft: manifest.minecraft })
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

/** The player's own Java if set and good enough for this Minecraft version, otherwise Hemisphere's. */
async function chooseJava(managed: string): Promise<string> {
  const custom = getSettings().javaPath
  if (!custom) return managed
  const [mine, required] = await Promise.all([inspectJava(custom, false), inspectJava(managed, true)])
  if (mine && required && mine.majorVersion >= required.majorVersion) return custom
  console.warn(`[game] custom Java ${custom} unusable (${mine ? 'Java ' + mine.majorVersion : 'not found'}), using Hemisphere's Java`)
  return managed
}

function watch(proc: ChildProcess, accountId: string): void {
  const startedAt = Date.now()
  const memoryMb = getSettings().memoryMb ?? autoMemoryMb(recommendedMemoryMb(), Math.round(freemem() / 1024 ** 2))
  proc.once('exit', (code) => {
    void endSession(accountId).then((recorded) => recorded && gameEvents.onPlaytimeChanged())
    const runningAccounts = state.runningAccounts.filter((id) => id !== accountId)
    // Exit code 0 = player quit normally. Anything else is a crash.
    const crashed = code !== 0 && code !== null
    set({
      phase: runningAccounts.length ? 'running' : state.phase === 'preparing' ? 'preparing' : 'idle',
      runningAccounts,
      error: crashed
        ? {
            code: 'crashed',
            detail: newCrashReport(startedAt) ?? lastLogLines() ?? `exit code ${code} after ${Math.round((Date.now() - startedAt) / 1000)} s`,
            suspects: crashSuspects(startedAt),
            incompatible: incompatibleMods(startedAt),
            ...(ranOutOfMemory(startedAt) ? { outOfMemory: { memoryMb } } : {}),
          }
        : state.error,
    })
    gameEvents.onExited({ accountId, crashed, anyRunning: runningAccounts.length > 0 })
  })
}

/**
 * Mods Fabric refused to load because they don't fit this game (wrong Minecraft version, missing or too old a
 * dependency), from its "Incompatible mods found!" report in the game log:
 *   - Mod 'Jade' (jade) 26.3.5 requires version 26.4 of minecraft, but only the wrong version is present: 26.3!
 *   - Replace mod 'Jade' (jade) 26.3.5 with any version that is compatible with: …
 */
function incompatibleMods(since: number): { name: string; version: string; needs: string }[] {
  const log = instanceLogPath()
  let text = ''
  try {
    if (existsSync(log) && statSync(log).mtimeMs >= since - 2000) text = readFileSync(log, 'utf8').slice(-200_000)
  } catch {
    return []
  }
  return parseIncompatibleMods(text)
}

/** Mod ids named in the crash output ("provided by 'x'", "from mod x"), most-mentioned first. */
function crashSuspects(since: number): string[] {
  const texts = [newCrashReport(since), instanceLogPath()].flatMap((p) => {
    try {
      // only files written by this launch (a JVM that fails instantly leaves the previous run's log behind)
      return p && existsSync(p) && statSync(p).mtimeMs >= since - 2000 ? [readFileSync(p, 'utf8').slice(-200_000)] : []
    } catch {
      return []
    }
  })
  const counts = new Map<string, number>()
  const IGNORE = new Set(['minecraft', 'java', 'fabricloader', 'fabric-loader', 'mixinextras'])
  for (const t of texts)
    for (const m of t.matchAll(/(?:provided by '|from mod |by mod )([a-z0-9_.-]{2,64})/g))
      if (!IGNORE.has(m[1])) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id).slice(0, 5)
}

/** This session ended because memory ran out: in the crash report, the game log, or Java's own hs_err file. */
function ranOutOfMemory(since: number): boolean {
  const dir = gamePaths().instance
  const files = [newCrashReport(since), instanceLogPath()]
  try {
    for (const name of readdirSync(dir)) if (/^hs_err_pid\d+\.log$/.test(name)) files.push(join(dir, name))
  } catch {
    /* no folder */
  }
  return files.some((p) => {
    try {
      return !!p && existsSync(p) && statSync(p).mtimeMs >= since - 2000 && /java\.lang\.OutOfMemoryError|insufficient memory for the Java Runtime/.test(readFileSync(p, 'utf8').slice(-300_000))
    } catch {
      return false
    }
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
