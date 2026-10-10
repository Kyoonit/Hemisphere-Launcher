/**
 * Herald catalogue (launcher 1.4, Patreon try-on): models and skins from the owner's Patreon, kept on Herald (files,
 * sheet, previews). An item can stay on Herald only (a teaser for Discord) or be shown in the launchers, where players
 * try it on and click through to its page on Patreon. Shared by the server (which checks) and the app.
 */
import type { Permission } from './heraldRoles'
import { ModelError, readModel, type ModelFile } from './models'
import { pngProblem } from './png'

export const CATALOGUE_KINDS = ['model', 'skin'] as const
export type CatalogueKind = (typeof CATALOGUE_KINDS)[number]
/** where a model is worn (skins are the whole player) */
export const CATALOGUE_SLOTS = ['head', 'righthand', 'lefthand'] as const
export type CatalogueSlot = (typeof CATALOGUE_SLOTS)[number]
/** draft: on Herald only · published: in the launchers · hidden: was published, taken out of the launchers */
export const CATALOGUE_STATUSES = ['draft', 'published', 'hidden'] as const
export type CatalogueStatus = (typeof CATALOGUE_STATUSES)[number]

/** A small correction of where a model sits, without touching its file (pixels of the player, and a factor) */
export interface CatalogueAdjust {
  x: number
  y: number
  z: number
  scale: number
}
export const NO_ADJUST: CatalogueAdjust = { x: 0, y: 0, z: 0, scale: 1 }

/** What staff write about an item */
export interface CatalogueSheet {
  kind: CatalogueKind
  name: string
  description: string
  /** where players find it (Patreon post or tier); needed before it is shown in the launchers */
  patreonUrl: string
  /** e.g. "Tier 2", free text */
  tier: string
  category: string
  slot: CatalogueSlot
  /** skins: Alex-style arms */
  slim: boolean
  adjust: CatalogueAdjust
  /** "New" badge in the launcher until this day (YYYY-MM-DD), or none */
  newUntil: string | null
}

export interface CatalogueFileInfo {
  name: string
  size: number
  sha256: string
}

export interface CatalogueVersion {
  version: number
  at: number
  by: string | null
  files: CatalogueFileInfo[]
}

export interface CatalogueItem extends CatalogueSheet {
  id: string
  status: CatalogueStatus
  /** the files in use (latest version) */
  version: number
  files: CatalogueFileInfo[]
  versions: CatalogueVersion[]
  /** picture of the item (WebP in Herald's pictures), made from the preview */
  thumbnail: string | null
  createdAt: number
  createdBy: string | null
  updatedAt: number
  updatedBy: string | null
  publishedAt: number | null
}

export const EMPTY_SHEET: CatalogueSheet = { kind: 'model', name: '', description: '', patreonUrl: '', tier: '', category: '', slot: 'head', slim: false, adjust: NO_ADJUST, newUntil: null }

export const CATALOGUE_PERMISSIONS: Permission[] = ['catalogue.write', 'catalogue.publish', 'catalogue.delete', 'catalogue.export']
export const seesCatalogue = (permissions: readonly string[]) => CATALOGUE_PERMISSIONS.some((p) => permissions.includes(p))

export const MAX_FILE_BYTES = 4 * 1024 * 1024
export const MAX_FILES_BYTES = 8 * 1024 * 1024
export const MAX_FILES = 32

const clampNum = (v: unknown, min: number, max: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d)
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/** A sheet from what the app sends, cleaned (unknown values replaced, texts cut) */
export function cleanSheet(v: Record<string, unknown>, base: CatalogueSheet = EMPTY_SHEET): CatalogueSheet {
  const a = (v.adjust && typeof v.adjust === 'object' ? v.adjust : {}) as Record<string, unknown>
  const pick = <T extends string>(list: readonly T[], x: unknown, d: T) => (list.includes(x as T) ? (x as T) : d)
  return {
    kind: pick(CATALOGUE_KINDS, v.kind, base.kind),
    name: v.name === undefined ? base.name : text(v.name, 60),
    description: v.description === undefined ? base.description : text(v.description, 1000),
    patreonUrl: v.patreonUrl === undefined ? base.patreonUrl : text(v.patreonUrl, 300),
    tier: v.tier === undefined ? base.tier : text(v.tier, 40),
    category: v.category === undefined ? base.category : text(v.category, 40),
    slot: pick(CATALOGUE_SLOTS, v.slot, base.slot),
    slim: typeof v.slim === 'boolean' ? v.slim : base.slim,
    adjust:
      v.adjust === undefined
        ? base.adjust
        : { x: clampNum(a.x, -16, 16, 0), y: clampNum(a.y, -16, 16, 0), z: clampNum(a.z, -16, 16, 0), scale: clampNum(a.scale, 0.25, 4, 1) },
    newUntil: v.newUntil === undefined ? base.newUntil : typeof v.newUntil === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.newUntil) ? v.newUntil : null,
  }
}

/** A link players may open: https only, no credentials in it */
export function safeLink(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && !u.username && !u.password && u.hostname.includes('.')
  } catch {
    return false
  }
}

/** What stops an item from being saved (always) or shown in the launchers (`publishing`) */
export function sheetProblems(s: CatalogueSheet, publishing = false, hasFiles = true): string[] {
  const out: string[] = []
  if (!s.name) out.push('Give it a name.')
  if (s.patreonUrl && !safeLink(s.patreonUrl)) out.push('The Patreon link must be an https:// address.')
  if (publishing) {
    if (!s.patreonUrl) out.push('Add the link to its Patreon page before showing it in the launchers.')
    if (!hasFiles) out.push('Add its files first.')
  }
  return out
}

/** File names allowed in an item: models, their textures, a skin */
export const allowedFileName = (name: string) => /^[\w\-. ()]{1,80}\.(bbmodel|json|png)$/i.test(name) && !name.startsWith('.')

/** PNG width and height from its header, or null */
export function pngHeaderSize(b: Uint8Array): { width: number; height: number } | null {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (b.length < 24 || sig.some((x, i) => b[i] !== x) || String.fromCharCode(b[12], b[13], b[14], b[15]) !== 'IHDR') return null
  const u32 = (o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0
  return { width: u32(16), height: u32(20) }
}

const utf8 = (b: Uint8Array) => new TextDecoder().decode(b)
const dataUrl = (b: Uint8Array) => {
  let s = ''
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
  return `data:image/png;base64,${btoa(s)}`
}

/** Raw files → what the model reader takes (PNG as data: URLs with their size) */
export function toModelFiles(files: { name: string; bytes: Uint8Array }[]): ModelFile[] {
  return files.map((f) => {
    if (!/\.png$/i.test(f.name)) return { name: f.name, content: utf8(f.bytes) }
    const size = pngHeaderSize(f.bytes)
    return { name: f.name, content: dataUrl(f.bytes), ...(size ?? {}) }
  })
}

/**
 * Checks an item's files before they are kept: names, sizes, PNGs, and that they read as what the item is
 * (a skin: one PNG of 64×64 or 64×32; a model: a .bbmodel, or a .json with its PNGs). Returns the problem, or null.
 */
export function filesProblem(kind: CatalogueKind, files: { name: string; bytes: Uint8Array }[]): string | null {
  if (!files.length) return 'No files.'
  if (files.length > MAX_FILES) return `${MAX_FILES} files at most.`
  let total = 0
  const names = new Set<string>()
  for (const f of files) {
    if (!allowedFileName(f.name)) return `“${f.name}”: only .bbmodel, .json and .png files.`
    if (names.has(f.name.toLowerCase())) return `“${f.name}” is there twice.`
    names.add(f.name.toLowerCase())
    if (!f.bytes.length) return `“${f.name}” is empty.`
    if (f.bytes.length > MAX_FILE_BYTES) return `“${f.name}” is too big (4 MB at most).`
    total += f.bytes.length
    if (/\.png$/i.test(f.name)) {
      const s = pngHeaderSize(f.bytes)
      if (!s || s.width > 4096 || s.height > 4096) return `“${f.name}” is not a PNG picture.`
      // the launchers get textures marked for each player: Herald must be able to read their pixels
      const problem = pngProblem(f.bytes)
      if (problem) return `“${f.name}” is ${problem}.`
    }
  }
  if (total > MAX_FILES_BYTES) return 'These files are too big together (8 MB at most).'
  if (kind === 'skin') {
    const s = files.length === 1 && /\.png$/i.test(files[0].name) ? pngHeaderSize(files[0].bytes) : null
    return s && s.width === 64 && (s.height === 64 || s.height === 32) ? null : 'A skin is one PNG of 64×64 (or 64×32) pixels.'
  }
  try {
    // textures inside a Blockbench project too
    for (const t of readModel(toModelFiles(files)).textures) {
      const problem = pngProblem(Uint8Array.from(atob(t.src.slice(t.src.indexOf(',') + 1)), (c) => c.charCodeAt(0)))
      if (problem) return `The texture “${t.name}” is ${problem}.`
    }
    return null
  } catch (err) {
    return err instanceof ModelError ? `The model can’t be read: ${err.message}.` : 'The model can’t be read.'
  }
}
