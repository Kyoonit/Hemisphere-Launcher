/**
 * Phase 21: mod sets (named mod lists to switch between, shareable as a code) and the mod history (everyday changes,
 * with undo; restore points are kept for the big ones).
 */

export interface ModSetInfo {
  id: string
  name: string
  /** the player's own mods in the set (and Hemisphere mods they took over) */
  mods: number
  enabled: number
  /** resource packs on; null = saved before packs (switching leaves packs as they are) */
  packs: number | null
  /** shader in use ('' = none); null = saved before packs */
  shader: string | null
  updatedAt: number
}

export interface ModSetsState {
  sets: ModSetInfo[]
  /** the set the mods are on now; null = none */
  active: string | null
}

export type SetSwitchResult = { ok: true; missing: string[]; savedAs: string | null } | { ok: false; reason: 'busy' | 'notFound' | 'failed' }
export type SetShareResult = { ok: true; code: string; left: string[] } | { ok: false; reason: 'notFound' | 'empty' }
export type SetImportResult =
  | { ok: true; id: string; name: string; mods: number; skipped: { name: string; reason: 'blocked' | 'notAvailable' | 'download' }[] }
  | { ok: false; reason: 'invalid' | 'failed' | 'busy' }

export const SET_NAME_MAX = 40
export const MAX_SETS = 20

/** One everyday change to the mods. */
export interface ModHistoryEntry {
  id: string
  at: number
  kind: 'version' | 'update' | 'install' | 'remove' | 'lock' | 'unlock' | 'backToHemisphere' | 'setSwitch' | 'setImport'
  /** mod, pack or preset name */
  name: string
  /** what changed: a mod (also when missing, from before packs), a resource pack or a shader pack */
  type?: 'mod' | 'resourcepack' | 'shader'
  projectId: string | null
  from: string | null
  to: string | null
  fromVersionId: string | null
  toVersionId: string | null
}

/** With whether it can still be undone (the mod is still exactly as this change left it). */
export interface ModHistoryItem extends ModHistoryEntry {
  undo: boolean
}

export type UndoResult = { ok: true } | { ok: false; reason: 'busy' | 'notPossible' | 'locked' | 'network' }

export const MAX_HISTORY = 200
