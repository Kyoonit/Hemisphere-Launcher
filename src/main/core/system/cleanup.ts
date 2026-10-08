import { readFile, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { CLEANUP_CATEGORIES, type CleanupCategory, type CleanupScan } from '@shared/cleanup'
import { gamePaths } from '../game/target'
import { launcherLogDir } from '../logging/logger'
import { getContent } from '../remote/content'

/**
 * Free up space: only what the launcher or the game can do without.
 *   logs       old game logs (7+ days), the launcher's old rotated logs
 *   crashes    crash reports older than 30 days, Java's own crash files (hs_err) older than 7 days
 *   downloads  downloads that were interrupted and never finished
 *   versions   Minecraft versions Hemisphere no longer uses (not the current one, not the previous one)
 * Worlds, screenshots, mods, packs, settings and the mod store (presets reuse it) are never touched.
 */
const DAY = 24 * 60 * 60_000

async function sizeOf(path: string): Promise<number> {
  const st = await stat(path).catch(() => null)
  if (!st) return 0
  if (!st.isDirectory()) return st.size
  let total = 0
  for (const name of await readdir(path).catch(() => [] as string[])) total += await sizeOf(join(path, name))
  return total
}

async function olderThan(dir: string, days: number, match: (name: string) => boolean): Promise<string[]> {
  const out: string[] = []
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    if (!match(name)) continue
    const st = await stat(join(dir, name)).catch(() => null)
    if (st?.isFile() && Date.now() - st.mtimeMs > days * DAY) out.push(join(dir, name))
  }
  return out
}

/** Minecraft versions still needed: the installed one, its Fabric profile (exact name) and the previous client's. */
async function neededMinecraft(): Promise<string[]> {
  const keep: string[] = []
  const state = await readFile(gamePaths().stateFile, 'utf8').then((s) => JSON.parse(s) as { minecraft?: string; versionId?: string }, () => null)
  if (state?.minecraft) keep.push(state.minecraft)
  if (state?.versionId) keep.push(state.versionId)
  const content = await getContent().catch(() => null)
  if (content) keep.push(content.manifest.minecraft, ...(content.index.previous ? [content.index.previous.minecraft] : []))
  return keep
}

async function find(): Promise<Record<CleanupCategory, string[]>> {
  const p = gamePaths()
  const instance = p.instance
  const keep = await neededMinecraft()
  const versionsDir = join(p.minecraft, 'versions')
  // a version folder is "26.3", or a Fabric profile such as "26.3-fabric0.19.5" / "fabric-loader-0.19.5-26.3": kept
  // when it names a needed Minecraft version
  const versions = keep.length
    ? (await readdir(versionsDir).catch(() => [] as string[])).filter((v) => !keep.some((k) => v === k || v.startsWith(`${k}-`) || v.endsWith(`-${k}`))).map((v) => join(versionsDir, v))
    : [] // can't tell what's needed (offline, first start): keep everything
  return {
    logs: [
      ...(await olderThan(join(instance, 'logs'), 7, (n) => n !== 'latest.log' && n !== 'debug.log')),
      ...(await olderThan(launcherLogDir(), 7, (n) => n !== 'launcher.log')),
    ],
    crashes: [
      ...(await olderThan(join(instance, 'crash-reports'), 30, () => true)),
      ...(await olderThan(instance, 7, (n) => /^(hs_err|replay)_pid\d+\.log$/.test(n))),
    ],
    downloads: (await readdir(join(p.root, 'store', '.partial')).catch(() => [] as string[])).map((n) => join(p.root, 'store', '.partial', n)),
    versions,
  }
}

export async function scanCleanup(): Promise<CleanupScan> {
  const found = await find()
  const categories = {} as CleanupScan['categories']
  let totalBytes = 0
  for (const c of CLEANUP_CATEGORIES) {
    let bytes = 0
    for (const path of found[c]) bytes += await sizeOf(path)
    categories[c] = { items: found[c].length, bytes }
    totalBytes += bytes
  }
  return { categories, totalBytes }
}

/** Removes everything the scan lists (looked up again now). Returns the bytes freed. */
export async function runCleanup(): Promise<number> {
  const found = await find()
  let freed = 0
  for (const c of CLEANUP_CATEGORIES)
    for (const path of found[c]) {
      const bytes = await sizeOf(path)
      await rm(path, { recursive: true, force: true }).then(
        () => (freed += bytes),
        () => {},
      )
    }
  console.log(`[cleanup] freed ${Math.round(freed / 1024 ** 2)} MB`)
  return freed
}
