import { shell } from 'electron'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { copyFile, mkdir, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ClientManifest } from '@shared/manifest'
import { policyFor, type InstallResult, type ModPolicy, type ModVersionChoice, type PlayerModInfo, type SetVersionResult, type UpdateApplied, type UpdateCheck } from '@shared/modBrowser'
import { gamePaths } from '../game/target'
import { blobPath, downloadToStore, sha512OfFile } from '../sync/download'
import { getProjects, isSafeModFileName, latestByHash, pickVersion, primaryFile, projectVersions, safeIcon, versionsByHash, type ModrinthVersion } from './api'

/**
 * The player's own mods (mods/ and mods-disabled/, minus Hemisphere's files): what they are on Modrinth, the staff
 * policy, installing from the browser with dependencies, updates, removal (to the Recycle Bin).
 * instance/.hemisphere/player-mods.json remembers each file's hash and Modrinth identity, so files are only hashed
 * and looked up once (or again when they change).
 */
interface Entry {
  file: string
  size: number
  mtimeMs: number
  sha512: string
  /** false when the Modrinth lookup failed (offline): retried next time */
  lookedUp: boolean
  projectId: string | null
  versionId: string | null
  versionNumber: string | null
  title: string | null
  icon: string
  update: { versionId: string; versionNumber: string } | null
  incompatibleWith: string | null
  /** Minecraft version for which the player locked this exact version (updates never change it); null = unlocked */
  pinned?: string | null
}
type Registry = Record<string, Entry>

const modsDir = () => join(gamePaths().instance, 'mods')
const disabledDir = () => join(gamePaths().instance, 'mods-disabled')
const registryPath = () => join(gamePaths().instance, '.hemisphere', 'player-mods.json')
const key = (file: string) => file.toLowerCase()

function readRegistry(): Registry {
  try {
    return JSON.parse(readFileSync(registryPath(), 'utf8')) as Registry
  } catch {
    return {}
  }
}
async function writeRegistry(r: Registry): Promise<void> {
  await mkdir(join(gamePaths().instance, '.hemisphere'), { recursive: true })
  const tmp = `${registryPath()}.tmp`
  await writeFile(tmp, JSON.stringify(r, null, 1))
  await rename(tmp, registryPath())
}

/** One change to the player's mods at a time (install, update, remove, identify). */
let queue: Promise<unknown> = Promise.resolve()
function serial<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job)
  queue = run.catch(() => {})
  return run
}

const list = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.jar')) : [])

/** Player jars on disk: [file, enabled]. Hemisphere's own files (owned, in mods/) are not the player's. */
function playerFiles(owned: string[]): { file: string; enabled: boolean; dir: string }[] {
  const mine = new Set(owned.map((p) => p.toLowerCase()))
  return [
    ...list(modsDir())
      .filter((f) => !mine.has(`mods/${f}`.toLowerCase()))
      .map((file) => ({ file, enabled: true, dir: modsDir() })),
    ...list(disabledDir()).map((file) => ({ file, enabled: false, dir: disabledDir() })),
  ]
}

/** Hashes new/changed files and asks Modrinth what they are (batched). */
async function identify(owned: string[]): Promise<Registry> {
  const reg = readRegistry()
  const files = playerFiles(owned)
  const present = new Set(files.map((f) => key(f.file)))
  for (const k of Object.keys(reg)) if (!present.has(k)) delete reg[k]

  const fresh: Entry[] = []
  for (const { file, dir } of files) {
    const st = await stat(join(dir, file)).catch(() => null)
    if (!st) continue
    const old = reg[key(file)]
    if (old && old.size === st.size && old.mtimeMs === st.mtimeMs) {
      if (!old.lookedUp) fresh.push(old)
      continue
    }
    const entry: Entry = {
      file,
      size: st.size,
      mtimeMs: st.mtimeMs,
      sha512: await sha512OfFile(join(dir, file)),
      lookedUp: false,
      projectId: null,
      versionId: null,
      versionNumber: null,
      title: null,
      icon: '',
      update: null,
      incompatibleWith: old?.incompatibleWith ?? null,
      pinned: null,
    }
    reg[key(file)] = entry
    fresh.push(entry)
  }
  if (fresh.length) {
    try {
      const found = await versionsByHash(fresh.map((e) => e.sha512))
      const projects = await getProjects([...new Set(Object.values(found).map((v) => v.project_id))])
      for (const e of fresh) {
        const v = found[e.sha512]
        const p = v ? projects.get(v.project_id) : undefined
        Object.assign(e, {
          lookedUp: true,
          projectId: v?.project_id ?? null,
          versionId: v?.id ?? null,
          versionNumber: v?.version_number ?? null,
          title: p?.title ?? null,
          icon: safeIcon(p?.icon_url),
        })
      }
    } catch (err) {
      console.warn('[player-mods] Modrinth lookup failed, will retry:', err)
    }
  }
  await writeRegistry(reg)
  return reg
}

/**
 * Comparable name: lower-case letters and digits only, without the version and loader words.
 * "Chat Heads", "chat_heads-1.3.2.jar" and "chat-heads-fabric-1.3.2.jar" all give "chatheads".
 */
export function modKey(name: string): string {
  let s = name.replace(/\.jar$/i, '').toLowerCase()
  s = s.split(/[-_+ ]v?\d/)[0]
  s = s.replace(/[^a-z0-9]/g, '')
  while (s.length > 6 && /(fabric|quilt|neoforge|forge|mc)$/.test(s)) s = s.replace(/(fabric|quilt|neoforge|forge|mc)$/, '')
  return s
}

/** What Hemisphere ships, for spotting a player's copy of the same mod (by Modrinth project or by name). */
export interface HemisphereMods {
  projects: Set<string>
  keys: Set<string>
}
export function hemisphereMods(manifest: ClientManifest, detached: ReadonlySet<string> = new Set()): HemisphereMods {
  // mods the player took over are theirs now: their copy is not a duplicate
  const managed = manifest.mods.filter((m) => !detached.has(m.id))
  const keys = managed.flatMap((m) => [modKey(m.name), modKey(m.file.path.split('/').pop() ?? '')])
  return { projects: new Set(managed.flatMap((m) => (m.source ? [m.source.modrinth.projectId] : []))), keys: new Set(keys.filter((k) => k.length >= 3)) }
}
export function isDuplicate(mod: { file: string; projectId: string | null; title: string | null }, h: HemisphereMods | null): boolean {
  if (!h) return false
  return (!!mod.projectId && h.projects.has(mod.projectId)) || h.keys.has(modKey(mod.file)) || (!!mod.title && h.keys.has(modKey(mod.title)))
}

/** Player copies of Hemisphere's own mods are kept switched off (two copies of a mod crash or double-load). */
async function parkDuplicatesNow(owned: string[], reg: Registry, h: HemisphereMods): Promise<string[]> {
  const parked: string[] = []
  for (const f of playerFiles(owned)) {
    const e = reg[key(f.file)]
    if (!f.enabled || !isDuplicate({ file: f.file, projectId: e?.projectId ?? null, title: e?.title ?? null }, h)) continue
    await mkdir(disabledDir(), { recursive: true })
    if (existsSync(join(disabledDir(), f.file))) continue
    await rename(join(f.dir, f.file), join(disabledDir(), f.file))
    parked.push(f.file)
  }
  if (parked.length) console.log(`[player-mods] switched off duplicates of Hemisphere mods: ${parked.join(', ')}`)
  return parked
}

/** Before PLAY: make sure no duplicate is enabled. */
export function parkDuplicates(owned: string[], manifest: ClientManifest, detached: ReadonlySet<string> = new Set()): Promise<string[]> {
  return serial(async () => parkDuplicatesNow(owned, await identify(owned), hemisphereMods(manifest, detached)))
}

/** Whether this player file may be switched on (not a duplicate of a Hemisphere mod). */
export function canEnablePlayerMod(file: string, manifest: ClientManifest, detached: ReadonlySet<string> = new Set()): boolean {
  const e = readRegistry()[key(file)]
  return !isDuplicate({ file, projectId: e?.projectId ?? null, title: e?.title ?? null }, hemisphereMods(manifest, detached))
}

export function listPlayerMods(
  owned: string[],
  policy: ModPolicy | null | undefined,
  hemisphere: HemisphereMods | null = null,
  minecraft: string | null = null,
): Promise<PlayerModInfo[]> {
  return serial(async () => {
    const reg = await identify(owned)
    if (hemisphere) await parkDuplicatesNow(owned, reg, hemisphere)
    return playerFiles(owned)
      .map(({ file, enabled }) => {
        const e = reg[key(file)]
        return {
          file,
          size: e?.size ?? 0,
          enabled,
          projectId: e?.projectId ?? null,
          title: e?.title ?? null,
          icon: e?.icon ?? '',
          versionNumber: e?.versionNumber ?? null,
          ...policyFor(policy, e?.projectId ?? null),
          update: e?.update ? { versionNumber: e.update.versionNumber } : null,
          incompatibleWith: e?.incompatibleWith ?? null,
          pinned: !!minecraft && e?.pinned === minecraft,
          inHemisphere: isDuplicate({ file, projectId: e?.projectId ?? null, title: e?.title ?? null }, hemisphere),
        }
      })
      .sort((a, b) => (a.title ?? a.file).localeCompare(b.title ?? b.file))
  })
}

/** Modrinth projects the player already has (from the last identification; no network). */
export function knownPlayerProjects(): Set<string> {
  return new Set(Object.values(readRegistry()).flatMap((e) => (e.projectId ? [e.projectId] : [])))
}

/** Modrinth projects Hemisphere ships itself (never installed again as a player mod). */
export const hemisphereProjects = (manifest: ClientManifest) => new Set(manifest.mods.flatMap((m) => (m.source ? [m.source.modrinth.projectId] : [])))

/** Downloads one version's file (hash-verified) into mods/. Returns the file name. */
async function placeVersion(v: ModrinthVersion, dir = modsDir()): Promise<string> {
  const f = primaryFile(v)
  const store = join(gamePaths().root, 'store')
  await downloadToStore(store, { url: f.url, sha512: f.hashes.sha512, size: f.size }, () => {})
  await mkdir(dir, { recursive: true })
  const dest = join(dir, f.filename)
  if (!existsSync(dest)) await copyFile(blobPath(store, f.hashes.sha512), dest) // a copy: it's the player's file
  return f.filename
}

/**
 * Installs a Modrinth project for this Minecraft version, plus its required dependencies (unless Hemisphere or the
 * player already has them). Blocked projects are refused; "ask staff" ones need confirmed = true.
 */
export function installMod(
  projectId: string,
  confirmed: boolean,
  manifest: ClientManifest,
  owned: string[],
  policy: ModPolicy | null | undefined,
  detached: ReadonlySet<string> = new Set(),
  versionId: string | null = null,
): Promise<InstallResult> {
  return serial(async () => {
    const verdict = policyFor(policy, projectId).verdict
    if (verdict === 'blocked') return { ok: false, reason: 'blocked' }
    if (verdict === 'askStaff' && !confirmed) return { ok: false, reason: 'needsConfirm' }
    const hemisphere = hemisphereMods(manifest, detached).projects
    if (hemisphere.has(projectId)) return { ok: false, reason: 'inHemisphere' }

    const reg = await identify(owned)
    const have = new Set(Object.values(reg).flatMap((e) => (e.projectId ? [e.projectId] : [])))
    const installed: string[] = []
    const alreadyHad: string[] = []
    const titles = new Map<string, string>()

    // breadth-first over required dependencies, a few levels deep at most
    let level = [projectId]
    const seen = new Set<string>()
    try {
      for (let depth = 0; level.length && depth < 4; depth++) {
        const next: string[] = []
        for (const id of level) {
          if (seen.has(id)) continue
          seen.add(id)
          if (id !== projectId && (hemisphere.has(id) || have.has(id))) {
            alreadyHad.push(id)
            continue
          }
          if (id !== projectId && policyFor(policy, id).verdict === 'blocked') continue // never pulled in silently
          const all = await projectVersions(id, manifest.minecraft)
          const v = id === projectId && versionId ? (all.find((x) => x.id === versionId) ?? null) : pickVersion(all)
          if (!v) {
            if (id === projectId) return { ok: false, reason: 'notCompatible' }
            continue // optional-in-practice dependency without a version: the mod may still load
          }
          await placeVersion(v)
          installed.push(id)
          for (const d of v.dependencies) if (d.dependency_type === 'required' && d.project_id) next.push(d.project_id)
        }
        level = next
      }
      for (const [id, p] of await getProjects([...installed, ...alreadyHad])) titles.set(id, p.title)
    } catch (err) {
      console.warn('[player-mods] install failed:', err)
      return { ok: false, reason: 'network' }
    }
    console.log(`[player-mods] installed ${installed.join(', ')}${alreadyHad.length ? ` (already had ${alreadyHad.join(', ')})` : ''}`)
    return { ok: true, installed: installed.map((id) => titles.get(id) ?? id), alreadyHad: alreadyHad.map((id) => titles.get(id) ?? id) }
  })
}

/** Moves a player mod to the Recycle Bin (recoverable). Hemisphere's own files are refused. */
export function removePlayerMod(file: string, owned: string[]): Promise<boolean> {
  return serial(async () => {
    if (!isSafeModFileName(file)) return false
    const target = playerFiles(owned).find((f) => f.file === file)
    if (!target) return false
    await shell.trashItem(join(target.dir, file))
    const reg = readRegistry()
    delete reg[key(file)]
    await writeRegistry(reg)
    return true
  })
}

/** Asks Modrinth for newer versions of the player's mods (for this Minecraft version). */
export function checkPlayerModUpdates(owned: string[], minecraft: string): Promise<UpdateCheck> {
  return serial(async () => {
    const reg = await identify(owned)
    // locked mods are checked too: their update is shown (Updates filter), "Update all" just never applies it
    const known = Object.values(reg).filter((e) => e.projectId && e.versionId)
    const latest = await latestByHash(
      known.map((e) => e.sha512),
      minecraft,
    )
    let updates = 0
    for (const e of known) {
      const v = latest[e.sha512]
      e.update = v && v.id !== e.versionId && v.project_id === e.projectId ? { versionId: v.id, versionNumber: v.version_number } : null
      if (e.update) updates++
    }
    await writeRegistry(reg)
    return { checked: known.length, updates }
  })
}

/**
 * Updates the player's Modrinth mods to the newest version for `minecraft`. With disableIncompatible (Hemisphere moved
 * to a new Minecraft version), mods that have no version yet are switched off and marked, never deleted.
 * Old files go to the Recycle Bin; enabled/disabled state is kept.
 */
export function updatePlayerMods(owned: string[], minecraft: string, disableIncompatible: boolean): Promise<UpdateApplied> {
  return serial(async () => {
    const reg = await identify(owned)
    const files = new Map(playerFiles(owned).map((f) => [key(f.file), f]))
    const known = Object.values(reg).filter((e) => e.projectId && e.versionId && files.has(key(e.file)) && e.pinned !== minecraft)
    const latest = await latestByHash(
      known.map((e) => e.sha512),
      minecraft,
    )
    const updated: string[] = []
    const disabled: string[] = []
    for (const e of known) {
      const loc = files.get(key(e.file))!
      const v = latest[e.sha512]
      if (v && v.project_id === e.projectId) {
        e.incompatibleWith = null
        if (v.id === e.versionId) continue
        try {
          const newFile = await placeVersion(v, loc.dir)
          if (newFile.toLowerCase() !== e.file.toLowerCase()) {
            await shell.trashItem(join(loc.dir, e.file))
            delete reg[key(e.file)]
          }
          updated.push(e.title ?? e.file)
        } catch (err) {
          console.warn(`[player-mods] update of ${e.file} failed:`, err)
        }
      } else if (disableIncompatible && loc.enabled) {
        await mkdir(disabledDir(), { recursive: true })
        if (!existsSync(join(disabledDir(), e.file))) {
          await rename(join(loc.dir, e.file), join(disabledDir(), e.file))
          e.incompatibleWith = minecraft
          disabled.push(e.title ?? e.file)
        }
      }
    }
    await writeRegistry(reg)
    if (updated.length || disabled.length) console.log(`[player-mods] for ${minecraft}: updated ${updated.length}, switched off ${disabled.length}`)
    return { updated, disabled }
  })
}

/** Every Modrinth version of one of the player's mods for Fabric + this Minecraft version, newest first. */
export function modVersions(file: string, owned: string[], minecraft: string): Promise<ModVersionChoice[] | null> {
  return serial(async () => {
    const e = (await identify(owned))[key(file)]
    if (!e?.projectId) return null
    const versions = (await projectVersions(e.projectId, minecraft)).sort((a, b) => b.date_published.localeCompare(a.date_published))
    const latest = pickVersion(versions)
    return versions.slice(0, 60).map((v) => ({
      id: v.id,
      versionNumber: v.version_number,
      name: v.name,
      type: v.version_type,
      published: v.date_published,
      current: v.id === e.versionId,
      latest: v.id === latest?.id,
      locked: v.id === e.versionId && e.pinned === minecraft,
    }))
  })
}

/**
 * Switches one of the player's mods to a specific Modrinth version (same Minecraft version), locked or not. A locked
 * version is never changed by "Update all". The old file goes to the Recycle Bin.
 */
export function setModVersion(file: string, versionId: string, owned: string[], minecraft: string, lock = false): Promise<SetVersionResult> {
  return serial(async () => {
    const reg = await identify(owned)
    const e = reg[key(file)]
    const loc = playerFiles(owned).find((f) => key(f.file) === key(file))
    if (!e?.projectId || !loc) return { ok: false, reason: 'notFound' }
    let versions: ModrinthVersion[]
    try {
      versions = await projectVersions(e.projectId, minecraft)
    } catch {
      return { ok: false, reason: 'network' }
    }
    const v = versions.find((x) => x.id === versionId)
    if (!v) return { ok: false, reason: 'notFound' }
    if (e.pinned === minecraft && v.id !== e.versionId) return { ok: false, reason: 'locked' } // unlock it first
    const pinned = lock
    if (v.id === e.versionId) {
      e.pinned = pinned ? minecraft : null
      e.update = null
      await writeRegistry(reg)
      return { ok: true, versionNumber: v.version_number, pinned }
    }
    const f = primaryFile(v)
    try {
      // same file name for both versions: make room first (the old one is still recoverable from the Recycle Bin)
      if (f.filename.toLowerCase() === file.toLowerCase()) await shell.trashItem(join(loc.dir, file))
      await placeVersion(v, loc.dir)
      if (f.filename.toLowerCase() !== file.toLowerCase()) await shell.trashItem(join(loc.dir, file))
    } catch (err) {
      console.warn(`[player-mods] version change of ${file} failed:`, err)
      return { ok: false, reason: 'network' }
    }
    const st = await stat(join(loc.dir, f.filename))
    delete reg[key(file)]
    reg[key(f.filename)] = {
      ...e,
      file: f.filename,
      size: st.size,
      mtimeMs: st.mtimeMs,
      sha512: f.hashes.sha512,
      lookedUp: true,
      versionId: v.id,
      versionNumber: v.version_number,
      update: null,
      incompatibleWith: null,
      pinned: pinned ? minecraft : null,
    }
    await writeRegistry(reg)
    console.log(`[player-mods] ${e.title ?? file}: ${e.versionNumber} -> ${v.version_number}${pinned ? ' (pinned)' : ''}`)
    return { ok: true, versionNumber: v.version_number, pinned }
  })
}

/** Whether this player file is locked on its version (for this Minecraft version). */
export function isLocked(file: string, minecraft: string): boolean {
  return readRegistry()[key(file)]?.pinned === minecraft
}

/** Locks (or unlocks) the version a mod is on now, for this Minecraft version. */
export function setLocked(file: string, locked: boolean, owned: string[], minecraft: string): Promise<boolean> {
  return serial(async () => {
    const reg = await identify(owned)
    const e = reg[key(file)]
    if (!e) return false
    e.pinned = locked ? minecraft : null
    await writeRegistry(reg)
    return true
  })
}

/** Puts a Hemisphere mod's file in mods/ (or mods-disabled/) as the player's own copy, if it isn't there yet. */
export function placeHemisphereFileAsPlayer(file: { url: string; sha512: string; size: number; path: string }, enabled: boolean): Promise<string> {
  return serial(async () => {
    const name = file.path.split('/').pop()!
    if (!isSafeModFileName(name)) throw new Error('unsafe file name')
    if (existsSync(join(modsDir(), name)) || existsSync(join(disabledDir(), name))) return name
    const store = join(gamePaths().root, 'store')
    await downloadToStore(store, { url: file.url, sha512: file.sha512, size: file.size }, () => {})
    const dir = enabled ? modsDir() : disabledDir()
    await mkdir(dir, { recursive: true })
    await copyFile(blobPath(store, file.sha512), join(dir, name))
    return name
  })
}
