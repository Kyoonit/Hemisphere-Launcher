import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'
import { gunzip, gzip } from 'node:zlib'
import { z } from 'zod'
import type { ClientManifest } from '@shared/manifest'
import { MODRINTH_ID, policyFor, type ModPolicy } from '@shared/modBrowser'
import { SETUP_SETTINGS, type SetupExportResult, type SetupImportResult, type SetupSummary } from '@shared/restorePoints'
import type { Settings } from '@shared/settings'
import { gamePaths } from '../game/target'
import { isSafeModFileName, latestByHash, pickVersion, primaryFile, projectVersions, versionsByHash, type ModrinthVersion } from '../modrinth/api'
import { identifyPlayerMods, registryKey, type PlayerModRecord } from '../modrinth/playerMods'
import { getSettings, updateSettings } from '../settings/settings'
import { blobPath, downloadToStore } from '../sync/download'
import { readInstanceState } from '../sync/sync'
import { applyPlan, createRestorePoint, currentMods, gameFiles, isSetupPath, sha512Of, type ApplyPlan } from './restorePoints'

/**
 * "Export my setup" / "Import my setup": keybinds and video settings, the server list, mod configs, the player's mods
 * (on/off, versions, locks), Hemisphere mod choices and a few launcher settings, in one .hemisphere file to carry to
 * another PC. Never accounts, worlds or the game folder. Mods from Modrinth are re-downloaded (hash-checked) on the
 * other PC; only the others travel inside the file.
 *
 * File: gzip( "HEMISETUP1\n" | u32 header length | header JSON | file bytes in header order )
 */
const MAGIC = Buffer.from('HEMISETUP1\n')
const MAX_FILE = 1024 * 1024 * 1024
const MAX_UNPACKED = 1536 * 1024 * 1024
export const SETUP_EXTENSION = 'hemisphere'

const sha512 = z.string().regex(/^[0-9a-f]{128}$/)
const HeaderSchema = z.object({
  format: z.literal('hemisphere-setup'),
  version: z.literal(1),
  createdAt: z.number().int().nonnegative(),
  launcherVersion: z.string().max(40),
  clientVersion: z.string().max(40).nullable(),
  minecraft: z.string().max(40).nullable(),
  settings: z.record(z.string(), z.unknown()),
  choices: z.record(z.string().regex(/^[a-z0-9-]{1,64}$/), z.boolean()),
  detached: z.array(z.string().regex(/^[a-z0-9-]{1,64}$/)).max(500),
  mods: z
    .array(
      z.object({
        file: z.string().max(200).refine(isSafeModFileName, 'unsafe mod file name'),
        enabled: z.boolean(),
        sha512,
        size: z.number().int().nonnegative().max(512 * 1024 * 1024),
        title: z.string().max(200).nullable(),
        version: z.string().max(100).nullable(),
        projectId: z.string().regex(MODRINTH_ID).nullable(),
        locked: z.boolean(),
        /** carried inside the file (not on Modrinth) */
        embedded: z.boolean(),
      }),
    )
    .max(1000),
  files: z.array(z.object({ path: z.string().refine(isSetupPath, 'unsafe path'), size: z.number().int().nonnegative().max(8 * 1024 * 1024) })).max(20_000),
})
type Header = z.infer<typeof HeaderSchema>

export interface ParsedSetup {
  header: Header
  /** bytes of each file (files first, then embedded mods), in header order */
  files: Map<string, Buffer>
  embedded: Map<string, Buffer>
}

export async function exportSetup(path: string, launcherVersion: string, client: { clientVersion: string; minecraft: string } | null): Promise<SetupExportResult> {
  try {
    const state = await readInstanceState()
    const owned = Object.keys(state.owned)
    const reg = await identifyPlayerMods(owned)
    const mods = await currentMods(owned, reg)
    const files = await gameFiles()
    const blobs: Buffer[] = []
    const fileEntries: Header['files'] = []
    for (const rel of files) {
      const data = await readFile(join(gamePaths().instance, ...rel.split('/'))).catch(() => null)
      if (!data) continue
      fileEntries.push({ path: rel, size: data.length })
      blobs.push(data)
    }
    const minecraft = state.minecraft ?? client?.minecraft ?? null
    const modEntries: Header['mods'] = []
    for (const m of mods) {
      const e = reg[registryKey(m.file)]
      const embedded = !e?.projectId
      if (embedded) blobs.push(await readFile(m.path))
      modEntries.push({
        file: m.file,
        enabled: m.enabled,
        sha512: m.sha512,
        size: m.size,
        title: m.title,
        version: m.version,
        projectId: e?.projectId ?? null,
        locked: !!minecraft && e?.pinned === minecraft,
        embedded,
      })
    }
    const settings = getSettings()
    const header: Header = {
      format: 'hemisphere-setup',
      version: 1,
      createdAt: Date.now(),
      launcherVersion,
      clientVersion: state.clientVersion ?? client?.clientVersion ?? null,
      minecraft,
      settings: Object.fromEntries(SETUP_SETTINGS.map((k) => [k, settings[k]])),
      choices: state.choices,
      detached: state.detached,
      mods: modEntries,
      files: fileEntries,
    }
    const json = Buffer.from(JSON.stringify(header))
    const len = Buffer.alloc(4)
    len.writeUInt32LE(json.length)
    const packed = await promisify(gzip)(Buffer.concat([MAGIC, len, json, ...blobs]))
    await writeFile(path, packed)
    console.log(`[setup] exported ${modEntries.length} mods (${modEntries.filter((m) => m.embedded).length} inside), ${fileEntries.length} files, ${packed.length} bytes`)
    return { ok: true, path, bytes: packed.length, mods: modEntries.length, embedded: modEntries.filter((m) => m.embedded).length }
  } catch (err) {
    console.error('[setup] export failed:', err)
    return { ok: false, reason: 'failed', detail: String(err) }
  }
}

/** Reads and checks a setup file. null = not a (valid) setup file. */
export async function readSetup(path: string): Promise<ParsedSetup | null> {
  try {
    if ((await stat(path)).size > MAX_FILE) return null
    const raw = await promisify(gunzip)(await readFile(path), { maxOutputLength: MAX_UNPACKED })
    if (raw.length < MAGIC.length + 4 || !raw.subarray(0, MAGIC.length).equals(MAGIC)) return null
    const len = raw.readUInt32LE(MAGIC.length)
    let offset = MAGIC.length + 4
    if (len > 50 * 1024 * 1024 || offset + len > raw.length) return null
    const header = HeaderSchema.parse(JSON.parse(raw.subarray(offset, offset + len).toString('utf8')))
    offset += len
    const take = (size: number) => {
      if (offset + size > raw.length) throw new Error('truncated')
      const b = raw.subarray(offset, offset + size)
      offset += size
      return b
    }
    const files = new Map(header.files.map((f) => [f.path, take(f.size)] as const))
    const embedded = new Map<string, Buffer>()
    for (const m of header.mods) {
      if (!m.embedded) continue
      const data = take(m.size)
      if (sha512Of(data) !== m.sha512) return null
      embedded.set(m.sha512, data)
    }
    if (offset !== raw.length) return null
    return { header, files, embedded }
  } catch (err) {
    console.warn('[setup] not a setup file:', String(err))
    return null
  }
}

export function summarize(name: string, s: ParsedSetup, currentMinecraft: string): SetupSummary {
  const h = s.header
  return {
    name: basename(name),
    createdAt: h.createdAt,
    clientVersion: h.clientVersion,
    minecraft: h.minecraft,
    currentMinecraft,
    mods: h.mods.length,
    embedded: h.mods.filter((m) => m.embedded).length,
    configFiles: h.files.filter((f) => f.path.startsWith('config/')).length,
    options: h.files.some((f) => f.path === 'options.txt'),
    servers: h.files.some((f) => f.path === 'servers.dat'),
    launcherSettings: Object.keys(h.settings).length > 0,
  }
}

/** Newest stable version for this Minecraft version, from Modrinth's "latest" for a file. */
async function versionFor(latest: ModrinthVersion, minecraft: string): Promise<ModrinthVersion | null> {
  if (latest.version_type === 'release') return latest
  return pickVersion(await projectVersions(latest.project_id, minecraft).catch(() => [])) ?? latest
}

/**
 * Applies a setup on this PC (after a restore point "Before importing a setup"). Mods from Modrinth are downloaded
 * again, in the same version when Minecraft matches, else in their version for this PC's Minecraft (locks dropped).
 * Blocked mods are left out.
 */
export async function importSetup(s: ParsedSetup, manifest: ClientManifest, policy: ModPolicy | null | undefined): Promise<SetupImportResult> {
  const h = s.header
  const sameMinecraft = h.minecraft === manifest.minecraft
  const skipped: Extract<SetupImportResult, { ok: true }>['skipped'] = []
  const updated: string[] = []
  const name = (m: Header['mods'][number]) => m.title ?? m.file.replace(/\.jar$/i, '')

  // 1. Find every Modrinth mod's file (before changing anything: offline = nothing happens).
  const remote = h.mods.filter((m) => !m.embedded)
  let found: Record<string, ModrinthVersion>
  try {
    found = sameMinecraft ? await versionsByHash(remote.map((m) => m.sha512)) : await latestByHash(remote.map((m) => m.sha512), manifest.minecraft)
  } catch (err) {
    return { ok: false, reason: 'failed', detail: `Modrinth: ${String(err)}` }
  }

  const store = join(gamePaths().root, 'store')
  const incoming = join(gamePaths().instance, '.hemisphere', 'incoming')
  await rm(incoming, { recursive: true, force: true })
  await mkdir(incoming, { recursive: true })
  const plan: ApplyPlan = { files: [...s.files].map(([rel, data]) => ({ rel, data })), mods: [], choices: h.choices, detached: h.detached }

  for (const m of h.mods) {
    if (m.embedded) {
      const from = join(incoming, `${m.sha512.slice(0, 40)}.jar`)
      await writeFile(from, s.embedded.get(m.sha512)!)
      plan.mods.push({ file: m.file, enabled: m.enabled, sha512: m.sha512, size: m.size, title: m.title, version: m.version, from })
      continue
    }
    let v: ModrinthVersion | null = found[m.sha512] ?? null
    if (v && !sameMinecraft) v = await versionFor(v, manifest.minecraft)
    if (!v) {
      skipped.push({ name: name(m), reason: 'notAvailable' })
      continue
    }
    if (policyFor(policy, v.project_id).verdict === 'blocked') {
      skipped.push({ name: name(m), reason: 'blocked' })
      continue
    }
    const file = sameMinecraft ? (v.files.find((f) => f.hashes.sha512 === m.sha512) ?? primaryFile(v)) : primaryFile(v)
    if (!isSafeModFileName(file.filename)) {
      skipped.push({ name: name(m), reason: 'notAvailable' })
      continue
    }
    try {
      await downloadToStore(store, { url: file.url, sha512: file.hashes.sha512, size: file.size }, () => {})
    } catch (err) {
      console.warn(`[setup] download of ${m.file} failed:`, err)
      skipped.push({ name: name(m), reason: 'download' })
      continue
    }
    if (file.hashes.sha512 !== m.sha512) updated.push(name(m))
    const record: Partial<PlayerModRecord> = {
      lookedUp: true,
      projectId: v.project_id,
      versionId: v.id,
      versionNumber: v.version_number,
      title: m.title,
      pinned: m.locked && file.hashes.sha512 === m.sha512 ? manifest.minecraft : null,
    }
    plan.mods.push({ file: file.filename, enabled: m.enabled, sha512: file.hashes.sha512, size: file.size, title: m.title, version: v.version_number, from: blobPath(store, file.hashes.sha512), record })
  }

  // 2. Safety net, then apply.
  let safetyPoint: string | null
  try {
    safetyPoint = await createRestorePoint({ kind: 'setupImport' }, { clientVersion: manifest.clientVersion, minecraft: manifest.minecraft })
  } catch (err) {
    await rm(incoming, { recursive: true, force: true })
    return { ok: false, reason: 'failed', detail: String(err) }
  }
  try {
    const missing = await applyPlan(plan, manifest)
    for (const n of missing) skipped.push({ name: n, reason: 'download' })
    await applySettings(h.settings)
  } catch (err) {
    console.error('[setup] import failed:', err)
    return { ok: false, reason: 'failed', detail: String(err) }
  } finally {
    await rm(incoming, { recursive: true, force: true })
  }
  console.log(`[setup] imported ${plan.mods.length} mods (${updated.length} other version, ${skipped.length} skipped), ${plan.files.length} files`)
  return { ok: true, installed: plan.mods.length, updated, skipped, safetyPoint }
}

/** Launcher settings from a setup, one by one (an invalid value is just left as it is). */
async function applySettings(values: Record<string, unknown>): Promise<void> {
  for (const k of SETUP_SETTINGS) {
    if (!(k in values)) continue
    await updateSettings({ [k]: values[k] } as Partial<Settings>).catch(() => console.warn(`[setup] setting ${k} ignored`))
  }
}

/** Setups picked in the open dialog, until imported (the page only gets a token). */
const picked = new Map<string, ParsedSetup>()
export function rememberSetup(s: ParsedSetup): string {
  picked.clear() // only the last one picked
  const token = randomBytes(8).toString('hex')
  picked.set(token, s)
  return token
}
export const takeSetup = (token: unknown): ParsedSetup | null => {
  if (typeof token !== 'string') return null
  const s = picked.get(token) ?? null
  picked.delete(token)
  return s
}
