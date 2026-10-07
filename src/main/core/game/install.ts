import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { MinecraftFolder, Version, diagnose } from '@xmcl/core'
import { getVersionList, installDependenciesTask, installFabric, installTask } from '@xmcl/installer'
import type { GameStage } from '@shared/game'
import { ensureJava, managedJavaPath } from './java'
import { gamePaths, type GameTarget } from './target'
import { GameError, withRetries, type ProgressFn } from './util'

/** Windows limits open files; more parallel downloads than this cause EMFILE errors (seen in the spike). */
const DOWNLOAD_OPTIONS = { assetsDownloadConcurrency: 16, librariesDownloadConcurrency: 8 }

interface InstallState {
  minecraft: string
  fabricLoader: string
  versionId: string
  javaComponent: string
  javaMajor: number
}

export interface InstalledGame {
  versionId: string
  javaPath: string
}

type StageProgress = (stage: GameStage) => ProgressFn

async function readState(): Promise<InstallState | null> {
  try {
    return JSON.parse(await readFile(gamePaths().stateFile, 'utf8')) as InstallState
  } catch {
    return null
  }
}

/**
 * Makes sure Minecraft, Fabric and Java are installed for the target from the client manifest.
 * Fast path: if the last successful install matches and its key files exist, nothing is downloaded.
 * (A full file-by-file verification is the job of Repair, Phase 10.)
 */
export interface GameRepairInfo {
  /** Minecraft/Fabric files that were missing or damaged before the repair */
  minecraftIssues: { file: string; type: 'missing' | 'corrupted' }[]
}

export async function ensureGameInstalled(
  TARGET: GameTarget,
  progress: StageProgress,
  verify = false,
  repairInfo?: GameRepairInfo,
): Promise<InstalledGame> {
  const paths = gamePaths()
  const mc = MinecraftFolder.from(paths.minecraft)
  await mkdir(paths.instance, { recursive: true })

  const state = await readState()
  if (verify && state && repairInfo) {
    // Remember what was wrong so Repair can report it (the install below fixes it).
    const report = await diagnose(state.versionId, mc).catch(() => null)
    repairInfo.minecraftIssues = report ? report.issues.map((i) => ({ file: i.file, type: i.type })) : [{ file: state.versionId, type: 'missing' }]
  }
  if (
    !verify &&
    state &&
    state.minecraft === TARGET.minecraft &&
    state.fabricLoader === TARGET.fabricLoader &&
    existsSync(mc.getVersionJar(TARGET.minecraft)) &&
    existsSync(mc.getVersionJson(state.versionId)) &&
    existsSync(managedJavaPath(state.javaComponent))
  ) {
    return { versionId: state.versionId, javaPath: managedJavaPath(state.javaComponent) }
  }

  // 1. Minecraft: version JSON, client jar, libraries, assets (from Mojang)
  const onMc = progress('minecraft')
  onMc(null)
  const list = await withRetries(() => getVersionList())
  const meta = list.versions.find((v) => v.id === TARGET.minecraft)
  if (!meta) throw new GameError('unknown', `Minecraft ${TARGET.minecraft} not found in Mojang's version list`)
  const vanilla = await withRetries(() => {
    const task = installTask(meta, mc, DOWNLOAD_OPTIONS)
    return task.startAndWait({ onUpdate: () => onMc(task.total ? task.progress / task.total : null) })
  })

  // 2. Java: the runtime Mojang specifies for this version
  const component = vanilla.javaVersion.component
  const javaPath = await withRetries(() => ensureJava(component, vanilla.javaVersion.majorVersion, progress('java'), verify))

  // 3. Fabric loader profile + its libraries
  const onFabric = progress('fabric')
  onFabric(null)
  const versionId = await withRetries(() => installFabric({ minecraftVersion: TARGET.minecraft, version: TARGET.fabricLoader, minecraft: mc }))
  const fabric = await Version.parse(mc, versionId)
  await withRetries(() => {
    const task = installDependenciesTask(fabric, DOWNLOAD_OPTIONS)
    return task.startAndWait({ onUpdate: () => onFabric(task.total ? task.progress / task.total : null) })
  })

  const newState: InstallState = {
    minecraft: TARGET.minecraft,
    fabricLoader: TARGET.fabricLoader,
    versionId,
    javaComponent: component,
    javaMajor: vanilla.javaVersion.majorVersion,
  }
  await writeFile(paths.stateFile, JSON.stringify(newState, null, 2))
  return { versionId, javaPath }
}

export const instanceLogPath = () => join(gamePaths().instance, 'logs', 'latest.log')

/** javaw.exe of the managed runtime from the last successful install, if any. */
export async function installedJavaPath(): Promise<string | null> {
  const state = await readState()
  return state ? managedJavaPath(state.javaComponent) : null
}
