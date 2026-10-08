import { app } from 'electron'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, link, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { MinecraftFolder } from '@xmcl/core'
import { savedReused } from '../system/network'
import { fetchJson } from './util'

/**
 * Minecraft's assets (sounds, languages, textures: about 1 GB) are the same files for every launcher, named by their
 * hash. When another launcher on this PC already has them, they're linked (or copied) instead of downloaded again.
 * Nothing is trusted blindly: a file is only taken when its size matches the official index, and the installer
 * checks every file's hash afterwards (a wrong one is downloaded as usual).
 */

/** Asset folders of the official launcher, Prism, the Modrinth App and CurseForge, when they exist. */
function otherAssetDirs(): string[] {
  const roaming = app.getPath('appData')
  return [
    join(roaming, '.minecraft', 'assets'),
    join(roaming, 'PrismLauncher', 'assets'),
    join(roaming, 'ModrinthApp', 'meta', 'assets'),
    join(app.getPath('home'), 'curseforge', 'minecraft', 'Install', 'assets'),
  ].filter((d) => existsSync(join(d, 'objects')))
}

const sha1 = (s: string | Buffer) => createHash('sha1').update(s).digest('hex')

/** The asset index for this version: ours, another launcher's, or downloaded; only if its SHA-1 matches Mojang's. */
async function assetIndex(id: string, url: string, expected: string, mc: MinecraftFolder, sources: string[]): Promise<string | null> {
  for (const path of [mc.getAssetsIndex(id), ...sources.map((s) => join(s, 'indexes', `${id}.json`))]) {
    const raw = await readFile(path).catch(() => null)
    if (raw && sha1(raw) === expected) return raw.toString('utf8')
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!res.ok) return null
  const raw = Buffer.from(await res.arrayBuffer())
  return sha1(raw) === expected ? raw.toString('utf8') : null
}

export async function reuseAssets(versionJsonUrl: string, mc: MinecraftFolder): Promise<void> {
  const sources = otherAssetDirs()
  if (!sources.length) return
  const version = await fetchJson<{ assetIndex?: { id: string; url: string; sha1: string } }>(versionJsonUrl)
  const ai = version.assetIndex
  if (!ai) return
  const raw = await assetIndex(ai.id, ai.url, ai.sha1, mc, sources)
  if (!raw) return
  // our copy of the index, so the installer doesn't download it again
  await mkdir(dirname(mc.getAssetsIndex(ai.id)), { recursive: true })
  if (!existsSync(mc.getAssetsIndex(ai.id))) await writeFile(mc.getAssetsIndex(ai.id), raw)

  const objects = [...new Map(Object.values((JSON.parse(raw) as { objects: Record<string, { hash: string; size: number }> }).objects).map((o) => [o.hash, o])).values()]
  let files = 0
  let bytes = 0
  const one = async ({ hash, size }: { hash: string; size: number }) => {
    const dest = mc.getAsset(hash)
    if (existsSync(dest)) return
    for (const src of sources) {
      const from = join(src, 'objects', hash.slice(0, 2), hash)
      const st = await stat(from).catch(() => null)
      if (!st || st.size !== size) continue
      await mkdir(dirname(dest), { recursive: true })
      // a hard link costs no disk space (same drive); otherwise a copy
      await link(from, dest).catch(() => copyFile(from, dest))
      files++
      bytes += size
      return
    }
  }
  for (let i = 0; i < objects.length; i += 32) await Promise.all(objects.slice(i, i + 32).map((o) => one(o).catch(() => {})))
  if (files) {
    savedReused(files, bytes)
    console.log(`[install] ${files} Minecraft assets (${Math.round(bytes / 1024 ** 2)} MB) taken from another launcher on this PC instead of downloading them`)
  }
}
