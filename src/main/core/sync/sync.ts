import { copyFile, link, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ClientManifest } from '@shared/manifest'
import { applyToggle, resolveEnabled } from '@shared/modSelection'
import { gamePaths } from '../game/target'
import { GameError, type ProgressFn } from '../game/util'
import { placingNow } from './inFlight'
import { blobPath, DownloadError, downloadToStore, hasBlob, sha512OfFile, tempNameFor } from './download'
import { desiredFiles, emptyState, planSync, type DesiredFile, type InstanceState, type LocalInfo } from './plan'

/**
 * Brings the Hemisphere instance in line with the client manifest + the player's choices.
 * Only missing or changed files are downloaded; files the player added themselves are never touched.
 */

const CONCURRENCY = 4

const storeDir = () => join(gamePaths().root, 'store')
const statePath = () => join(gamePaths().instance, '.hemisphere', 'state.json')
const instancePath = (rel: string) => join(gamePaths().instance, ...rel.split('/'))

export async function readInstanceState(): Promise<InstanceState> {
  try {
    const s = JSON.parse(await readFile(statePath(), 'utf8')) as InstanceState
    return s.version === 1 ? { ...emptyState(), ...s } : emptyState()
  } catch {
    return emptyState()
  }
}

async function writeInstanceState(s: InstanceState): Promise<void> {
  await mkdir(dirname(statePath()), { recursive: true })
  const tmp = tempNameFor(statePath())
  await writeFile(tmp, JSON.stringify(s, null, 2))
  await rename(tmp, statePath())
}

async function localInfo(rel: string): Promise<LocalInfo | null> {
  try {
    const s = await stat(instancePath(rel))
    return s.isFile() ? { size: s.size, mtimeMs: s.mtimeMs } : null
  } catch {
    return null
  }
}

/** Places a verified store blob at its instance path, atomically. Jars are hard-linked (no extra disk space). */
async function place(f: DesiredFile): Promise<LocalInfo> {
  const dest = instancePath(f.path)
  await mkdir(dirname(dest), { recursive: true })
  const tmp = tempNameFor(dest)
  const blob = blobPath(storeDir(), f.sha512)
  try {
    if (f.policy === 'managed') await link(blob, tmp).catch(() => copyFile(blob, tmp))
    else await copyFile(blob, tmp) // configs get edited by the game: never share the store's copy
    await rename(tmp, dest)
  } catch (err) {
    await rm(tmp, { force: true })
    throw err
  }
  const s = await stat(dest)
  return { size: s.size, mtimeMs: s.mtimeMs }
}

async function pool<T>(items: T[], worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (next < items.length) await worker(items[next++])
    }),
  )
}

export interface SyncResult {
  downloaded: number
  downloadedBytes: number
  placed: number
  removed: number
  /** files checked by hash */
  verified: number
  /** files that were missing or damaged and got fixed (only files Hemisphere had placed before) */
  repaired: { label: string; path: string; reason: 'missing' | 'damaged' }[]
  /** Full reset: where the player's previous config folder was moved */
  configBackup?: string
}

export interface SyncOptions {
  /** Repair: hash every managed file instead of trusting size + date */
  verifyAll?: boolean
  /** Repair: put back Hemisphere "default" configs the player deleted */
  restoreMissingDefaults?: boolean
  /** Full reset: move config/ aside (backup) and install all Hemisphere configs fresh */
  resetConfigs?: boolean
}

export async function syncClient(manifest: ClientManifest, onProgress: ProgressFn, opts: SyncOptions = {}): Promise<SyncResult> {
  const state = await readInstanceState()
  let configBackup: string | undefined
  if (opts.resetConfigs) {
    const config = instancePath('config')
    if ((await localDir(config))) {
      const d = new Date() // player's local time, e.g. config.backup-2026-10-08_00-29
      const p = (n: number) => String(n).padStart(2, '0')
      const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}`
      configBackup = instancePath(`config.backup-${stamp}`)
      await rename(config, configBackup)
    }
    state.seeded = {}
    for (const rel of Object.keys(state.owned)) if (rel.startsWith('config/')) delete state.owned[rel]
  }
  const desired = desiredFiles(manifest, state.choices, state.detached)

  const local = new Map<string, LocalInfo>()
  for (const rel of new Set([...desired.map((f) => f.path), ...Object.keys(state.owned)])) {
    const info = await localInfo(rel)
    if (info) local.set(rel.toLowerCase(), info)
  }
  const plan = planSync(desired, state, local)
  const repaired: SyncResult['repaired'] = []

  if (opts.verifyAll) {
    plan.check.push(...plan.keep)
    plan.keep = []
  }
  if (opts.restoreMissingDefaults) {
    for (const f of desired)
      if (f.policy === 'default' && state.seeded[f.path] !== undefined && !local.has(f.path.toLowerCase())) {
        plan.place.push(f)
        repaired.push({ label: f.label, path: f.path, reason: 'missing' })
      }
  }
  // Hemisphere had placed it before and it's gone now = it went missing.
  for (const f of plan.place)
    if (state.owned[f.path] && !local.has(f.path.toLowerCase())) repaired.push({ label: f.label, path: f.path, reason: 'missing' })

  // Present but unknown/changed: keep it if the content is already right (e.g. after a crash mid-sync).
  for (const [i, f] of plan.check.entries()) {
    if (opts.verifyAll) onProgress(i / plan.check.length, f.label)
    if ((await sha512OfFile(instancePath(f.path))) === f.sha512) {
      const info = local.get(f.path.toLowerCase())!
      state.owned[f.path] = { sha512: f.sha512, size: info.size, mtimeMs: info.mtimeMs }
    } else {
      plan.place.push(f)
      if (state.owned[f.path]) repaired.push({ label: f.label, path: f.path, reason: 'damaged' })
    }
  }

  // Download what the store doesn't have yet.
  const missing: DesiredFile[] = []
  for (const f of plan.place) {
    if (missing.some((m) => m.sha512 === f.sha512)) continue
    // Jars are hard-linked: if a file in mods/ was edited in place, the store copy changed too.
    // Placing is rare, so re-check the store copy's hash and re-download it if it's no longer intact.
    if ((await hasBlob(storeDir(), f)) && (await sha512OfFile(blobPath(storeDir(), f.sha512))) === f.sha512) continue
    await rm(blobPath(storeDir(), f.sha512), { force: true })
    missing.push(f)
  }
  const totalBytes = missing.reduce((s, f) => s + f.size, 0)
  let receivedBytes = 0
  let done = 0
  const report = (current?: DesiredFile) =>
    onProgress(totalBytes ? Math.min(1, receivedBytes / totalBytes) : null, current ? `${current.label} · ${done + 1}/${missing.length}` : undefined)

  if (missing.length) report(missing[0])
  try {
    await pool(missing, async (f) => {
      await downloadToStore(storeDir(), f, (n) => {
        receivedBytes += n
        report(f)
      })
      done++
    })
  } catch (err) {
    throw new GameError('network', err instanceof DownloadError ? err.message : String(err))
  }

  // Place files, then remove the ones no longer wanted.
  const inFlight = plan.place.map((f) => f.path.toLowerCase())
  for (const p of inFlight) placingNow.add(p)
  try {
    for (const f of plan.place) {
      const info = await place(f)
      if (f.policy === 'default') state.seeded[f.path] = f.sha512
      else state.owned[f.path] = { sha512: f.sha512, size: info.size, mtimeMs: info.mtimeMs }
    }
    for (const f of plan.handOver) state.seeded[f.path] = 'player'
    for (const rel of plan.remove) {
      await rm(instancePath(rel), { force: true })
      delete state.owned[rel]
    }
  } catch (err) {
    const code = (err as { code?: string }).code
    if (code === 'EBUSY' || code === 'EPERM') throw new GameError('busy', String(err))
    throw new GameError('disk', String(err))
  } finally {
    await writeInstanceState(state) // keep what succeeded, even if something failed
    for (const p of inFlight) placingNow.delete(p)
  }

  state.clientVersion = manifest.clientVersion
  state.minecraft = manifest.minecraft
  await writeInstanceState(state)
  return {
    downloaded: missing.length,
    downloadedBytes: totalBytes,
    placed: plan.place.length,
    removed: plan.remove.length,
    verified: plan.keep.length + plan.check.length,
    repaired,
    configBackup,
  }
}

async function localDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/**
 * Deletes store files no client needs anymore: anything not in the current manifest (all mods, on or off, so
 * toggling stays instant) and not currently placed, plus leftover partial downloads. Returns freed bytes.
 */
export async function cleanStore(manifest: ClientManifest): Promise<number> {
  const state = await readInstanceState()
  const keep = new Set([
    ...manifest.mods.map((m) => m.file.sha512),
    ...manifest.files.map((f) => f.sha512),
    ...Object.values(state.owned).map((o) => o.sha512),
  ])
  let freed = 0
  const root = storeDir()
  for (const dir of await readdir(root).catch(() => [] as string[])) {
    const full = join(root, dir)
    for (const name of await readdir(full).catch(() => [] as string[])) {
      if (dir !== '.partial' && keep.has(name)) continue
      const path = join(full, name)
      const size = (await stat(path).catch(() => null))?.size ?? 0
      await rm(path, { force: true })
      freed += size
    }
  }
  return freed
}

/** Enabled mod ids for the current choices. */
export async function getEnabledMods(manifest: ClientManifest): Promise<string[]> {
  return [...resolveEnabled(manifest.mods, (await readInstanceState()).choices)]
}

/** Toggles are saved one at a time, so two quick clicks can't overwrite each other. */
let toggleQueue: Promise<unknown> = Promise.resolve()

/** Saves a player's toggle (applied to the game folder on the next PLAY). */
export function setModEnabled(manifest: ClientManifest, id: string, on: boolean): Promise<{ enabled: string[]; alsoChanged: string[] }> {
  const run = toggleQueue.then(() => saveToggle(manifest, id, on))
  toggleQueue = run.catch(() => {})
  return run
}

async function saveToggle(manifest: ClientManifest, id: string, on: boolean): Promise<{ enabled: string[]; alsoChanged: string[] }> {
  const state = await readInstanceState()
  const { choices, alsoChanged } = applyToggle(manifest.mods, state.choices, id, on)
  state.choices = choices
  await writeInstanceState(state)
  return { enabled: [...resolveEnabled(manifest.mods, choices)], alsoChanged }
}

/**
 * The player takes over a Hemisphere mod: its file (if any) stays where it is but is no longer Hemisphere's, and the
 * mod is never placed, replaced or removed by a sync again. Returns whether a file was handed over.
 */
export function detachMod(manifest: ClientManifest, id: string): Promise<{ handedOver: boolean; wasEnabled: boolean }> {
  const run = toggleQueue.then(async () => {
    const state = await readInstanceState()
    const mod = manifest.mods.find((m) => m.id === id)
    if (!mod) throw new Error(`unknown mod ${id}`)
    const wasEnabled = resolveEnabled(manifest.mods, state.choices).has(id)
    const handedOver = !!state.owned[mod.file.path]
    delete state.owned[mod.file.path]
    if (!state.detached.includes(id)) state.detached.push(id)
    await writeInstanceState(state)
    return { handedOver, wasEnabled }
  })
  toggleQueue = run.catch(() => {})
  return run
}

/** Hemisphere manages the mod again (its version is placed on the next sync). */
/** Taken-over mods whose file is gone (deleted outside the launcher…): Hemisphere manages them again, choice kept. */
export function forgetDetached(ids: string[]): Promise<void> {
  const run = toggleQueue.then(async () => {
    const state = await readInstanceState()
    state.detached = state.detached.filter((d) => !ids.includes(d))
    await writeInstanceState(state)
  })
  toggleQueue = run.catch(() => {})
  return run
}

export function reattachMod(id: string): Promise<void> {
  const run = toggleQueue.then(async () => {
    const state = await readInstanceState()
    state.detached = state.detached.filter((d) => d !== id)
    state.choices = { ...state.choices, [id]: true }
    await writeInstanceState(state)
  })
  toggleQueue = run.catch(() => {})
  return run
}

/**
 * Restore point / setup import: puts back the player's choices and which Hemisphere mods they took over. A mod taken
 * over again stops being Hemisphere's file (so the next sync doesn't remove the player's copy); one given back is
 * placed by the next sync.
 */
export function restoreModChoices(manifest: ClientManifest | null, choices: Record<string, boolean>, detached: string[]): Promise<void> {
  const run = toggleQueue.then(async () => {
    const state = await readInstanceState()
    const known = manifest ? new Set(manifest.mods.map((m) => m.id)) : null
    state.choices = Object.fromEntries(Object.entries(choices).filter(([id, on]) => typeof on === 'boolean' && (!known || known.has(id))))
    state.detached = [...new Set(detached.filter((id) => !known || known.has(id)))]
    for (const id of state.detached) {
      const mod = manifest?.mods.find((m) => m.id === id)
      if (mod) delete state.owned[mod.file.path]
    }
    await writeInstanceState(state)
  })
  toggleQueue = run.catch(() => {})
  return run
}
