import { createHash, randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, link, lstat, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { isSafeRelativePath, type ClientManifest } from '@shared/manifest'
import { MAX_RESTORE_POINTS, type RestorePointInfo, type RestorePreview, type RestoreReason, type RestoreResult } from '@shared/restorePoints'
import { gamePaths } from '../game/target'
import { modKey, playerJars, readPlayerRegistry, registryKey, withPlayerMods, writePlayerRegistry, type PlayerModRecord } from '../modrinth/playerMods'
import { isSafeModFileName } from '../modrinth/api'
import { sha512OfFile, tempNameFor } from '../sync/download'
import { readInstanceState, restoreModChoices } from '../sync/sync'

/**
 * Restore points: what a player tunes by hand, saved before the big changes (client update, import, "Update all",
 * a restore, a setup import, a full repair). Everyday changes go to the mod history instead. instance/.hemisphere/restore-points/:
 *   <id>/point.json   what was there (mods with hashes, choices, locks)
 *   <id>/files/…      options.txt (keybinds, video), servers.dat, config/
 *   jars/<hash>.jar   the player's mod files, shared by every point (hard links: no extra space while the file is
 *                     still in mods/)
 * Worlds, screenshots, resource packs and accounts are never part of it. The newest 10 are kept.
 */

export interface PointMod {
  file: string
  enabled: boolean
  sha512: string
  size: number
  title: string | null
  version: string | null
}
interface Point {
  format: 1
  id: string
  createdAt: number
  reason: RestoreReason
  clientVersion: string | null
  minecraft: string | null
  choices: Record<string, boolean>
  detached: string[]
  mods: PointMod[]
  /** game files saved under files/ */
  files: string[]
  /** the player's mod records (Modrinth identity, locks) */
  registry: Record<string, PlayerModRecord>
}

const CONFIG_FILE_MAX = 8 * 1024 * 1024
const CONFIG_TOTAL_MAX = 100 * 1024 * 1024

const root = () => join(gamePaths().instance, '.hemisphere', 'restore-points')
const jarsDir = () => join(root(), 'jars')
/** Where a mod file is kept for restore points and mod sets (one copy per file, whoever needs it). */
export const jarPath = (sha512: string) => join(jarsDir(), `${sha512.slice(0, 40)}.jar`)
/** Mod sets (see modSets.ts): their files are kept in the same place. */
export const setsDir = () => join(gamePaths().instance, '.hemisphere', 'mod-sets')

/** Keeps a mod file (hard link while it's the same file on disk: no extra space). */
export async function storeJar(path: string, sha512: string): Promise<string> {
  const dest = jarPath(sha512)
  if (existsSync(dest)) return dest
  await mkdir(jarsDir(), { recursive: true })
  await link(path, dest).catch(() => copyFile(path, dest))
  return dest
}
const inInstance = (rel: string) => join(gamePaths().instance, ...rel.split('/'))
export const isRestorePointId = (id: unknown): id is string => typeof id === 'string' && /^[0-9a-z]{8,12}-[0-9a-f]{6}$/.test(id)

/** Game files a restore point or a setup carries: keybinds/video, the server list and mod configs. */
export const isSetupPath = (rel: string) => rel === 'options.txt' || rel === 'servers.dat' || (rel.startsWith('config/') && isSafeRelativePath(rel))

/** One restore point operation at a time. */
let queue: Promise<unknown> = Promise.resolve()
function serial<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job)
  queue = run.catch(() => {})
  return run
}

/** options.txt, servers.dat and every config file (small enough), as relative paths. */
export async function gameFiles(): Promise<string[]> {
  const out = ['options.txt', 'servers.dat'].filter((f) => existsSync(inInstance(f)))
  let total = 0
  const walk = async (rel: string, depth: number): Promise<void> => {
    if (depth > 8) return
    for (const name of await readdir(inInstance(rel)).catch(() => [] as string[])) {
      const child = `${rel}/${name}`
      const st = await lstat(inInstance(child)).catch(() => null)
      if (!st || st.isSymbolicLink()) continue
      if (st.isDirectory()) await walk(child, depth + 1)
      else if (st.isFile() && st.size <= CONFIG_FILE_MAX && total + st.size <= CONFIG_TOTAL_MAX && isSetupPath(child)) {
        total += st.size
        out.push(child)
      }
    }
  }
  await walk('config', 0)
  return out
}

/** The player's jars with their hashes (from the mod records when the file hasn't changed). */
export async function currentMods(owned: string[], reg: Record<string, PlayerModRecord>): Promise<(PointMod & { path: string })[]> {
  const out: (PointMod & { path: string })[] = []
  for (const j of playerJars(owned)) {
    const path = join(j.dir, j.file)
    const st = await stat(path).catch(() => null)
    if (!st) continue
    const e = reg[registryKey(j.file)]
    const sha512 = e && e.size === st.size && e.mtimeMs === st.mtimeMs ? e.sha512 : await sha512OfFile(path)
    out.push({ file: j.file, enabled: j.enabled, sha512, size: st.size, title: e?.title ?? null, version: e?.versionNumber ?? null, path })
  }
  return out
}

async function readPoint(id: string): Promise<Point | null> {
  if (!isRestorePointId(id)) return null
  try {
    const p = JSON.parse(await readFile(join(root(), id, 'point.json'), 'utf8')) as Point
    return p.format === 1 && p.id === id ? p : null
  } catch {
    return null
  }
}

async function allPoints(): Promise<Point[]> {
  const ids = (await readdir(root()).catch(() => [] as string[])).filter(isRestorePointId)
  const points = (await Promise.all(ids.map(readPoint))).filter((p): p is Point => !!p)
  return points.sort((a, b) => b.createdAt - a.createdAt)
}

const info = (p: Point): RestorePointInfo => ({
  id: p.id,
  createdAt: p.createdAt,
  reason: p.reason,
  clientVersion: p.clientVersion,
  minecraft: p.minecraft,
  mods: p.mods.length,
  configFiles: p.files.filter((f) => f.startsWith('config/')).length,
  hasOptions: p.files.includes('options.txt'),
  hasServers: p.files.includes('servers.dat'),
})

export const listRestorePoints = (): Promise<RestorePointInfo[]> => serial(async () => (await allPoints()).map(info))

/**
 * Takes a restore point now. Returns its id, or null when there was nothing to keep (fresh install). Never throws for the automatic ones: a failed point must not block the change.
 */
export function createRestorePoint(reason: RestoreReason, client: { clientVersion: string; minecraft: string } | null = null): Promise<string | null> {
  return serial(() => takePoint(reason, client)).catch((err) => {
    console.warn('[restore-points] could not take one:', err)
    if (reason.kind === 'restore' || reason.kind === 'manual' || reason.kind === 'setupImport') throw err // asked for: say it failed
    return null
  })
}

async function takePoint(reason: RestoreReason, client: { clientVersion: string; minecraft: string } | null): Promise<string | null> {
  const state = await readInstanceState()
  const owned = Object.keys(state.owned)
  const files = await gameFiles()
  const id = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`
  const dir = join(root(), id)
  const building = `${dir}.tmp`

  const mods = await withPlayerMods(async () => {
    const reg = readPlayerRegistry()
    const found = await currentMods(owned, reg)
    for (const m of found) await storeJar(m.path, m.sha512)
    return { found, reg }
  })
  if (!state.clientVersion && !mods.found.length && !files.length) return null // nothing to protect yet

  await rm(building, { recursive: true, force: true })
  for (const rel of files) {
    const dest = join(building, 'files', ...rel.split('/'))
    await mkdir(dirname(dest), { recursive: true })
    await copyFile(inInstance(rel), dest).catch((err) => console.warn('[restore-points] skipped', rel, String(err)))
  }
  const point: Point = {
    format: 1,
    id,
    createdAt: Date.now(),
    reason,
    clientVersion: state.clientVersion ?? client?.clientVersion ?? null,
    minecraft: state.minecraft ?? client?.minecraft ?? null,
    choices: state.choices,
    detached: state.detached,
    mods: mods.found.map(({ path: _p, ...m }) => m),
    files: files.filter((rel) => existsSync(join(building, 'files', ...rel.split('/')))),
    registry: Object.fromEntries(mods.found.map((m) => [registryKey(m.file), mods.reg[registryKey(m.file)]]).filter(([, e]) => !!e)),
  }
  await mkdir(building, { recursive: true })
  await writeFile(join(building, 'point.json'), JSON.stringify(point))
  await rename(building, dir) // complete or not there at all
  console.log(`[restore-points] ${id}: before ${reason.kind} (${point.mods.length} mods, ${point.files.length} files)`)
  await prune()
  return id
}

/** Keeps the newest points and the jars they need. */
async function prune(): Promise<void> {
  const points = await allPoints()
  for (const p of points.slice(MAX_RESTORE_POINTS)) await rm(join(root(), p.id), { recursive: true, force: true })
  await cleanJars(points.slice(0, MAX_RESTORE_POINTS).flatMap((p) => p.mods.map((m) => m.sha512)))
  // leftovers of an interrupted point
  for (const name of await readdir(root()).catch(() => [] as string[])) if (name.endsWith('.tmp')) await rm(join(root(), name), { recursive: true, force: true })
}

/** Deletes kept mod files that no restore point and no mod set needs any more. */
export async function cleanJars(fromPoints?: string[]): Promise<void> {
  const shas = fromPoints ?? (await allPoints()).flatMap((p) => p.mods.map((m) => m.sha512))
  for (const name of await readdir(setsDir()).catch(() => [] as string[])) {
    if (!name.endsWith('.json') || name === 'active.json') continue
    try {
      const set = JSON.parse(await readFile(join(setsDir(), name), 'utf8')) as { mods?: { sha512: string }[] }
      for (const m of set.mods ?? []) shas.push(m.sha512)
    } catch {
      return // can't tell what a set needs: keep everything
    }
  }
  const keep = new Set(shas.map((s) => `${s.slice(0, 40)}.jar`))
  for (const name of await readdir(jarsDir()).catch(() => [] as string[])) if (!keep.has(name)) await rm(join(jarsDir(), name), { force: true })
}

export const deleteRestorePoint = (id: string): Promise<boolean> =>
  serial(async () => {
    if (!(await readPoint(id))) return false
    await rm(join(root(), id), { recursive: true, force: true })
    await prune()
    return true
  })

// ------------------------------------------------------------------------------ preview and restore

const sameBytes = async (a: string, b: string) => {
  const [x, y] = await Promise.all([readFile(a).catch(() => null), readFile(b).catch(() => null)])
  return !!x && !!y && x.equals(y)
}
const label = (m: { file: string; title: string | null }) => m.title ?? m.file.replace(/\.jar$/i, '')

/** Mods that differ between now and a target list: back, away, changed version, switched on/off. */
export function diffMods(now: PointMod[], target: PointMod[]): Pick<RestorePreview, 'back' | 'away' | 'changed' | 'switched'> {
  const same = (a: PointMod, b: PointMod) => a.sha512 === b.sha512
  let switched = 0
  const away: PointMod[] = []
  const back = target.filter((t) => !now.some((n) => same(n, t)))
  for (const n of now) {
    const t = target.find((x) => same(n, x))
    if (!t) away.push(n)
    else if (t.enabled !== n.enabled) switched++
  }
  const changed: RestorePreview['changed'] = []
  const name = (m: PointMod) => modKey(m.title ?? m.file)
  for (const b of [...back]) {
    const i = away.findIndex((a) => name(a) === name(b))
    if (i < 0) continue
    const [a] = away.splice(i, 1)
    back.splice(back.indexOf(b), 1)
    changed.push({ name: label(b), from: a.version ?? a.file, to: b.version ?? b.file })
  }
  return { back: back.map(label), away: away.map(label), changed, switched }
}

export const previewRestore = (id: string): Promise<RestorePreview | null> =>
  serial(async () => {
    const p = await readPoint(id)
    if (!p) return null
    const state = await readInstanceState()
    const now = await withPlayerMods(() => currentMods(Object.keys(state.owned), readPlayerRegistry()))
    const mods = diffMods(now, p.mods)
    const differs = async (rel: string) => !(await sameBytes(join(root(), id, 'files', ...rel.split('/')), inInstance(rel)))
    let configs = 0
    for (const rel of p.files) if (rel.startsWith('config/') && (await differs(rel))) configs++
    const choices = new Set([...Object.keys(p.choices), ...Object.keys(state.choices)])
    const switchedHemisphere = [...choices].filter((k) => p.choices[k] !== state.choices[k]).length
    return {
      ...mods,
      switched: mods.switched + switchedHemisphere,
      options: p.files.includes('options.txt') && (await differs('options.txt')),
      servers: p.files.includes('servers.dat') && (await differs('servers.dat')),
      configs,
    }
  })

/** What to put in the instance: game files, the player's mods (with where to copy each from) and choices. */
export interface ApplyPlan {
  files: { rel: string; from?: string; data?: Buffer }[]
  mods: (PointMod & { from: string | null; record?: Partial<PlayerModRecord> })[]
  choices: Record<string, boolean>
  detached: string[]
}

/**
 * Makes the instance match a plan: game files are overwritten (config files the plan doesn't have stay), the player's
 * jars become exactly the plan's ones (others are deleted: callers take a restore point first), records and locks
 * follow. Returns the mods whose file wasn't available.
 */
export async function applyPlan(plan: ApplyPlan, manifest: ClientManifest | null): Promise<string[]> {
  const missing: string[] = []
  const state = await readInstanceState()
  const owned = Object.keys(state.owned)
  const inst = gamePaths().instance
  const dirOf = (enabled: boolean) => join(inst, enabled ? 'mods' : 'mods-disabled')

  await withPlayerMods(async () => {
    const reg = readPlayerRegistry()
    const now = await currentMods(owned, reg)
    const wanted = plan.mods.filter((m) => isSafeModFileName(m.file))
    const at = (m: { file: string; enabled: boolean }) => join(dirOf(m.enabled), m.file).toLowerCase()
    const kept = new Set<string>()
    for (const n of now) {
      const t = wanted.find((w) => at(w) === n.path.toLowerCase() && w.sha512 === n.sha512)
      if (t) kept.add(at(t))
      else await rm(n.path, { force: true })
    }
    const next: Record<string, PlayerModRecord> = {}
    for (const m of wanted) {
      const dest = join(dirOf(m.enabled), m.file)
      if (!kept.has(at(m))) {
        if (!m.from || !existsSync(m.from)) {
          missing.push(label(m))
          continue
        }
        await mkdir(dirname(dest), { recursive: true })
        const tmp = tempNameFor(dest)
        await copyFile(m.from, tmp)
        await rename(tmp, dest)
      }
      const st = await stat(dest)
      const base = m.record ?? reg[registryKey(m.file)]
      next[registryKey(m.file)] = {
        projectId: null,
        versionId: null,
        versionNumber: null,
        title: null,
        icon: '',
        update: null,
        incompatibleWith: null,
        pinned: null,
        lookedUp: false,
        ...base,
        file: m.file,
        size: st.size,
        mtimeMs: st.mtimeMs,
        addedAt: base?.addedAt ?? (st.birthtimeMs || st.mtimeMs),
        sha512: m.sha512,
      }
    }
    await writePlayerRegistry(next)
  })

  for (const f of plan.files) {
    if (!isSetupPath(f.rel)) continue
    const dest = inInstance(f.rel)
    await mkdir(dirname(dest), { recursive: true })
    const tmp = tempNameFor(dest)
    if (f.data) await writeFile(tmp, f.data)
    else if (f.from) await copyFile(f.from, tmp)
    else continue
    await rename(tmp, dest)
  }
  await restoreModChoices(manifest, plan.choices, plan.detached)
  return missing
}

/** Puts a restore point back, after taking one of the current state ("Before restoring"). */
export async function restorePoint(id: string, manifest: ClientManifest | null): Promise<RestoreResult> {
  const p = await serial(() => readPoint(id))
  if (!p) return { ok: false, reason: 'notFound' }
  let safetyPoint: string | null
  try {
    safetyPoint = await createRestorePoint({ kind: 'restore', to: p.createdAt })
  } catch (err) {
    return { ok: false, reason: 'failed', detail: String(err) }
  }
  try {
    const missing = await serial(() =>
      applyPlan(
        {
          files: p.files.map((rel) => ({ rel, from: join(root(), id, 'files', ...rel.split('/')) })),
          mods: p.mods.map((m) => ({ ...m, from: jarPath(m.sha512), record: p.registry[registryKey(m.file)] })),
          choices: p.choices,
          detached: p.detached,
        },
        manifest,
      ),
    )
    console.log(`[restore-points] restored ${id}${missing.length ? ` (missing: ${missing.join(', ')})` : ''}`)
    return { ok: true, safetyPoint, missing }
  } catch (err) {
    console.error('[restore-points] restore failed:', err)
    return { ok: false, reason: 'failed', detail: String(err) }
  }
}

/** For tests: the hash of a buffer the way jars are named. */
export const sha512Of = (data: Buffer) => createHash('sha512').update(data).digest('hex')

/** Runs a job on the kept mod files with restore points to themselves (never call createRestorePoint inside). */
export const withJarStore = <T,>(job: () => Promise<T>): Promise<T> => serial(job)
