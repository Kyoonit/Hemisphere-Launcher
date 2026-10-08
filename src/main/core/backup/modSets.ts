import { randomBytes } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { deflateRawSync, inflateRawSync } from 'node:zlib'
import { z } from 'zod'
import type { ClientManifest } from '@shared/manifest'
import { MODRINTH_ID, policyFor, type ModPolicy } from '@shared/modBrowser'
import { MAX_SETS, SET_NAME_MAX, type ModSetInfo, type ModSetsState, type SetImportResult, type SetShareResult, type SetSwitchResult } from '@shared/modSets'
import { gamePaths } from '../game/target'
import { getProjects, getVersions, isSafeModFileName, pickVersion, primaryFile, projectVersions, type ModrinthVersion } from '../modrinth/api'
import { record } from '../modrinth/history'
import { readPlayerRegistry, registryKey, withPlayerMods, type PlayerModRecord } from '../modrinth/playerMods'
import { blobPath, downloadToStore } from '../sync/download'
import { readInstanceState } from '../sync/sync'
import { applyPlan, cleanJars, currentMods, jarPath, setsDir, storeJar, withJarStore, type PointMod } from './restorePoints'

/**
 * Mod sets: named lists of the player's mods (which are on, their versions and locks, plus the Hemisphere mods
 * switched on or off) to switch between in one click: a building set, a light one for events…
 * instance/.hemisphere/mod-sets/<id>.json, active.json. Their files are kept with the restore points' (one copy each).
 *
 * Switching first saves the mods as they are now into the active set (or, the first time, into a new set "My mods"),
 * then puts exactly the new set's mods in place. Nothing is lost: every file stays kept for the set that has it.
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
}

export const isSetId = (id: unknown): id is string => typeof id === 'string' && /^s[0-9a-z]{8,12}-[0-9a-f]{4}$/.test(id)
const setFile = (id: string) => join(setsDir(), `${id}.json`)
const activeFile = () => join(setsDir(), 'active.json')
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
const info = (s: ModSet): ModSetInfo => ({ id: s.id, name: s.name, mods: s.mods.length, enabled: s.mods.filter((m) => m.enabled).length, updatedAt: s.updatedAt })
const uniqueName = (name: string, sets: ModSet[], except?: string) => {
  const taken = new Set(sets.filter((s) => s.id !== except).map((s) => s.name.toLowerCase()))
  let out = name
  for (let i = 2; taken.has(out.toLowerCase()); i++) out = `${name.slice(0, SET_NAME_MAX - 5)} (${i})`
  return out
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
  const set: ModSet = { format: 1, id: newId(), name: DEFAULT_SET_NAME, createdAt: now, updatedAt: now, ...(await capture()) }
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
async function capture(): Promise<Pick<ModSet, 'choices' | 'detached' | 'mods' | 'registry'>> {
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
  }
}

/** Saves the mods as they are now as a new set, which becomes the active one. */
export const saveSet = (name: unknown): Promise<ModSetInfo | null> =>
  serial(async () => {
    const sets = await allSets()
    const n = cleanName(name)
    if (!n || sets.length >= MAX_SETS) return null
    const now = Date.now()
    const set: ModSet = { format: 1, id: newId(), name: uniqueName(n, sets), createdAt: now, updatedAt: now, ...(await capture()) }
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
    const live = (await activeId()) === id ? await capture() : {}
    const now = Date.now()
    const copy: ModSet = { ...set, ...live, id: newId(), name: uniqueName(`${set.name.slice(0, SET_NAME_MAX - 7)} (copy)`, sets), createdAt: now, updatedAt: now }
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
        await writeJson(setFile(active), { ...current, ...now, updatedAt: Date.now() })
      } else if (!active) {
        const sets = await allSets()
        const t = Date.now()
        const saved: ModSet = { format: 1, id: newId(), name: uniqueName(cleanName(fallbackName) || 'My mods', sets), createdAt: t, updatedAt: t, ...now }
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
      await setActive(id)
      void record({ kind: 'setSwitch', name: target.name })
      console.log(`[mod-sets] switched to "${target.name}" (${target.mods.length} mods)${missing.length ? `, missing: ${missing.join(', ')}` : ''}`)
      return { ok: true, missing, savedAs }
    } catch (err) {
      console.error('[mod-sets] switch failed:', err)
      return { ok: false, reason: 'failed' }
    }
  })

// ------------------------------------------------------------------------------ sharing as a code

const CODE_PREFIX = 'HSET1-'
const CodeSchema = z.object({
  v: z.literal(1),
  n: z.string().max(SET_NAME_MAX),
  mc: z.string().max(40),
  m: z.array(z.tuple([z.string().regex(MODRINTH_ID), z.string().regex(MODRINTH_ID), z.union([z.literal(0), z.literal(1)])])).max(300),
  c: z.record(z.string().regex(/^[a-z0-9-]{1,64}$/), z.boolean()),
})

/** A short code with the set's Modrinth mods (others can't be shared: they're listed in `left`). */
export const shareSet = (id: string, minecraft: string): Promise<SetShareResult> =>
  serial(async () => {
    const set = await readSet(id)
    if (!set) return { ok: false, reason: 'notFound' }
    const left: string[] = []
    const m: [string, string, 0 | 1][] = []
    for (const mod of set.mods) {
      const r = set.registry[registryKey(mod.file)]
      if (r?.projectId && r.versionId) m.push([r.projectId, r.versionId, mod.enabled ? 1 : 0])
      else left.push(mod.title ?? mod.file.replace(/\.jar$/i, ''))
    }
    if (!m.length && !Object.keys(set.choices).length) return { ok: false, reason: 'empty' }
    const json = JSON.stringify({ v: 1, n: set.name, mc: minecraft, m, c: set.choices })
    return { ok: true, code: CODE_PREFIX + deflateRawSync(json).toString('base64url'), left }
  })

export function decodeSetCode(code: string): z.infer<typeof CodeSchema> | null {
  const raw = code.trim().replace(/\s+/g, '')
  if (!raw.startsWith(CODE_PREFIX) || raw.length > 20_000) return null
  try {
    const json = inflateRawSync(Buffer.from(raw.slice(CODE_PREFIX.length), 'base64url'), { maxOutputLength: 200_000 }).toString('utf8')
    return CodeSchema.parse(JSON.parse(json))
  } catch {
    return null
  }
}

/**
 * Adds a friend's set from its code: each Modrinth mod is downloaded (hash-checked), in the same version when the
 * Minecraft version matches, else its version for this one. Blocked mods are left out. The set is added, not switched to.
 */
export async function importSetCode(code: unknown, manifest: ClientManifest, policy: ModPolicy | null | undefined): Promise<SetImportResult> {
  const data = typeof code === 'string' ? decodeSetCode(code) : null
  if (!data) return { ok: false, reason: 'invalid' }
  const skipped: Extract<SetImportResult, { ok: true }>['skipped'] = []
  let versions: ModrinthVersion[]
  try {
    versions = await getVersions(data.m.map(([, v]) => v))
  } catch {
    return { ok: false, reason: 'failed' }
  }
  const titles = await getProjects(data.m.map(([p]) => p))
  const store = join(gamePaths().root, 'store')
  const mods: PointMod[] = []
  const registry: Record<string, PlayerModRecord> = {}
  for (const [projectId, versionId, enabled] of data.m) {
    const name = titles.get(projectId)?.title ?? projectId
    let v: ModrinthVersion | null = versions.find((x) => x.id === versionId && x.project_id === projectId) ?? null
    if (!v || data.mc !== manifest.minecraft) v = pickVersion(await projectVersions(projectId, manifest.minecraft).catch(() => []))
    if (!v) {
      skipped.push({ name, reason: 'notAvailable' })
      continue
    }
    if (policyFor(policy, projectId).verdict === 'blocked') {
      skipped.push({ name, reason: 'blocked' })
      continue
    }
    const f = primaryFile(v)
    if (!isSafeModFileName(f.filename) || mods.some((m) => m.file.toLowerCase() === f.filename.toLowerCase())) continue
    try {
      await downloadToStore(store, { url: f.url, sha512: f.hashes.sha512, size: f.size }, () => {})
      await withJarStore(() => storeJar(blobPath(store, f.hashes.sha512), f.hashes.sha512))
    } catch {
      skipped.push({ name, reason: 'download' })
      continue
    }
    mods.push({ file: f.filename, enabled: enabled === 1, sha512: f.hashes.sha512, size: f.size, title: name, version: v.version_number })
    registry[registryKey(f.filename)] = {
      file: f.filename,
      size: f.size,
      mtimeMs: 0,
      sha512: f.hashes.sha512,
      lookedUp: true,
      projectId,
      versionId: v.id,
      versionNumber: v.version_number,
      title: name,
      icon: '',
      update: null,
      incompatibleWith: null,
      pinned: null,
    }
  }
  return serial(async () => {
    const sets = await allSets()
    if (sets.length >= MAX_SETS) return { ok: false, reason: 'failed' } as const
    const now = Date.now()
    const known = new Set(manifest.mods.map((m) => m.id))
    // the friend's own version of a Hemisphere mod: the set takes that mod over (else it's a duplicate, kept off)
    const projects = new Set(Object.values(registry).map((r) => r.projectId))
    const detached = manifest.mods.filter((m) => m.category !== 'library' && m.source && projects.has(m.source.modrinth.projectId)).map((m) => m.id)
    const set: ModSet = {
      format: 1,
      id: newId(),
      name: uniqueName(cleanName(data.n) || 'Shared set', sets),
      createdAt: now,
      updatedAt: now,
      choices: Object.fromEntries(Object.entries(data.c).filter(([k]) => known.has(k))),
      detached,
      mods,
      registry,
    }
    await writeJson(setFile(set.id), set)
    void record({ kind: 'setImport', name: set.name })
    console.log(`[mod-sets] imported "${set.name}" (${mods.length} mods, ${skipped.length} left out)`)
    return { ok: true, id: set.id, name: set.name, mods: mods.length, skipped }
  })
}

/** The active set's name (shown next to PLAY), null when none. */
export const activeSetName = (): Promise<string | null> =>
  serial(async () => {
    const id = await activeId()
    return id ? ((await readSet(id))?.name ?? null) : null
  })
