/** Import from another launcher: shared types. */

export type LauncherKind = 'official' | 'modrinth' | 'curseforge' | 'prism' | 'atlauncher' | 'folder'

export interface ImportSource {
  /** stable id for the UI (the game folder path) */
  id: string
  launcher: LauncherKind
  name: string
  /** the instance's game folder (where options.txt, mods/, … live) */
  path: string
  minecraft: string | null
  has: {
    settings: boolean
    servers: boolean
    resourcepacks: number
    shaderpacks: number
    config: boolean
    mods: number
  }
}

export interface ImportOptions {
  settings: boolean
  servers: boolean
  resourcepacks: boolean
  shaderpacks: boolean
  config: boolean
  mods: boolean
}

export interface ImportReport {
  settings: boolean
  servers: boolean
  resourcepacks: number
  shaderpacks: number
  configFiles: number
  /** player mods: compatible version installed */
  modsAdded: string[]
  /** already part of the Hemisphere client */
  modsIncluded: string[]
  /** on Modrinth but no version for this Minecraft version yet */
  modsUnavailable: string[]
  /** not found on Modrinth: not copied (can't check compatibility or safety) */
  modsUnknown: string[]
}

export interface ImportProgress {
  step: 'files' | 'mods'
  ratio: number | null
  detail?: string
}
