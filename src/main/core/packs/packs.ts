import { nativeImage, shell } from 'electron'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { policyFor, type InstallResult, type ModPolicy, type ModVersionChoice, type UpdateApplied, type UpdateCheck } from '@shared/modBrowser'
import type { ModHistoryEntry } from '@shared/modSets'
import type { PackItem, PackList, PackResult, PackType } from '@shared/packs'
import { gamePaths } from '../game/target'
import { record } from '../modrinth/history'
import { getProjects, isSafePackFileName, latestByHash, pickVersion, primaryFile, projectVersions, safeIcon, updateTarget, versionsByHash, type ModrinthVersion } from '../modrinth/api'
import { blobPath, downloadToStore, sha512OfFile } from '../sync/download'
import { readResourcePacks, readShaders, writeResourcePacks, writeShaders } from './gameSettings'
import { readZipEntry } from './zip'

/**
 * Resource packs (resourcepacks/) and shader packs (shaderpacks/): the same tools as the player's mods. .zip packs are
 * identified on Modrinth by hash (versions, locks, updates, staff policy); unpacked folders are listed and switched
 * but have no versions. instance/.hemisphere/packs.json remembers each file's hash and Modrinth identity.
 */
interface PackRecord {
  file: string
  size: number
  mtimeMs: number
  addedAt: number
  sha512: string
  lookedUp: boolean
  projectId: string | null
  versionId: string | null
  versionNumber: string | null
  title: string | null
  icon: string
  update: { versionId: string; versionNumber: string } | null
  /** Minecraft version this exact version is locked for; null = unlocked */
  pinned: string | null
}
type Registry = Record<string, PackRecord>

const FOLDERS: Record<PackType, string> = { resourcepack: 'resourcepacks', shader: 'shaderpacks' }
export const packDir = (type: PackType) => join(gamePaths().instance, FOLDERS[type])
const registryPath = () => join(gamePaths().instance, '.hemisphere', 'packs.json')
const key = (type: PackType, file: string) => `${type}/${file.toLowerCase()}`

function readRegistry(): Registry {
  try {
    return JSON.parse(readFileSync(registryPath(), 'utf8')) as Registry
  } catch {
    return {}
  }
}
async function writeRegistry(r: Registry): Promise<void> {
  await mkdir(join(gamePaths().instance, '.hemisphere'), { recursive: true })
  await writeFile(`${registryPath()}.tmp`, JSON.stringify(r, null, 1))
  await rename(`${registryPath()}.tmp`, registryPath())
}

/** One change to packs at a time. */
let queue: Promise<unknown> = Promise.resolve()
function serial<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job)
  queue = run.catch(() => {})
  return run
}

/** Packs on disk: .zip files, and folders that are packs (pack.mcmeta / a shaders folder). */
export function packEntries(type: PackType): { file: string; folder: boolean; path: string }[] {
  const dir = packDir(type)
  if (!existsSync(dir)) return []
  const out: { file: string; folder: boolean; path: string }[] = []
  for (const file of readdirSync(dir)) {
    const path = join(dir, file)
    let st
    try {
      st = statSync(path)
    } catch {
      continue
    }
    if (st.isFile() && isSafePackFileName(file)) out.push({ file, folder: false, path })
    else if (st.isDirectory() && !file.startsWith('.') && existsSync(join(path, type === 'resourcepack' ? 'pack.mcmeta' : 'shaders'))) out.push({ file, folder: true, path })
  }
  return out
}

/** Hashes new/changed .zip packs and asks Modrinth what they are (batched; offline = retried next time). */
async function identify(type: PackType, lookup = true): Promise<Registry> {
  const reg = readRegistry()
  const present = new Set(packEntries(type).map((e) => key(type, e.file)))
  for (const k of Object.keys(reg)) if (k.startsWith(`${type}/`) && !present.has(k)) delete reg[k]
  const fresh: PackRecord[] = []
  for (const e of packEntries(type)) {
    if (e.folder) continue
    const st = await stat(e.path).catch(() => null)
    if (!st) continue
    const old = reg[key(type, e.file)]
    if (old && old.size === st.size && old.mtimeMs === st.mtimeMs) {
      if (!old.lookedUp) fresh.push(old)
      continue
    }
    const r: PackRecord = {
      file: e.file,
      size: st.size,
      mtimeMs: st.mtimeMs,
      addedAt: st.birthtimeMs || st.mtimeMs,
      sha512: await sha512OfFile(e.path),
      lookedUp: false,
      projectId: null,
      versionId: null,
      versionNumber: null,
      title: null,
      icon: '',
      update: null,
      pinned: null,
    }
    reg[key(type, e.file)] = r
    fresh.push(r)
  }
  if (fresh.length && lookup) {
    try {
      const found = await versionsByHash(fresh.map((r) => r.sha512))
      const projects = await getProjects([...new Set(Object.values(found).map((v) => v.project_id))])
      for (const r of fresh) {
        const v = found[r.sha512]
        const p = v ? projects.get(v.project_id) : undefined
        Object.assign(r, { lookedUp: true, projectId: v?.project_id ?? null, versionId: v?.id ?? null, versionNumber: v?.version_number ?? null, title: p?.title ?? null, icon: safeIcon(p?.icon_url) })
      }
    } catch (err) {
      console.warn('[packs] Modrinth lookup failed, will retry:', err)
    }
  }
  await writeRegistry(reg)
  return reg
}

// ------------------------------------------------------------------------------ what's in a pack (name, icon)

const metaCache = new Map<string, { description: string | null; icon: string }>()

/** Minecraft text (a string, or {text, extra} components) as plain text, without § formatting codes. */
export function plainText(v: unknown): string {
  const walk = (x: unknown): string =>
    typeof x === 'string' ? x : Array.isArray(x) ? x.map(walk).join('') : x && typeof x === 'object' ? walk((x as { text?: unknown }).text ?? '') + walk((x as { extra?: unknown }).extra ?? '') : ''
  return walk(v)
    .replace(/§./g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

async function packMeta(type: PackType, e: { file: string; folder: boolean; path: string }): Promise<{ description: string | null; icon: string }> {
  if (type !== 'resourcepack') return { description: null, icon: '' }
  const st = await stat(e.path).catch(() => null)
  const cacheKey = `${e.path}|${st?.mtimeMs ?? 0}`
  const hit = metaCache.get(cacheKey)
  if (hit) return hit
  const read = (name: string) => (e.folder ? readFile(join(e.path, name)).catch(() => null) : readZipEntry(e.path, name))
  let description: string | null = null
  try {
    const mcmeta = await read('pack.mcmeta')
    if (mcmeta) description = plainText((JSON.parse(mcmeta.toString('utf8').replace(/^﻿/, '')) as { pack?: { description?: unknown } }).pack?.description) || null
  } catch {
    /* no description */
  }
  let icon = ''
  const png = await read('pack.png')
  if (png) {
    const img = nativeImage.createFromBuffer(png)
    if (!img.isEmpty()) icon = img.resize({ width: 64, height: 64, quality: 'good' }).toDataURL()
  }
  const meta = { description: description?.slice(0, 200) ?? null, icon }
  metaCache.set(cacheKey, meta)
  return meta
}

// ------------------------------------------------------------------------------ list

export function listPacks(type: PackType, minecraft: string, policy: ModPolicy | null | undefined, irisReady = false): Promise<PackList> {
  return serial(async () => {
    const reg = await identify(type)
    const entries = packEntries(type)
    const rp = type === 'resourcepack' ? await readResourcePacks() : null
    const sh = type === 'shader' ? await readShaders() : null
    const items: PackItem[] = []
    for (const e of entries) {
      const r = reg[key(type, e.file)]
      const meta = await packMeta(type, e)
      const order = rp ? rp.active.indexOf(e.file) : -1
      const st = await stat(e.path).catch(() => null)
      items.push({
        file: e.file,
        folder: e.folder,
        name: r?.title ?? e.file.replace(/\.zip$/i, ''),
        description: meta.description,
        icon: r?.icon || meta.icon,
        size: e.folder ? 0 : (r?.size ?? st?.size ?? 0),
        active: rp ? order >= 0 : !!sh && sh.on && sh.pack === e.file,
        order: order >= 0 ? order : null,
        incompatible: !!rp?.incompatible.includes(e.file),
        projectId: r?.projectId ?? null,
        versionNumber: r?.versionNumber ?? null,
        update: r?.update ? { versionNumber: r.update.versionNumber } : null,
        locked: !!r?.pinned && r.pinned === minecraft,
        ...policyFor(policy, r?.projectId ?? null),
        addedAt: r?.addedAt ?? (st ? st.birthtimeMs || st.mtimeMs : 0),
      })
    }
    return { type, items, shadersOn: !!sh?.on, irisReady }
  })
}

/** Modrinth projects the player already has as packs (for "Installed" in Find). */
export const knownPackProjects = (type: PackType) =>
  new Set(
    Object.entries(readRegistry())
      .filter(([k, r]) => k.startsWith(`${type}/`) && r.projectId)
      .map(([, r]) => r.projectId!),
  )

// ------------------------------------------------------------------------------ on / off / order

const exists = (type: PackType, file: string) => packEntries(type).some((e) => e.file === file)

/** Resource pack: on = put on top of the others; off = removed from the list. Shader: on = the one in use. */
export function setPackActive(type: PackType, file: string, on: boolean): Promise<boolean> {
  return serial(async () => {
    if (!exists(type, file)) return false
    if (type === 'resourcepack') {
      const { active } = await readResourcePacks()
      const next = active.filter((f) => f !== file && exists(type, f))
      await writeResourcePacks(on ? [file, ...next] : next)
    } else {
      const sh = await readShaders()
      if (on) await writeShaders({ pack: file, on: true })
      else if (sh.pack === file) await writeShaders({ pack: file, on: false })
    }
    return true
  })
}

/** Shaders off (the pack stays selected for next time). */
export const shadersOff = (): Promise<void> => serial(async () => writeShaders({ ...(await readShaders()), on: false }))

/** Moves a resource pack that is on up (towards the top, -1) or down (+1). */
export function moveResourcePack(file: string, delta: -1 | 1): Promise<boolean> {
  return serial(async () => {
    const active = (await readResourcePacks()).active.filter((f) => exists('resourcepack', f))
    const i = active.indexOf(file)
    const j = i + delta
    if (i < 0 || j < 0 || j >= active.length) return false
    ;[active[i], active[j]] = [active[j], active[i]]
    await writeResourcePacks(active)
    return true
  })
}

/** After a file was replaced by another version: the game settings follow the new name. */
async function renameInSettings(type: PackType, from: string, to: string): Promise<void> {
  if (from === to) return
  if (type === 'resourcepack') {
    const { active } = await readResourcePacks()
    if (active.includes(from)) await writeResourcePacks(active.map((f) => (f === from ? to : f)))
  } else {
    const sh = await readShaders()
    if (sh.pack === from) await writeShaders({ ...sh, pack: to })
  }
}

/** To the Recycle Bin; it's switched off first. */
export function removePack(type: PackType, file: string): Promise<boolean> {
  return serial(async () => {
    const e = packEntries(type).find((x) => x.file === file)
    if (!e) return false
    if (type === 'resourcepack') {
      const { active } = await readResourcePacks()
      if (active.includes(file)) await writeResourcePacks(active.filter((f) => f !== file))
    } else {
      const sh = await readShaders()
      if (sh.pack === file) await writeShaders({ pack: '', on: false })
    }
    await shell.trashItem(e.path)
    const reg = readRegistry()
    const r = reg[key(type, file)]
    void record({ kind: 'remove', type, name: r?.title ?? file.replace(/\.zip$/i, ''), projectId: r?.projectId ?? null, from: r?.versionNumber ?? null, fromVersionId: r?.versionId ?? null })
    delete reg[key(type, file)]
    await writeRegistry(reg)
    return true
  })
}

// ------------------------------------------------------------------------------ Modrinth: versions, install, updates

async function download(type: PackType, v: ModrinthVersion): Promise<{ file: string; sha512: string; size: number }> {
  const f = primaryFile(v)
  if (!isSafePackFileName(f.filename)) throw new Error(`not a pack file: ${f.filename}`)
  const store = join(gamePaths().root, 'store')
  await downloadToStore(store, { url: f.url, sha512: f.hashes.sha512, size: f.size }, () => {})
  await mkdir(packDir(type), { recursive: true })
  const dest = join(packDir(type), f.filename)
  if (!existsSync(dest)) await copyFile(blobPath(store, f.hashes.sha512), dest)
  return { file: f.filename, sha512: f.hashes.sha512, size: f.size }
}

async function recordFor(type: PackType, file: string, v: ModrinthVersion, base: Partial<PackRecord>): Promise<PackRecord> {
  const st = await stat(join(packDir(type), file))
  return {
    title: null,
    icon: '',
    pinned: null,
    ...base,
    file,
    size: st.size,
    mtimeMs: st.mtimeMs,
    addedAt: st.birthtimeMs || st.mtimeMs,
    sha512: primaryFile(v).hashes.sha512,
    lookedUp: true,
    projectId: v.project_id,
    versionId: v.id,
    versionNumber: v.version_number,
    update: null,
  }
}

export function packVersions(type: PackType, file: string, minecraft: string): Promise<ModVersionChoice[] | null> {
  return serial(async () => {
    const r = (await identify(type))[key(type, file)]
    if (!r?.projectId) return null
    const versions = (await projectVersions(r.projectId, minecraft, type)).sort((a, b) => b.date_published.localeCompare(a.date_published))
    const latest = pickVersion(versions)
    return versions.slice(0, 60).map((v) => ({
      id: v.id,
      versionNumber: v.version_number,
      name: v.name,
      type: v.version_type,
      published: v.date_published,
      current: v.id === r.versionId,
      latest: v.id === latest?.id,
      locked: v.id === r.versionId && r.pinned === minecraft,
    }))
  })
}

/** Switches a pack to another Modrinth version (on/off and order are kept). The old file goes to the Recycle Bin. */
async function switchVersion(type: PackType, file: string, v: ModrinthVersion, minecraft: string, lock: boolean, kind: ModHistoryEntry['kind']): Promise<string> {
  const reg = readRegistry()
  const r = reg[key(type, file)]
  const placed = await download(type, v)
  if (placed.file.toLowerCase() !== file.toLowerCase()) {
    await renameInSettings(type, file, placed.file)
    await shell.trashItem(join(packDir(type), file))
  }
  delete reg[key(type, file)]
  reg[key(type, placed.file)] = await recordFor(type, placed.file, v, { title: r?.title ?? null, icon: r?.icon ?? '', pinned: lock ? minecraft : null, addedAt: r?.addedAt })
  await writeRegistry(reg)
  void record({ kind, type, name: r?.title ?? file.replace(/\.zip$/i, ''), projectId: v.project_id, from: r?.versionNumber ?? null, to: v.version_number, fromVersionId: r?.versionId ?? null, toVersionId: v.id })
  return placed.file
}

export function setPackVersion(type: PackType, file: string, versionId: string, minecraft: string, lock: boolean): Promise<PackResult & { versionNumber?: string }> {
  return serial(async () => {
    const reg = await identify(type)
    const r = reg[key(type, file)]
    if (!r?.projectId) return { ok: false, reason: 'notFound' }
    let versions: ModrinthVersion[]
    try {
      versions = await projectVersions(r.projectId, minecraft, type)
    } catch {
      return { ok: false, reason: 'network' }
    }
    const v = versions.find((x) => x.id === versionId)
    if (!v) return { ok: false, reason: 'notFound' }
    if (r.pinned === minecraft && v.id !== r.versionId) return { ok: false, reason: 'locked' }
    if (v.id === r.versionId) {
      if (lock !== (r.pinned === minecraft)) void record({ kind: lock ? 'lock' : 'unlock', type, name: r.title ?? file, projectId: r.projectId, to: r.versionNumber, toVersionId: r.versionId })
      r.pinned = lock ? minecraft : null
      await writeRegistry(reg)
      return { ok: true, versionNumber: v.version_number }
    }
    try {
      await switchVersion(type, file, v, minecraft, lock, 'version')
    } catch (err) {
      console.warn(`[packs] version change of ${file} failed:`, err)
      return { ok: false, reason: 'network' }
    }
    return { ok: true, versionNumber: v.version_number }
  })
}

export function setPackLock(type: PackType, file: string, locked: boolean, minecraft: string): Promise<boolean> {
  return serial(async () => {
    const reg = await identify(type)
    const r = reg[key(type, file)]
    if (!r?.versionId) return false
    if (locked !== (r.pinned === minecraft)) void record({ kind: locked ? 'lock' : 'unlock', type, name: r.title ?? file, projectId: r.projectId, to: r.versionNumber, toVersionId: r.versionId })
    r.pinned = locked ? minecraft : null
    await writeRegistry(reg)
    return true
  })
}

/** Installs a pack from Modrinth. A resource pack goes on top of the others; a shader is used when none is. */
export function installPack(type: PackType, projectId: string, confirmed: boolean, minecraft: string, policy: ModPolicy | null | undefined, versionId: string | null = null): Promise<InstallResult> {
  return serial(async () => {
    const verdict = policyFor(policy, projectId).verdict
    if (verdict === 'blocked') return { ok: false, reason: 'blocked' }
    if (verdict === 'askStaff' && !confirmed) return { ok: false, reason: 'needsConfirm' }
    let v: ModrinthVersion | null
    let title = projectId
    try {
      const all = await projectVersions(projectId, minecraft, type)
      v = versionId ? (all.find((x) => x.id === versionId) ?? null) : pickVersion(all)
      if (!v) return { ok: false, reason: 'notCompatible' }
      const project = (await getProjects([projectId])).get(projectId)
      title = project?.title ?? title
      const placed = await download(type, v)
      const reg = readRegistry()
      reg[key(type, placed.file)] = await recordFor(type, placed.file, v, { title: project?.title ?? null, icon: safeIcon(project?.icon_url) })
      await writeRegistry(reg)
      if (type === 'resourcepack') {
        const { active } = await readResourcePacks()
        await writeResourcePacks([placed.file, ...active.filter((f) => f !== placed.file)])
      } else if (!(await readShaders()).on) await writeShaders({ pack: placed.file, on: true })
    } catch (err) {
      console.warn('[packs] install failed:', err)
      return { ok: false, reason: 'network' }
    }
    void record({ kind: 'install', type, name: title, projectId, to: v.version_number, toVersionId: v.id })
    console.log(`[packs] installed ${type} ${title} ${v.version_number}`)
    return { ok: true, installed: [title], alreadyHad: [] }
  })
}

export function checkPackUpdates(type: PackType, minecraft: string): Promise<UpdateCheck> {
  return serial(async () => {
    const reg = await identify(type)
    const known = Object.entries(reg).filter(([k, r]) => k.startsWith(`${type}/`) && r.projectId && r.versionId)
    const latest = await latestByHash(
      known.map(([, r]) => r.sha512),
      minecraft,
      type,
    )
    let updates = 0
    for (const [, r] of known) {
      const found = latest[r.sha512]
      const v = found ? await updateTarget(r.projectId!, r.versionId!, found, minecraft, type).catch(() => null) : null
      r.update = v ? { versionId: v.id, versionNumber: v.version_number } : null
      if (r.update) updates++
    }
    await writeRegistry(reg)
    return { checked: known.length, updates }
  })
}

/** Updates every unlocked pack that has a newer version (from the last check). */
export function updatePacks(type: PackType, minecraft: string): Promise<UpdateApplied> {
  return serial(async () => {
    const reg = await identify(type)
    const updated: string[] = []
    for (const [k, r] of Object.entries(reg)) {
      if (!k.startsWith(`${type}/`) || !r.update || !r.projectId || r.pinned === minecraft) continue
      try {
        const v = (await projectVersions(r.projectId, minecraft, type)).find((x) => x.id === r.update!.versionId)
        if (!v) continue
        await switchVersion(type, r.file, v, minecraft, false, 'update')
        updated.push(r.title ?? r.file)
      } catch (err) {
        console.warn(`[packs] update of ${r.file} failed:`, err)
      }
    }
    return { updated, disabled: [] }
  })
}

/** The newest change of a pack, while the pack is still as it left it: how to undo it (null = can't). */
export function packUndoFor(e: ModHistoryEntry, items: PackItem[], minecraft: string, policy: ModPolicy | null | undefined): (() => Promise<boolean>) | null {
  const type = e.type
  if (!type || type === 'mod' || !e.projectId) return null
  const mine = items.find((i) => i.projectId === e.projectId)
  const asLeft = !!mine && mine.versionNumber === e.to
  switch (e.kind) {
    case 'version':
    case 'update':
      if (!asLeft || !e.fromVersionId || mine!.locked) return null
      return async () => (await setPackVersion(type, mine!.file, e.fromVersionId!, minecraft, false)).ok
    case 'install':
      return asLeft ? () => removePack(type, mine!.file) : null
    case 'remove':
      if (!e.fromVersionId || mine) return null
      return async () => (await installPack(type, e.projectId!, true, minecraft, policy, e.fromVersionId)).ok
    case 'lock':
    case 'unlock':
      if (!asLeft || mine!.locked !== (e.kind === 'lock')) return null
      return () => setPackLock(type, mine!.file, e.kind === 'unlock', minecraft)
    default:
      return null
  }
}

// ------------------------------------------------------------------------------ presets, share codes, setups

/** Every pack of a kind with what it is on Modrinth (null for unknown files and folders). */
export function identifiedPacks(
  type: PackType,
  lookup = true,
): Promise<{ file: string; folder: boolean; projectId: string | null; versionId: string | null; pinned: string | null; title: string | null; sha512: string | null; path: string }[]> {
  return serial(async () => {
    const reg = await identify(type, lookup)
    return packEntries(type).map((e) => {
      const r = reg[key(type, e.file)]
      return { file: e.file, folder: e.folder, path: e.path, projectId: r?.projectId ?? null, versionId: r?.versionId ?? null, pinned: r?.pinned ?? null, title: r?.title ?? null, sha512: r?.sha512 ?? null }
    })
  })
}

/** Puts one Modrinth version of a pack in its folder (if it isn't there yet) and remembers it; settings untouched. */
export function addPackVersion(type: PackType, v: ModrinthVersion, title: string | null, icon: string, lockFor: string | null): Promise<string> {
  return serial(async () => {
    const placed = await download(type, v)
    const reg = readRegistry()
    reg[key(type, placed.file)] = await recordFor(type, placed.file, v, { title, icon, pinned: lockFor })
    await writeRegistry(reg)
    return placed.file
  })
}

/** Puts a pack file (from a setup or a restore point) in its folder under its name, unless it's there already. */
export async function addPackFile(type: PackType, file: string, from: string): Promise<boolean> {
  if (!isSafePackFileName(file)) return false
  const dest = join(packDir(type), file)
  if (existsSync(dest)) return true
  await mkdir(packDir(type), { recursive: true })
  await copyFile(from, `${dest}.tmp`)
  await rename(`${dest}.tmp`, dest)
  return true
}
