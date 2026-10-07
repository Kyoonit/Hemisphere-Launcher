import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { installJavaRuntimeTask, resolveJava, scanLocalJava, type JavaRuntimeManifest } from '@xmcl/installer'
import type { JavaRuntimeInfo } from '@shared/game'
import { gamePaths } from './target'
import { GameError, fetchJson, type ProgressFn } from './util'

/**
 * Java management. Players never install Java themselves: we download the exact runtime Mojang ships for the
 * Minecraft version (the "component" in the version JSON, e.g. java-runtime-epsilon = Java 25).
 */

const MOJANG_RUNTIMES = 'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json'
const PLATFORM = 'windows-x64'

interface RuntimeIndexEntry {
  manifest: { url: string; sha1: string; size: number }
  version: { name: string; released: string }
}

export function managedJavaPath(component: string): string {
  return join(gamePaths().runtime, component, 'bin', 'javaw.exe')
}

/** Checks a Java executable by running it; returns null if missing or broken. */
export async function inspectJava(path: string, managed: boolean): Promise<JavaRuntimeInfo | null> {
  if (!existsSync(path)) return null
  // resolveJava runs `java -version`; it needs java.exe (console) rather than javaw.exe
  const info = await resolveJava(path.replace(/javaw\.exe$/i, 'java.exe')).catch(() => undefined)
  return info ? { path, version: info.version, majorVersion: info.majorVersion, managed } : null
}

/** Ensures Mojang's runtime for `component` is installed and working. Returns javaw.exe. */
export async function ensureJava(component: string, requiredMajor: number, onProgress: ProgressFn, verifyFiles = false): Promise<string> {
  const path = managedJavaPath(component)
  const existing = await inspectJava(path, true)
  // verifyFiles (Repair): run the install anyway; it re-checks every runtime file's checksum and fixes bad ones.
  if (!verifyFiles && existing && existing.majorVersion >= requiredMajor) return path

  // xmcl's own manifest fetch is broken with undici 7 (see docs/ARCHITECTURE.md), so we fetch the index ourselves.
  const index = await fetchJson<Record<string, Record<string, RuntimeIndexEntry[]>>>(MOJANG_RUNTIMES)
  const entry = index[PLATFORM]?.[component]?.[0]
  if (!entry) throw new GameError('java', `no Mojang runtime "${component}" for ${PLATFORM}`)
  const files = (await fetchJson<{ files: JavaRuntimeManifest['files'] }>(entry.manifest.url)).files
  const manifest: JavaRuntimeManifest = { target: component, version: entry.version, files }

  const task = installJavaRuntimeTask({ manifest, destination: join(gamePaths().runtime, component) })
  await task.startAndWait({ onUpdate: () => onProgress(task.total ? task.progress / task.total : null) })

  const installed = await inspectJava(path, true)
  if (!installed) throw new GameError('java', 'runtime installed but does not start')
  return path
}

/** Other Java installations on this PC (JAVA_HOME, PATH, common folders) — for Advanced settings. */
export async function detectSystemJava(): Promise<JavaRuntimeInfo[]> {
  const found = await scanLocalJava([]).catch(() => [])
  return found.map((j) => ({ path: j.path, version: j.version, majorVersion: j.majorVersion, managed: false }))
}
