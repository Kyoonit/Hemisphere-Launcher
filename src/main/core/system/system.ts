import { app, clipboard, shell } from 'electron'
import { cpus, release, totalmem } from 'node:os'
import { existsSync, readFileSync } from 'node:fs'
import { copyFile, cp, mkdir, readdir, rename, rm, stat, statfs, utimes, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, normalize, relative, resolve } from 'node:path'
import { parseJvmArgs, type PreflightWarning, type SystemInfo } from '@shared/settings'
import { defaultGameDir, gamePaths } from '../game/target'
import { recommendedMemoryMb } from '../game/gameService'
import { inspectJava } from '../game/java'
import { installedJavaPath } from '../game/install'
import { getSettings, updateSettings } from '../settings/settings'
import { readInstanceState } from '../sync/sync'
import { launcherLogDir, launcherLogPath, redact } from '../logging/logger'
import { getAccountsState } from '../auth/accounts'
import { gpuSummary } from './gpu'

export function systemInfo(): SystemInfo {
  const totalMemoryMb = Math.round(totalmem() / 1024 / 1024)
  return {
    totalMemoryMb,
    recommendedMemoryMb: recommendedMemoryMb(),
    // leave at least 2 GB to Windows; Minecraft rarely benefits from more than 16 GB
    maxMemoryMb: Math.max(2048, Math.min(16384, Math.floor((totalMemoryMb - 2048) / 512) * 512)),
    defaultGameDir: defaultGameDir(),
    gameDir: gamePaths().root,
    packaged: app.isPackaged,
    hybridGpu: gpuSummary().hybrid,
    gpuNames: gpuSummary().names,
  }
}

/** Things worth telling the player before PLAY (never blocking). */
export async function preflightWarnings(): Promise<PreflightWarning[]> {
  const out: PreflightWarning[] = []
  // free space on the drive of the game folder (or its nearest existing parent)
  let dir = gamePaths().root
  while (!existsSync(dir) && dirname(dir) !== dir) dir = dirname(dir)
  const fsStats = await statfs(dir).catch(() => null)
  if (fsStats) {
    const freeGb = (fsStats.bavail * fsStats.bsize) / 1024 ** 3
    if (freeGb < LOW_DISK_GB) out.push({ code: 'lowDisk', value: Math.round(freeGb * 10) / 10 })
  }
  const totalGb = totalmem() / 1024 ** 3
  if (totalGb < LOW_RAM_GB) out.push({ code: 'lowRam', value: Math.round(totalGb) })
  return out
}
const LOW_DISK_GB = 2
const LOW_RAM_GB = 6

export type FolderKind = 'game' | 'mods' | 'screenshots' | 'gameLogs' | 'crashReports' | 'launcherLogs'

export async function openFolder(kind: FolderKind): Promise<void> {
  const p = gamePaths()
  const path = {
    game: p.instance,
    mods: join(p.instance, 'mods'),
    screenshots: join(p.instance, 'screenshots'),
    gameLogs: join(p.instance, 'logs'),
    crashReports: join(p.instance, 'crash-reports'),
    launcherLogs: launcherLogDir(),
  }[kind]
  await mkdir(path, { recursive: true })
  await shell.openPath(path)
}

const tail = (file: string, lines: number) => {
  try {
    return readFileSync(file, 'utf8').trimEnd().split('\n').slice(-lines).join('\n')
  } catch {
    return '(none)'
  }
}

/** Text for support requests. Contains no tokens, emails or account names. Also copied to the clipboard. */
export async function copyDiagnostics(): Promise<string> {
  const s = getSettings()
  const state = await readInstanceState()
  const managedJava = await installedJavaPath()
  const java = s.javaPath ? await inspectJava(s.javaPath, false) : managedJava ? await inspectJava(managedJava, true) : null
  const cpu = cpus()[0]?.model ?? 'unknown'
  const text = [
    '### Hemisphere Launcher diagnostics',
    `Launcher: ${app.getVersion()} (Electron ${process.versions.electron})`,
    `Windows: ${release()} ${process.arch} · CPU: ${cpu} (${cpus().length} threads) · RAM: ${Math.round(totalmem() / 1024 ** 3)} GB`,
    `Client: ${state.clientVersion ?? 'not installed'} · Minecraft ${state.minecraft ?? '-'} · ${Object.keys(state.owned).length} Hemisphere files`,
    `Java: ${java ? `${java.version} (${s.javaPath ? 'custom' : 'managed'})` : 'not installed'}`,
    `Memory: ${s.memoryMb ? `${s.memoryMb} MB` : `auto (${recommendedMemoryMb()} MB)`} · Window: ${s.resolution} · JVM args: ${parseJvmArgs(s.jvmArgs).args.join(' ') || 'none'}`,
    `Game folder: ${s.gameDir ? 'custom' : 'default'} · Auto-join: ${s.autoJoin} · On game start: ${s.onGameStart}`,
    '',
    '--- last game log lines ---',
    tail(join(gamePaths().instance, 'logs', 'latest.log'), 40),
    '',
    '--- last launcher log lines ---',
    tail(launcherLogPath(), 40),
  ].join('\n')
  let safe = redact(text).replaceAll(app.getPath('home'), '%USERPROFILE%')
  // Player names appear in game logs ("Setting user: …"): mask them too.
  for (const { name } of getAccountsState().accounts)
    // Minecraft names are only letters, digits and "_", so they are safe inside a RegExp.
    if (/^\w+$/.test(name)) safe = safe.replace(new RegExp(`\\b${name}\\b`, 'g'), '<player>')
  clipboard.writeText(safe)
  return safe
}

/** What lives in the game folder (everything else in the launcher's data folder stays put). */
const GAME_ITEMS = ['minecraft', 'runtime', 'instance', 'store', 'install-state.json']

export type MoveResult = { ok: true; gameDir: string } | { ok: false; reason: 'busy' | 'notEmpty' | 'invalid' | 'tooLong' | 'notWritable' | 'failed'; detail?: string }

/**
 * Moves the game folder (Minecraft, Java, instance, store) to `target`. Same drive: instant rename.
 * Other drive: copy, then delete the old copy only after everything was copied.
 */
export async function moveGameFolder(target: string, busy: boolean, onProgress: (ratio: number) => void = () => {}): Promise<MoveResult> {
  if (busy) return { ok: false, reason: 'busy' }
  if (!isAbsolute(target)) return { ok: false, reason: 'invalid' }
  const from = resolve(gamePaths().root)
  const to = resolve(normalize(target))
  const toDefault = to.toLowerCase() === resolve(defaultGameDir()).toLowerCase()
  if (to.toLowerCase() === from.toLowerCase()) return { ok: true, gameDir: to }

  const inside = (a: string, b: string) => {
    const r = relative(a, b)
    return r !== '' && !r.startsWith('..') && !isAbsolute(r)
  }
  if (!toDefault && (inside(from, to) || inside(to, from))) return { ok: false, reason: 'invalid', detail: 'inside the current folder' }
  if (/^[a-z]:\\(windows|program files( \(x86\))?|programdata)(\\|$)/i.test(to)) return { ok: false, reason: 'invalid', detail: 'system folder' }
  // Minecraft's native libraries end up ~110 characters deep: keep the total under Windows' 260 limit.
  if (to.length > 120) return { ok: false, reason: 'tooLong' }

  await mkdir(to, { recursive: true }).catch(() => {})
  const existing = await readdir(to).catch(() => null)
  if (!existing) return { ok: false, reason: 'notWritable' }
  if (toDefault ? GAME_ITEMS.some((i) => existsSync(join(to, i))) : existing.length > 0) return { ok: false, reason: 'notEmpty' }
  try {
    const probe = join(to, '.hemisphere-write-test')
    await writeFile(probe, 'ok')
    await rm(probe)
  } catch {
    return { ok: false, reason: 'notWritable' }
  }

  const moved: string[] = []
  let copyTotal = 0
  let copied = 0
  try {
    for (const item of GAME_ITEMS) {
      const src = join(from, item)
      if (!existsSync(src)) continue
      try {
        await rename(src, join(to, item)) // same drive: instant
      } catch {
        // Other drive: copy file by file (with progress), then delete the original.
        if (!copyTotal) copyTotal = (await Promise.all(GAME_ITEMS.map((i) => sizeOf(join(from, i))))).reduce((a, b) => a + b, 0)
        await copyTree(src, join(to, item), (n) => {
          copied += n
          onProgress(Math.min(0.99, copied / copyTotal))
        })
        await rm(src, { recursive: true, force: true })
      }
      moved.push(item)
    }
    onProgress(1)
    await updateSettings({ gameDir: toDefault ? null : to })
    console.log(`[system] game folder moved to ${to}`)
    return { ok: true, gameDir: to }
  } catch (err) {
    console.error('[system] moving the game folder failed, putting files back:', err)
    // Roll back what was already moved so the game folder is never split in two.
    for (const item of moved.reverse()) {
      await rename(join(to, item), join(from, item)).catch(() =>
        cp(join(to, item), join(from, item), { recursive: true, preserveTimestamps: true }).then(() => rm(join(to, item), { recursive: true, force: true })),
      )
    }
    return { ok: false, reason: 'failed', detail: String(err) }
  }
}

/** Total size of a file or folder in bytes. */
async function sizeOf(path: string): Promise<number> {
  const st = await stat(path).catch(() => null)
  if (!st) return 0
  if (!st.isDirectory()) return st.size
  let total = 0
  for (const name of await readdir(path)) total += await sizeOf(join(path, name))
  return total
}

/** Recursive copy that reports bytes and keeps modification times (the sync engine uses them). */
async function copyTree(src: string, dest: string, onBytes: (n: number) => void): Promise<void> {
  const st = await stat(src)
  if (st.isDirectory()) {
    await mkdir(dest, { recursive: true })
    for (const name of await readdir(src)) await copyTree(join(src, name), join(dest, name), onBytes)
    return
  }
  await copyFile(src, dest)
  await utimes(dest, st.atime, st.mtime)
  onBytes(st.size)
}
