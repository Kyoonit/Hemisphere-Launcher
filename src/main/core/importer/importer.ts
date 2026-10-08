import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { copyFile, cp, mkdir, readdir, rename, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { homedir } from 'node:os'
import type { ImportOptions, ImportProgress, ImportReport, ImportSource, LauncherKind } from '@shared/importer'
import type { ClientManifest } from '@shared/manifest'
import { gamePaths } from '../game/target'
import { getProjects, isSafeModFileName, latestByHash, primaryFile, versionsByHash } from '../modrinth/api'

export { isSafeModFileName }
import { blobPath, downloadToStore, sha512OfFile } from '../sync/download'

/**
 * Import from another launcher. Sources are only READ — nothing in them is ever changed.
 * Copies into the Hemisphere instance: keybinds/settings and server list (previous files backed up),
 * resource/shader packs and mod configs (never overwriting), and the player's own mods in the version that
 * matches Hemisphere's Minecraft (looked up on Modrinth by file hash).
 */

const appData = () => process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')
const list = (dir: string) => {
  try {
    return readdirSync(dir)
  } catch {
    return [] as string[]
  }
}
const readJson = (file: string): unknown => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}
const isDir = (p: string) => {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

/** Minecraft version from the last game log ("Loading Minecraft 26.2 with Fabric…", "Minecraft Version: …"). */
function versionFromLog(gameDir: string): string | null {
  try {
    const head = readFileSync(join(gameDir, 'logs', 'latest.log'), 'utf8').slice(0, 20_000)
    return /Loading Minecraft (\S+)/.exec(head)?.[1] ?? /Minecraft Version:? (\S+)/i.exec(head)?.[1] ?? null
  } catch {
    return null
  }
}

function describe(launcher: LauncherKind, name: string, path: string, minecraft: string | null): ImportSource | null {
  const mods = list(join(path, 'mods')).filter((f) => f.toLowerCase().endsWith('.jar')).length
  const has = {
    settings: existsSync(join(path, 'options.txt')),
    servers: existsSync(join(path, 'servers.dat')),
    resourcepacks: list(join(path, 'resourcepacks')).length,
    shaderpacks: list(join(path, 'shaderpacks')).filter((f) => !f.endsWith('.txt')).length,
    config: list(join(path, 'config')).length > 0,
    mods,
  }
  if (!has.settings && !has.servers && !mods && !has.resourcepacks) return null // nothing worth importing
  return { id: path, launcher, name, path, minecraft: minecraft ?? versionFromLog(path), has }
}

/** Finds Minecraft setups from common launchers on this PC. */
export function detectSources(): ImportSource[] {
  const found: (ImportSource | null)[] = []
  const ad = appData()

  // Official launcher
  found.push(describe('official', 'Minecraft Launcher', join(ad, '.minecraft'), null))

  // Modrinth App (current and older folder names)
  for (const root of [join(ad, 'ModrinthApp', 'profiles'), join(ad, 'com.modrinth.theseus', 'profiles')])
    for (const p of list(root)) {
      const dir = join(root, p)
      const meta = readJson(join(dir, 'profile.json')) as { metadata?: { game_version?: string } } | null
      if (isDir(dir)) found.push(describe('modrinth', p, dir, meta?.metadata?.game_version ?? null))
    }

  // CurseForge
  const cfRoot = join(homedir(), 'curseforge', 'minecraft', 'Instances')
  for (const p of list(cfRoot)) {
    const dir = join(cfRoot, p)
    const meta = readJson(join(dir, 'minecraftinstance.json')) as { name?: string; gameVersion?: string } | null
    if (isDir(dir)) found.push(describe('curseforge', meta?.name ?? p, dir, meta?.gameVersion ?? null))
  }

  // Prism Launcher
  const prismRoot = join(ad, 'PrismLauncher', 'instances')
  for (const p of list(prismRoot)) {
    const inst = join(prismRoot, p)
    const game = [join(inst, '.minecraft'), join(inst, 'minecraft')].find(isDir)
    if (!game) continue
    const name = /^name=(.*)$/m.exec((() => { try { return readFileSync(join(inst, 'instance.cfg'), 'utf8') } catch { return '' } })())?.[1] ?? p
    const pack = readJson(join(inst, 'mmc-pack.json')) as { components?: { uid: string; version?: string }[] } | null
    found.push(describe('prism', name, game, pack?.components?.find((c) => c.uid === 'net.minecraft')?.version ?? null))
  }

  // ATLauncher
  const atRoot = join(ad, 'ATLauncher', 'instances')
  for (const p of list(atRoot)) {
    const dir = join(atRoot, p)
    const meta = readJson(join(dir, 'instance.json')) as { launcher?: { name?: string }; id?: string } | null
    if (isDir(dir)) found.push(describe('atlauncher', meta?.launcher?.name ?? p, dir, meta?.id ?? null))
  }

  // Never offer Hemisphere's own instance
  const own = gamePaths().instance.toLowerCase()
  return found.filter((s): s is ImportSource => !!s && s.path.toLowerCase() !== own)
}

/** A folder picked by the player: the game folder itself, or an instance folder containing .minecraft/minecraft. */
export function sourceFromFolder(dir: string): ImportSource | null {
  const game = [dir, join(dir, '.minecraft'), join(dir, 'minecraft')].find((d) => existsSync(join(d, 'options.txt')) || isDir(join(d, 'mods')))
  return game ? describe('folder', basename(dir), game, null) : null
}

// ------------------------------------------------------------------------------------------------- import

/** Copies a file or folder only if the destination doesn't exist yet. Returns how many top-level items were copied. */
async function copyMissing(srcDir: string, destDir: string, filter: (name: string) => boolean = () => true): Promise<number> {
  if (!isDir(srcDir)) return 0
  await mkdir(destDir, { recursive: true })
  let n = 0
  for (const name of await readdir(srcDir)) {
    if (!filter(name) || existsSync(join(destDir, name))) continue
    await cp(join(srcDir, name), join(destDir, name), { recursive: true, errorOnExist: false, force: false })
    n++
  }
  return n
}

/** Replaces a file, keeping the previous one as <file>.bak-<date>. */
async function replaceWithBackup(src: string, dest: string): Promise<boolean> {
  if (!existsSync(src)) return false
  if (existsSync(dest)) {
    const d = new Date()
    const p = (x: number) => String(x).padStart(2, '0')
    await copyFile(dest, `${dest}.bak-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}`)
  }
  await copyFile(src, dest)
  return true
}

export async function importFrom(source: ImportSource, opts: ImportOptions, manifest: ClientManifest, onProgress: (p: ImportProgress) => void): Promise<ImportReport> {
  const inst = gamePaths().instance
  await mkdir(inst, { recursive: true })
  const report: ImportReport = { settings: false, servers: false, resourcepacks: 0, shaderpacks: 0, configFiles: 0, modsAdded: [], modsIncluded: [], modsUnavailable: [], modsUnknown: [] }

  onProgress({ step: 'files', ratio: null })
  if (opts.settings) report.settings = await replaceWithBackup(join(source.path, 'options.txt'), join(inst, 'options.txt'))
  if (opts.servers) report.servers = await replaceWithBackup(join(source.path, 'servers.dat'), join(inst, 'servers.dat'))
  if (opts.resourcepacks) report.resourcepacks = await copyMissing(join(source.path, 'resourcepacks'), join(inst, 'resourcepacks'))
  if (opts.shaderpacks) report.shaderpacks = await copyMissing(join(source.path, 'shaderpacks'), join(inst, 'shaderpacks'), (n) => !n.endsWith('.txt'))
  if (opts.config) report.configFiles = await copyMissing(join(source.path, 'config'), join(inst, 'config'))

  if (opts.mods) {
    const jars = list(join(source.path, 'mods')).filter((f) => f.toLowerCase().endsWith('.jar'))
    const hashes = new Map<string, string>() // hash -> filename
    for (const [i, jar] of jars.entries()) {
      onProgress({ step: 'mods', ratio: (i / Math.max(1, jars.length)) * 0.4, detail: jar })
      hashes.set(await sha512OfFile(join(source.path, 'mods', jar)), jar)
    }
    if (hashes.size) {
      const all = [...hashes.keys()]
      const known = await versionsByHash(all)
      const shipped = new Set(manifest.mods.flatMap((m) => (m.source ? [m.source.modrinth.projectId] : [])))
      const projects = await getProjects([...new Set(Object.values(known).map((v) => v.project_id))])
      const title = (v: { project_id: string; name: string }) => projects.get(v.project_id)?.title ?? v.name
      const toUpdate: string[] = []
      for (const hash of all) {
        const v = known[hash]
        if (!v) report.modsUnknown.push(hashes.get(hash)!)
        else if (shipped.has(v.project_id)) report.modsIncluded.push(title(v))
        else toUpdate.push(hash)
      }
      const compatible = await latestByHash(toUpdate, manifest.minecraft)
      const store = join(gamePaths().root, 'store')
      for (const [i, hash] of toUpdate.entries()) {
        const old = known[hash]
        const v = compatible[hash]
        const file = v ? primaryFile(v) : undefined
        if (!v || !file) {
          report.modsUnavailable.push(title(old))
          continue
        }
        onProgress({ step: 'mods', ratio: 0.4 + (i / toUpdate.length) * 0.6, detail: title(v) })
        const dest = join(inst, 'mods', file.filename)
        if (!existsSync(dest)) {
          const blob = { url: file.url, sha512: file.hashes.sha512, size: file.size }
          await downloadToStore(store, blob, () => {}) // verified by hash, Modrinth CDN only
          await mkdir(join(inst, 'mods'), { recursive: true })
          await copyFile(blobPath(store, blob.sha512), dest) // a copy: it's the player's file, not Hemisphere's
        }
        report.modsAdded.push(title(v))
      }
    }
  }
  onProgress({ step: 'mods', ratio: 1 })
  console.log(`[import] from ${source.launcher} "${source.name}": ${report.modsAdded.length} mods added, ${report.modsUnknown.length} unknown`)
  return report
}

const modsDir = () => join(gamePaths().instance, 'mods')
const disabledDir = () => join(gamePaths().instance, 'mods-disabled')

/** Mods the player added themselves: in mods/ (enabled) but not placed by Hemisphere, or parked in mods-disabled/. */
export async function playerMods(owned: string[]): Promise<{ file: string; size: number; enabled: boolean }[]> {
  const mine = new Set(owned.map((p) => p.toLowerCase()))
  const out: { file: string; size: number; enabled: boolean }[] = []
  for (const [dir, enabled] of [[modsDir(), true], [disabledDir(), false]] as const)
    for (const f of list(dir)) {
      if (!f.toLowerCase().endsWith('.jar') || (enabled && mine.has(`mods/${f}`.toLowerCase()))) continue
      out.push({ file: f, size: (await stat(join(dir, f)).catch(() => null))?.size ?? 0, enabled })
    }
  return out.sort((a, b) => a.file.localeCompare(b.file))
}

/** Moves one player mod between mods/ and mods-disabled/ (never deletes anything). */
export async function setPlayerModEnabled(file: string, enabled: boolean, owned: string[]): Promise<boolean> {
  if (!isSafeModFileName(file)) return false
  if (owned.some((p) => p.toLowerCase() === `mods/${file}`.toLowerCase())) return false // Hemisphere's own file
  const [from, to] = enabled ? [disabledDir(), modsDir()] : [modsDir(), disabledDir()]
  if (!existsSync(join(from, file)) || existsSync(join(to, file))) return false
  await mkdir(to, { recursive: true })
  await rename(join(from, file), join(to, file))
  return true
}

/** "Launch without my mods": parks every player mod in mods-disabled/. Returns how many were moved. */
export async function disableAllPlayerMods(owned: string[]): Promise<number> {
  let n = 0
  for (const m of await playerMods(owned)) if (m.enabled && (await setPlayerModEnabled(m.file, false, owned))) n++
  return n
}
