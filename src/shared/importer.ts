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

/** Where imported mods and packs go: a new preset (named after the setup by default), or the active one, replaced */
export type ImportPreset = { mode: 'new'; name: string } | { mode: 'replace' }

export interface ImportOptions {
  settings: boolean
  servers: boolean
  resourcepacks: boolean
  shaderpacks: boolean
  config: boolean
  mods: boolean
  /** used when mods or packs are imported */
  preset?: ImportPreset
  /** name for the mods as they are now when no preset is active yet ("My mods") */
  fallbackName?: string
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
  /** the preset the mods and packs went into (now the active one); null when only settings were imported */
  preset: { name: string; created: boolean } | null
}

export interface ImportProgress {
  step: 'files' | 'mods'
  ratio: number | null
  detail?: string
}
