import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, cp, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { deflateRawSync, inflateRawSync } from 'node:zlib'
import { z } from 'zod'
import type { ClientManifest } from '@shared/manifest'
import { MODRINTH_ID, policyFor, type ModPolicy } from '@shared/modBrowser'
import { MAX_SETS, SET_NAME_MAX, type ModSetInfo, type ModSetsState, type SetImportResult, type SetShareResult, type SetSwitchResult } from '@shared/modSets'
import { gamePaths } from '../game/target'
import { getProjects, getVersions, isSafeModFileName, isSafePackFileName, pickVersion, primaryFile, projectVersions, safeIcon, type ModrinthVersion, type ProjectKind } from '../modrinth/api'
import { record } from '../modrinth/history'
import { readPlayerRegistry, registryKey, withPlayerMods, type PlayerModRecord } from '../modrinth/playerMods'
import { blobPath, downloadToStore, tempNameFor } from '../sync/download'
import { readInstanceState } from '../sync/sync'
import { addPackVersion, identifiedPacks, packEntries } from '../packs/packs'
import type { PackType } from '@shared/packs'
import { readResourcePacks, readShaders, writeResourcePacks, writeShaders } from '../packs/gameSettings'
import { applyPlan, cleanJars, currentMods, gameFiles, isSetupPath, jarPath, setsDir, storeJar, withJarStore, type PointMod } from './restorePoints'

/**
 * Mod sets: named lists of the player's mods (which are on, their versions and locks, plus the Hemisphere mods
 * switched on or off) to switch between in one click: a building set, a light one for events…
 * instance/.hemisphere/mod-sets/<id>.json, active.json. Their files are kept with the restore points' (one copy each).
 *
 * Switching first saves the mods as they are now into the active set (or, the first time, into a new set "My mods"),
 * then puts exactly the new set's mods in place. Nothing is lost: every file stays kept for the set that has it.
 * A set also keeps its game settings: options.txt (keybinds, video, sound…), servers.dat and the mod configs, as copies
 * in <id>.files/ (the config files Hemisphere manages and enforces stay Hemisphere's, the same in every set).
 */
interface ModSet {
  format: 1
  id: string
  name: string
  createdAt: number
  updatedAt: number
  choices: Record<string, boolean>
  detached: string[]
  mods: PointMod[]
  registry: Record<string, PlayerModRecord>
  /** resource packs that are on (top first) and the shader in use; missing in sets saved before packs (left as is) */
  packs?: { resource: string[]; shader: { pack: string; on: boolean } }
  /** game settings kept in <id>.files/ (relative paths); missing in sets saved before they were (left as they are) */
  files?: string[]
}

export const isSetId = (id: unknown): id is string => typeof id === 'string' && /^s[0-9a-z]{8,12}-[0-9a-f]{4}$/.test(id)
const setFile = (id: string) => join(setsDir(), `${id}.json`)
const activeFile = () => join(setsDir(), 'active.json')
const filesDir = (id: string) => join(setsDir(), `${id}.files`)
const inInstance = (rel: string) => join(gamePaths().instance, ...rel.split('/'))
export const cleanName = (name: unknown) => (typeof name === 'string' ? name.replace(/[\u0000-\u001f]/g, '').trim().slice(0, SET_NAME_MAX) : '')

async function writeJson(path: string, data: unknown): Promise<void> {
  await mkdir(setsDir(), { recursive: true })
  await writeFile(`${path}.tmp`, JSON.stringify(data))
  await rename(`${path}.tmp`, path)
}
async function readSet(id: string): Promise<ModSet | null> {
  if (!isSetId(id)) return null
  try {
    const s = JSON.parse(await readFile(setFile(id), 'utf8')) as ModSet
    return s.format === 1 && s.id === id ? s : null
  } catch {
    return null
  }
}
async function allSets(): Promise<ModSet[]> {
  const ids = (await readdir(setsDir()).catch(() => [] as string[])).map((n) => n.replace(/\.json$/, '')).filter(isSetId)
  return (await Promise.all(ids.map(readSet))).filter((s): s is ModSet => !!s).sort((a, b) => a.createdAt - b.createdAt)
}
async function activeId(): Promise<string | null> {
  try {
    const { id } = JSON.parse(await readFile(activeFile(), 'utf8')) as { id: unknown }
    return isSetId(id) && (await readSet(id)) ? id : null
  } catch {
    return null
  }
}
const setActive = (id: string | null) => writeJson(activeFile(), { id })
const newId = () => `s${Date.now().toString(36)}-${randomBytes(2).toString('hex')}`
const info = (s: ModSet): ModSetInfo => ({
  id: s.id,
  name: s.name,
  mods: s.mods.length,
  enabled: s.mods.filter((m) => m.enabled).length,
  packs: s.packs?.resource.length ?? null,
  shader: s.packs ? (s.packs.shader.on && s.packs.shader.pack ? s.packs.shader.pack.replace(/\.zip$/i, '') : '') : null,
  updatedAt: s.updatedAt,
})
const uniqueName = (name: string, sets: ModSet[], except?: string) => {
  const taken = new Set(sets.filter((s) => s.id !== except).map((s) => s.name.toLowerCase()))
  let out = name
  for (let i = 2; taken.has(out.toLowerCase()); i++) out = `${name.slice(0, SET_NAME_MAX - 5)} (${i})`
  return out
}

/** The game settings files that belong to sets: all of them but Hemisphere's managed and enforced config files. */
async function settingsFiles(): Promise<string[]> {
  const hemisphere = new Set(Object.keys((await readInstanceState()).owned).map((p) => p.toLowerCase()))
  return (await gameFiles()).filter((rel) => !hemisphere.has(rel.toLowerCase()))
}

/** Keeps the game settings as they are now for a set (copies: the game changes the files in place). */
async function keepFiles(id: string): Promise<string[]> {
  const files = await settingsFiles()
  const tmp = `${filesDir(id)}.tmp`
  await rm(tmp, { recursive: true, force: true })
  await mkdir(tmp, { recursive: true })
  for (const rel of files) {
    const dest = join(tmp, ...rel.split('/'))
    await mkdir(dirname(dest), { recursive: true })
    await copyFile(inInstance(rel), dest)
  }
  await rm(filesDir(id), { recursive: true, force: true })
  await rename(tmp, filesDir(id))
  return files
}

/** Puts a set's game settings in place, exactly (a file it doesn't have goes). A set saved before they were kept
 *  leaves them as they are: they become its own the next time it's saved. */
async function putFiles(set: ModSet): Promise<void> {
  if (!set.files) return
  const keep = new Set(set.files.map((rel) => rel.toLowerCase()))
  for (const rel of await settingsFiles()) if (!keep.has(rel.toLowerCase())) await rm(inInstance(rel), { force: true })
  for (const rel of set.files) {
    const src = join(filesDir(set.id), ...rel.split('/'))
    if (!isSetupPath(rel) || !existsSync(src)) continue
    const dest = inInstance(rel)
    await mkdir(dirname(dest), { recursive: true })
    const tmp = tempNameFor(dest)
    await copyFile(src, tmp)
    await rename(tmp, dest)
  }
}

/** One set operation at a time. */
let queue: Promise<unknown> = Promise.resolve()
function serial<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job)
  queue = run.catch(() => {})
  return run
}

/** Name of the set every player starts with. */
export const DEFAULT_SET_NAME = 'Default'

/**
 * There's always at least one set: the first time (fresh install, or a launcher from before sets), the mods as they
 * are become the active set "Default".
 */
async function ensureDefault(): Promise<void> {
  if ((await allSets()).length) return
  const now = Date.now()
  const id = newId()
  const set: ModSet = { format: 1, id, name: DEFAULT_SET_NAME, createdAt: now, updatedAt: now, ...(await capture()), files: await keepFiles(id) }
  await writeJson(setFile(set.id), set)
  await setActive(set.id)
  console.log(`[mod-sets] created "${set.name}" (${set.mods.length} mods)`)
}

export const listSets = (): Promise<ModSetsState> =>
  serial(async () => {
    await ensureDefault()
    return { sets: (await allSets()).map(info), active: await activeId() }
  })

/** The mods as they are now (their files kept), ready to be saved in a set. */
async function capture(): Promise<Pick<ModSet, 'choices' | 'detached' | 'mods' | 'registry' | 'packs'>> {
  const state = await readInstanceState()
  const { mods, reg } = await withPlayerMods(async () => {
    const reg = readPlayerRegistry()
    return { mods: await currentMods(Object.keys(state.owned), reg), reg }
  })
  await withJarStore(async () => {
    for (const m of mods) await storeJar(m.path, m.sha512)
  })
  return {
    choices: state.choices,
    detached: state.detached,
    mods: mods.map(({ path: _p, ...m }) => m),
    registry: Object.fromEntries(mods.flatMap((m) => (reg[registryKey(m.file)] ? [[registryKey(m.file), reg[registryKey(m.file)]]] : []))),
    // packs: only which are on (and the order) and the shader; the files stay in their folders for every preset
    packs: { resource: (await readResourcePacks()).active, shader: await readShaders() },
  }
}

/** Saves the mods as they are now as a new set, which becomes the active one. */
export const saveSet = (name: unknown): Promise<ModSetInfo | null> =>
  serial(async () => {
    const sets = await allSets()
    const n = cleanName(name)
    if (!n || sets.length >= MAX_SETS) return null
    const now = Date.now()
    const id = newId()
    const set: ModSet = { format: 1, id, name: uniqueName(n, sets), createdAt: now, updatedAt: now, ...(await capture()), files: await keepFiles(id) }
    await writeJson(setFile(set.id), set)
    await setActive(set.id)
    console.log(`[mod-sets] saved "${set.name}" (${set.mods.length} mods)`)
    return info(set)
  })

export const renameSet = (id: string, name: unknown): Promise<boolean> =>
  serial(async () => {
    const set = await readSet(id)
    const n = cleanName(name)
    if (!set || !n) return false
    set.name = uniqueName(n, await allSets(), id)
    await writeJson(setFile(id), set)
    return true
  })

/** A copy of a set ("Building (copy)"), to start a new one from it. Not switched to. */
export const duplicateSet = (id: string): Promise<ModSetInfo | null> =>
  serial(async () => {
    const set = await readSet(id)
    const sets = await allSets()
    if (!set || sets.length >= MAX_SETS) return null
    // the active set's saved copy may be behind: the copy takes the mods as they are now
    const isActive = (await activeId()) === id
    const live = isActive ? await capture() : {}
    const now = Date.now()
    const copyId = newId()
    let files = set.files
    if (isActive) files = await keepFiles(copyId)
    else if (set.files && existsSync(filesDir(id))) await cp(filesDir(id), filesDir(copyId), { recursive: true })
    const copy: ModSet = { ...set, ...live, ...(files ? { files } : {}), id: copyId, name: uniqueName(`${set.name.slice(0, SET_NAME_MAX - 7)} (copy)`, sets), createdAt: now, updatedAt: now }
    await writeJson(setFile(copy.id), copy)
    console.log(`[mod-sets] "${set.name}" duplicated as "${copy.name}"`)
    return info(copy)
  })

/** Deletes a set (the mods in the folder stay as they are). The last one can't be deleted. */
export const deleteSet = (id: string): Promise<boolean> =>
  serial(async () => {
    const sets = await allSets()
    if (!sets.some((s) => s.id === id) || sets.length <= 1) return false // the last set stays
    await rm(setFile(id), { force: true })
    await rm(filesDir(id), { recursive: true, force: true })
    if ((await activeId()) === null) await setActive(null)
    await withJarStore(() => cleanJars())
    return true
  })

/**
 * Switches to a set. The mods as they are now are saved first into the active set, or, when there's none, into a new
 * set named `fallbackName` ("My mods"); then the folders hold exactly the target set's mods.
 */
export const switchSet = (id: string, manifest: ClientManifest | null, fallbackName: unknown): Promise<SetSwitchResult> =>
  serial(async () => {
    const target = await readSet(id)
    if (!target) return { ok: false, reason: 'notFound' }
    try {
      const now = await capture()
      const active = await activeId()
      let savedAs: string | null = null
      if (active && active !== id) {
        const current = (await readSet(active))!
        await writeJson(setFile(active), { ...current, ...now, files: await keepFiles(active), updatedAt: Date.now() })
      } else if (!active) {
        const sets = await allSets()
        const t = Date.now()
        const savedId = newId()
        const saved: ModSet = { format: 1, id: savedId, name: uniqueName(cleanName(fallbackName) || 'My mods', sets), createdAt: t, updatedAt: t, ...now, files: await keepFiles(savedId) }
        await writeJson(setFile(saved.id), saved)
        savedAs = saved.name
      }

      // Exactly the target's mods. Everything else was just saved in the set being left (its files kept), so it
      // comes back with that set and never piles up as extra "off" mods in this one.
      const missing = await applyPlan(
        {
          files: [],
          mods: target.mods.map((m) => ({ ...m, from: jarPath(m.sha512), record: target.registry[registryKey(m.file)] })),
          choices: target.choices,
          detached: target.detached,
        },
        manifest,
      )
      await putFiles(target)
      if (target.packs) {
        const resource = new Set(packEntries('resourcepack').map((e) => e.file))
        const shaders = new Set(packEntries('shader').map((e) => e.file))
        await writeResourcePacks(target.packs.resource.filter((f) => resource.has(f)))
        const { pack, on } = target.packs.shader
        await writeShaders(shaders.has(pack) ? { pack, on } : { pack: '', on: false })
      }
      await setActive(id)
      void record({ kind: 'setSwitch', name: target.name })
      console.log(`[mod-sets] switched to "${target.name}" (${target.mods.length} mods)${missing.length ? `, missing: ${missing.join(', ')}` : ''}`)
      return { ok: true, missing, savedAs }
    } catch (err) {
      console.error('[mod-sets] switch failed:', err)
      return { ok: false, reason: 'failed' }
    }
  })

// ------------------------------------------------------------------------------ import from another launcher

const NO_PACKS: NonNullable<ModSet['packs']> = { resource: [], shader: { pack: '', on: false } }

/**
 * Before an import from another launcher brings mods or packs: the mods as they are now are saved in the active preset
 * (or in a new one named `fallbackName` when none is active), then the import goes into an EMPTY preset, so nothing
 * piles up twice: a new one named `name` (Hemisphere's mods as they come), or the active one emptied (`replace`; its
 * choices of Hemisphere mods are kept, and the restore point made just before keeps what it had).
 */
export const presetForImport = (
  mode: 'new' | 'replace',
  name: unknown,
  fallbackName: unknown,
  manifest: ClientManifest | null,
): Promise<{ ok: true; name: string; created: boolean } | { ok: false; reason: 'tooManyPresets' }> =>
  serial(async () => {
    await ensureDefault()
    const now = await capture()
    const sets = await allSets()
    const active = await activeId()
    const t = Date.now()
    let target: ModSet
    if (mode === 'replace' && active) {
      target = { ...(await readSet(active))!, choices: now.choices, detached: [], mods: [], registry: {}, packs: NO_PACKS, updatedAt: t }
    } else {
      if (sets.length + (active ? 1 : 2) > MAX_SETS) return { ok: false, reason: 'tooManyPresets' }
      if (active) await writeJson(setFile(active), { ...(await readSet(active))!, ...now, files: await keepFiles(active), updatedAt: t })
      else {
        const savedId = newId()
        const saved: ModSet = { format: 1, id: savedId, name: uniqueName(cleanName(fallbackName) || 'My mods', sets), createdAt: t, updatedAt: t, ...now, files: await keepFiles(savedId) }
        await writeJson(setFile(saved.id), saved)
        sets.push(saved)
      }
      target = { format: 1, id: newId(), name: uniqueName(cleanName(name) || 'Imported', sets), createdAt: t, updatedAt: t, choices: {}, detached: [], mods: [], registry: {}, packs: NO_PACKS }
    }
    await writeJson(setFile(target.id), target)
    await applyPlan({ files: [], mods: [], choices: target.choices, detached: [] }, manifest)
    await writeResourcePacks([])
    await writeShaders({ pack: '', on: false })
    await setActive(target.id)
    console.log(`[mod-sets] import goes into ${target.id === active ? 'the emptied' : 'the new'} preset "${target.name}"`)
    return { ok: true, name: target.name, created: target.id !== active }
  })

/** After an import: the active preset takes the mods and packs as they are now. */
export const keepImportInPreset = (): Promise<void> =>
  serial(async () => {
    const id = await activeId()
    const set = id ? await readSet(id) : null
    if (!set) return
    await writeJson(setFile(set.id), { ...set, ...(await capture()), files: await keepFiles(set.id), updatedAt: Date.now() })
    void record({ kind: 'setImport', name: set.name })
  })

// ------------------------------------------------------------------------------ sharing as a code

const CODE_PREFIX = 'HSET1-'
const mid = z.string().regex(MODRINTH_ID)
const bit = z.union([z.literal(0), z.literal(1)])
const modId = z.string().regex(/^[a-z0-9-]{1,64}$/)
const CodeV1 = z.object({
  v: z.literal(1),
  n: z.string().max(SET_NAME_MAX),
  mc: z.string().max(40),
  m: z.array(z.tuple([mid, mid, bit])).max(300),
  c: z.record(modId, z.boolean()),
})
/** v2: everything a preset holds. m = mods [project, version, on, locked]; r = resource packs [project, version,
 * position when on (0 = top) or -1, locked]; s = shader packs [project, version, in use, locked]; so = shaders on. */
const CodeV2 = z.object({
  v: z.literal(2),
  n: z.string().max(SET_NAME_MAX),
  mc: z.string().max(40),
  m: z.array(z.tuple([mid, mid, bit, bit])).max(300),
  c: z.record(modId, z.boolean()),
  d: z.array(modId).max(200),
  r: z.array(z.tuple([mid, mid, z.number().int().min(-1).max(500), bit])).max(300),
  s: z.array(z.tuple([mid, mid, bit, bit])).max(100),
  so: bit,
})
export type SetCode = z.infer<typeof CodeV2> | (z.infer<typeof CodeV1> & { d?: undefined; r?: undefined; s?: undefined; so?: undefined })

/**
 * A short code with everything in the preset that's on Modrinth: mods (on/off, locks), Hemisphere mod choices and
 * take-overs, resource packs (on/off and order, locks), shader packs (the one in use, locks) and whether shaders are on.
 * Files that aren't on Modrinth can't be shared: they're listed in `left`.
 */
export const shareSet = (id: string, minecraft: string): Promise<SetShareResult> =>
  serial(async () => {
    const saved = await readSet(id)
    if (!saved) return { ok: false, reason: 'notFound' }
    // the active preset's saved copy may be behind: share it as it is now
    const set: ModSet = (await activeId()) === id ? { ...saved, ...(await capture()) } : saved
    const left: string[] = []
    const lock = (pinned: string | null | undefined): 0 | 1 => (pinned && pinned === minecraft ? 1 : 0)
    const m: [string, string, 0 | 1, 0 | 1][] = []
    for (const mod of set.mods) {
      const r = set.registry[registryKey(mod.file)]
      if (r?.projectId && r.versionId) m.push([r.projectId, r.versionId, mod.enabled ? 1 : 0, lock(r.pinned)])
      else left.push(mod.title ?? mod.file.replace(/\.jar$/i, ''))
    }
    const order = set.packs?.resource ?? (await readResourcePacks()).active
    const shader = set.packs?.shader ?? (await readShaders())
    const r: [string, string, number, 0 | 1][] = []
    for (const p of await identifiedPacks('resourcepack')) {
      if (p.projectId && p.versionId) r.push([p.projectId, p.versionId, order.indexOf(p.file), lock(p.pinned)])
      else if (order.includes(p.file)) left.push(p.file.replace(/\.zip$/i, ''))
    }
    const s: [string, string, 0 | 1, 0 | 1][] = []
    for (const p of await identifiedPacks('shader')) {
      if (p.projectId && p.versionId) s.push([p.projectId, p.versionId, shader.pack === p.file ? 1 : 0, lock(p.pinned)])
      else if (shader.on && shader.pack === p.file) left.push(p.file.replace(/\.zip$/i, ''))
    }
    if (!m.length && !r.length && !s.length && !Object.keys(set.choices).length) return { ok: false, reason: 'empty' }
    const code: z.infer<typeof CodeV2> = { v: 2, n: set.name, mc: minecraft, m, c: set.choices, d: set.detached, r, s, so: shader.on ? 1 : 0 }
    return { ok: true, code: CODE_PREFIX + deflateRawSync(JSON.stringify(code)).toString('base64url'), left }
  })

export function decodeSetCode(code: string): SetCode | null {
  const raw = code.trim().replace(/\s+/g, '')
  if (!raw.startsWith(CODE_PREFIX) || raw.length > 40_000) return null
  try {
    const json = JSON.parse(inflateRawSync(Buffer.from(raw.slice(CODE_PREFIX.length), 'base64url'), { maxOutputLength: 400_000 }).toString('utf8')) as { v?: unknown }
    return json.v === 2 ? CodeV2.parse(json) : CodeV1.parse(json)
  } catch {
    return null
  }
}

type Skipped = Extract<SetImportResult, { ok: true }>['skipped']

/** The version to install for a shared one: the same when the Minecraft version matches, else its version for this one. */
async function shared(projectId: string, versionId: string, sameMinecraft: boolean, versions: ModrinthVersion[], minecraft: string, kind: ProjectKind) {
  const v = sameMinecraft ? (versions.find((x) => x.id === versionId && x.project_id === projectId) ?? null) : null
  return v ?? pickVersion(await projectVersions(projectId, minecraft, kind).catch(() => []))
}

/**
 * Adds a friend's preset from its code: each Modrinth mod and pack is downloaded (hash-checked), in the same version
 * when the Minecraft version matches (locks kept), else its version for this one (locks dropped). Blocked ones are
 * left out. The preset is added, not switched to.
 */
export async function importSetCode(code: unknown, manifest: ClientManifest, policy: ModPolicy | null | undefined): Promise<SetImportResult> {
  const data = typeof code === 'string' ? decodeSetCode(code) : null
  if (!data) return { ok: false, reason: 'invalid' }
  const skipped: Skipped = []
  const same = data.mc === manifest.minecraft
  const resource = data.r ?? []
  const shaderList = data.s ?? []
  let versions: ModrinthVersion[]
  try {
    versions = await getVersions([...data.m, ...resource, ...shaderList].map(([, v]) => v))
  } catch {
    return { ok: false, reason: 'failed' }
  }
  const titles = await getProjects([...data.m, ...resource, ...shaderList].map(([p]) => p))
  const name = (p: string) => titles.get(p)?.title ?? p
  const allowed = (p: string) => {
    if (policyFor(policy, p).verdict !== 'blocked') return true
    skipped.push({ name: name(p), reason: 'blocked' })
    return false
  }
  const store = join(gamePaths().root, 'store')
  const mods: PointMod[] = []
  const registry: Record<string, PlayerModRecord> = {}
  for (const entry of data.m) {
    const [projectId, versionId, enabled] = entry
    const locked = entry.length > 3 ? entry[3] : 0 // codes from before locks were shared
    if (!allowed(projectId)) continue
    const v = await shared(projectId, versionId, same, versions, manifest.minecraft, 'mod')
    if (!v) {
      skipped.push({ name: name(projectId), reason: 'notAvailable' })
      continue
    }
    const f = primaryFile(v)
    if (!isSafeModFileName(f.filename) || mods.some((m) => m.file.toLowerCase() === f.filename.toLowerCase())) continue
    try {
      await downloadToStore(store, { url: f.url, sha512: f.hashes.sha512, size: f.size }, () => {})
      await withJarStore(() => storeJar(blobPath(store, f.hashes.sha512), f.hashes.sha512))
    } catch {
      skipped.push({ name: name(projectId), reason: 'download' })
      continue
    }
    mods.push({ file: f.filename, enabled: enabled === 1, sha512: f.hashes.sha512, size: f.size, title: name(projectId), version: v.version_number })
    registry[registryKey(f.filename)] = {
      file: f.filename,
      size: f.size,
      mtimeMs: 0,
      sha512: f.hashes.sha512,
      lookedUp: true,
      projectId,
      versionId: v.id,
      versionNumber: v.version_number,
      title: name(projectId),
      icon: safeIcon(titles.get(projectId)?.icon_url),
      update: null,
      incompatibleWith: null,
      pinned: locked && v.id === versionId ? manifest.minecraft : null,
    }
  }

  // packs go to their folders (shared by every preset); the preset remembers which are on, in which order
  let packs: ModSet['packs']
  let packCount = 0
  if (data.v === 2) {
    const add = async (type: PackType, projectId: string, versionId: string, locked: number) => {
      if (!allowed(projectId)) return null
      const v = await shared(projectId, versionId, same, versions, manifest.minecraft, type)
      if (!v || !isSafePackFileName(primaryFile(v).filename)) {
        skipped.push({ name: name(projectId), reason: 'notAvailable' })
        return null
      }
      try {
        packCount++
        return await addPackVersion(type, v, titles.get(projectId)?.title ?? null, safeIcon(titles.get(projectId)?.icon_url), locked && v.id === versionId ? manifest.minecraft : null)
      } catch {
        packCount--
        skipped.push({ name: name(projectId), reason: 'download' })
        return null
      }
    }
    const on: { file: string; at: number }[] = []
    for (const [projectId, versionId, at, locked] of data.r) {
      const file = await add('resourcepack', projectId, versionId, locked)
      if (file && at >= 0) on.push({ file, at })
    }
    let inUse = ''
    for (const [projectId, versionId, active, locked] of data.s) {
      const file = await add('shader', projectId, versionId, locked)
      if (file && active) inUse = file
    }
    packs = { resource: on.sort((a, b) => a.at - b.at).map((x) => x.file), shader: { pack: inUse, on: data.so === 1 && !!inUse } }
  }

  return serial(async () => {
    const sets = await allSets()
    if (sets.length >= MAX_SETS) return { ok: false, reason: 'failed' } as const
    const now = Date.now()
    const known = new Set(manifest.mods.map((m) => m.id))
    // the friend's own version of a Hemisphere mod: the preset takes that mod over (else it's a duplicate, kept off)
    const projects = new Set(Object.values(registry).map((r) => r.projectId))
    const inferred = manifest.mods.filter((m) => m.category !== 'library' && m.source && projects.has(m.source.modrinth.projectId)).map((m) => m.id)
    // (a taken-over mod whose file couldn't be shared stays Hemisphere's: taking it over without a file would hide it)
    const detached = inferred.filter((id) => known.has(id))
    const set: ModSet = {
      format: 1,
      id: newId(),
      name: uniqueName(cleanName(data.n) || 'Shared preset', sets),
      createdAt: now,
      updatedAt: now,
      choices: Object.fromEntries(Object.entries(data.c).filter(([k]) => known.has(k))),
      detached,
      mods,
      registry,
      ...(packs ? { packs } : {}),
    }
    await writeJson(setFile(set.id), set)
    void record({ kind: 'setImport', name: set.name })
    console.log(`[mod-sets] imported "${set.name}" (${mods.length} mods, ${packCount} packs, ${skipped.length} left out)`)
    return { ok: true, id: set.id, name: set.name, mods: mods.length, packs: packCount, skipped }
  })
}

/** The active set's name (shown next to PLAY), null when none. */
export const activeSetName = (): Promise<string | null> =>
  serial(async () => {
    const id = await activeId()
    return id ? ((await readSet(id))?.name ?? null) : null
  })
