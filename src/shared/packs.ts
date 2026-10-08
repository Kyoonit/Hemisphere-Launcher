/**
 * Phase 22: resource packs and shader packs, managed like mods in the Content page (Modrinth versions, locks, updates,
 * staff policy). Which resource packs are on (and their order) is Minecraft's own setting (options.txt); the shader in
 * use is Iris's (config/iris.properties).
 */
import type { Localized } from './manifest'
import type { ModVerdict } from './modBrowser'

export type PackType = 'resourcepack' | 'shader'
export const PACK_TYPES: PackType[] = ['resourcepack', 'shader']

export interface PackItem {
  /** file or folder name in resourcepacks/ or shaderpacks/ */
  file: string
  folder: boolean
  name: string
  description: string | null
  /** Modrinth icon, or the pack's own pack.png (data URL), or '' */
  icon: string
  size: number
  /** resource pack switched on / the shader pack in use */
  active: boolean
  /** resource packs that are on: 0 = top (wins over the others) */
  order: number | null
  /** Minecraft marked it as made for another version */
  incompatible: boolean
  projectId: string | null
  versionNumber: string | null
  update: { versionNumber: string } | null
  locked: boolean
  verdict: ModVerdict
  reason?: Localized
  addedAt: number
}

export interface PackList {
  type: PackType
  items: PackItem[]
  /** shaders: Iris settings say shaders are on */
  shadersOn: boolean
  /** shaders: Iris is installed and switched on (else the shader can't load) */
  irisReady: boolean
}

export type PackResult = { ok: true } | { ok: false; reason: 'busy' | 'notFound' | 'network' | 'locked' | 'blocked' | 'needsConfirm' | 'notCompatible' }
