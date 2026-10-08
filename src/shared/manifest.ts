/**
 * Hemisphere client content format (schema 1). Shared by the launcher and the staff publish tool.
 *
 *   content/index.json            signed (index.json.sig, Ed25519): points to the latest + previous client manifests
 *   content/clients/<v>/manifest.json   integrity guaranteed by the sha512 recorded in the signed index
 *
 * Manifests are DATA ONLY: files to download (with hashes) and where to put them. Never commands.
 */
import { z } from 'zod'

export const CONTENT_SCHEMA = 1

/** Where the launcher reads content from (GitHub, same repository). */
export const CONTENT_BASE = 'https://raw.githubusercontent.com/Kyoonit/Hemisphere-Launcher/main/content/'

/** Top-level folders of the game directory that content may write to. */
export const ALLOWED_ROOTS = ['mods', 'config', 'resourcepacks', 'shaderpacks'] as const

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i

/** A relative, forward-slash path that cannot escape the game folder. */
export function isSafeRelativePath(path: string): boolean {
  if (path.length === 0 || path.length > 200) return false
  if (/[\\:*?"<>|\u0000-\u001f]/.test(path)) return false // backslashes, drive letters, ADS, wildcards, control chars
  if (path.startsWith('/')) return false
  const parts = path.split('/')
  if (!(ALLOWED_ROOTS as readonly string[]).includes(parts[0]) || parts.length < 2) return false
  return parts.every((p) => p !== '' && p !== '.' && p !== '..' && !p.endsWith('.') && !p.endsWith(' ') && !WINDOWS_RESERVED.test(p))
}

/** Downloads may only come from Modrinth's CDN or our own content folder. */
export function isAllowedDownloadUrl(url: string, contentBase = CONTENT_BASE): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return false
  if (u.hostname === 'cdn.modrinth.com') return true
  return url.startsWith(contentBase) && !u.pathname.includes('/../')
}

const sha512 = z.string().regex(/^[0-9a-f]{128}$/, 'sha512 must be 128 lowercase hex chars')
const semver = z.string().regex(/^\d+\.\d+\.\d+$/, 'version must look like 1.2.3')
const slug = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/)

export const LocalizedSchema = z.object({ en: z.string().min(1) }).catchall(z.string())
export type Localized = z.infer<typeof LocalizedSchema>

export const FileRefSchema = z.object({
  path: z.string().refine(isSafeRelativePath, 'unsafe path'),
  url: z.string().refine((u) => isAllowedDownloadUrl(u), 'download host not allowed'),
  sha512,
  size: z.number().int().nonnegative().max(512 * 1024 * 1024),
})
export type FileRef = z.infer<typeof FileRefSchema>

export const MOD_CATEGORIES = ['performance', 'voice', 'visual', 'comfort', 'library'] as const

export const ModEntrySchema = z.object({
  id: slug,
  name: z.string().min(1).max(64),
  description: LocalizedSchema,
  category: z.enum(MOD_CATEGORIES),
  /** Shown with a "Recommended" badge; turning it off shows a warning */
  recommended: z.boolean(),
  /** Enabled for new players */
  defaultEnabled: z.boolean(),
  /** ids of other entries this mod needs */
  requires: z.array(slug),
  version: z.string().min(1).max(64),
  file: FileRefSchema.refine((f) => f.path.startsWith('mods/') && f.path.endsWith('.jar'), 'mods must be mods/*.jar'),
  source: z.object({ modrinth: z.object({ projectId: z.string(), versionId: z.string() }) }).optional(),
})
export type ModEntry = z.infer<typeof ModEntrySchema>

export const ExtraFileSchema = FileRefSchema.extend({
  /** enforced = always reset to this content; default = copied once, then the player owns it */
  policy: z.enum(['enforced', 'default']),
}).refine((f) => !f.path.startsWith('mods/'), 'mods go in "mods", not "files"')
export type ExtraFile = z.infer<typeof ExtraFileSchema>

export const ClientManifestSchema = z
  .object({
    schema: z.literal(CONTENT_SCHEMA),
    clientVersion: semver,
    createdAt: z.string().datetime(),
    minecraft: z.string().regex(/^[0-9][0-9a-z.\-]{0,31}$/),
    loader: z.object({ type: z.literal('fabric'), version: z.string().regex(/^[0-9][0-9a-z.+\-]{0,31}$/) }),
    mods: z.array(ModEntrySchema).max(300),
    files: z.array(ExtraFileSchema).max(1000),
    /** "What's new" lines shown once after this client is installed (optional; older launchers ignore it) */
    changelog: z.array(LocalizedSchema).max(30).optional(),
  })
  .superRefine((m, ctx) => {
    const ids = new Set<string>()
    const paths = new Set<string>()
    for (const mod of m.mods) {
      if (ids.has(mod.id)) ctx.addIssue({ code: 'custom', message: `duplicate mod id ${mod.id}` })
      ids.add(mod.id)
    }
    for (const p of [...m.mods.map((x) => x.file.path), ...m.files.map((x) => x.path)]) {
      const key = p.toLowerCase() // Windows paths are case-insensitive
      if (paths.has(key)) ctx.addIssue({ code: 'custom', message: `duplicate path ${p}` })
      paths.add(key)
    }
    for (const mod of m.mods)
      for (const dep of mod.requires)
        if (!ids.has(dep)) ctx.addIssue({ code: 'custom', message: `${mod.id} requires unknown mod ${dep}` })
  })
export type ClientManifest = z.infer<typeof ClientManifestSchema>

export const ClientRefSchema = z.object({
  clientVersion: semver,
  minecraft: z.string(),
  /** relative to CONTENT_BASE */
  manifest: z.string().regex(/^clients\/\d+\.\d+\.\d+\/manifest\.json$/),
  sha512,
  size: z.number().int().positive().max(5 * 1024 * 1024),
})
export type ClientRef = z.infer<typeof ClientRefSchema>

export const ContentIndexSchema = z.object({
  schema: z.literal(CONTENT_SCHEMA),
  /** Increases on every publish; the launcher refuses to go back to an older index (replay protection) */
  sequence: z.number().int().positive(),
  updatedAt: z.string().datetime(),
  latest: ClientRefSchema,
  previous: ClientRefSchema.nullable(),
  /** Whether players still on `previous` can join the server (staff switch) */
  previousCanJoin: z.boolean(),
})
export type ContentIndex = z.infer<typeof ContentIndexSchema>

/** Picks the text for the player's language, falling back to English. */
export const localize = (text: Localized, lang: string) => text[lang] ?? text.en
