import { app } from 'electron'
import { z } from 'zod'
import { isSafeRelativePath } from '@shared/manifest'
import { MODRINTH_ID } from '@shared/modBrowser'

/**
 * Small Modrinth API client (https://docs.modrinth.com/api/). Everything that comes back is validated: file names
 * become files in mods/, hashes become store paths, URLs must be on Modrinth's CDN.
 */
const API = 'https://api.modrinth.com/v2'
const headers = () => ({ 'User-Agent': `Kyoonit/Hemisphere-Launcher/${app.getVersion()} (hemispheresurvival.club)` })

/** A plain .jar file name that is safe to create in mods/ (no folders, reserved names or odd characters). */
export const isSafeModFileName = (f: string) => /\.jar$/i.test(f) && !f.startsWith('.') && !f.includes('/') && isSafeRelativePath(`mods/${f}`)

const modrinthCdn = (u: string) => {
  try {
    const url = new URL(u)
    return url.protocol === 'https:' && url.hostname === 'cdn.modrinth.com'
  } catch {
    return false
  }
}

export const VersionSchema = z.object({
  id: z.string().regex(MODRINTH_ID),
  project_id: z.string().regex(MODRINTH_ID),
  name: z.string(),
  version_number: z.string().max(100),
  version_type: z.enum(['release', 'beta', 'alpha']).catch('alpha'),
  date_published: z.string(),
  game_versions: z.array(z.string()).catch([]),
  loaders: z.array(z.string()).catch([]),
  dependencies: z
    .array(
      z.object({
        project_id: z.string().regex(MODRINTH_ID).nullable().catch(null),
        dependency_type: z.string(),
      }),
    )
    .catch([]),
  files: z.array(
    z.object({
      url: z.string().refine(modrinthCdn, 'not on cdn.modrinth.com'),
      filename: z.string().refine((n) => isSafeModFileName(n), 'unsafe file name'),
      primary: z.boolean(),
      size: z.number().int().positive().max(512 * 1024 * 1024),
      hashes: z.object({ sha512: z.string().regex(/^[0-9a-f]{128}$/) }),
    }),
  ),
})
export type ModrinthVersion = z.infer<typeof VersionSchema>

const ProjectSchema = z.object({
  id: z.string().regex(MODRINTH_ID),
  slug: z.string(),
  title: z.string(),
  icon_url: z.string().nullable().catch(null),
})
export type ModrinthProject = z.infer<typeof ProjectSchema>

const SearchSchema = z.object({
  hits: z.array(
    z.object({
      project_id: z.string().regex(MODRINTH_ID),
      slug: z.string(),
      title: z.string(),
      description: z.string().catch(''),
      author: z.string().catch(''),
      icon_url: z.string().nullable().catch(null),
      downloads: z.number().catch(0),
    }),
  ),
  offset: z.number(),
  total_hits: z.number(),
})

async function get(path: string, timeoutMs = 15_000): Promise<unknown> {
  const res = await fetch(`${API}${path}`, { headers: headers(), signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new Error(`Modrinth ${path.split('?')[0]}: HTTP ${res.status}`)
  return res.json()
}

async function post(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`Modrinth ${path}: HTTP ${res.status}`)
  return res.json()
}

/** Only an icon on Modrinth's CDN is passed to the interface. */
export const safeIcon = (url: string | null | undefined) => (url && modrinthCdn(url) ? url : '')

/** Fabric mods for one Minecraft version. Empty query = most downloaded. exclude = project ids left out. */
export async function searchMods(query: string, minecraft: string, offset: number, exclude: string[] = [], limit = 20) {
  const facets = JSON.stringify([['project_type:mod'], ['categories:fabric'], [`versions:${minecraft}`], ...exclude.map((id) => [`project_id!=${id}`])])
  const params = new URLSearchParams({ query: query.slice(0, 100), facets, offset: String(offset), limit: String(limit), index: query.trim() ? 'relevance' : 'downloads' })
  return SearchSchema.parse(await get(`/search?${params}`))
}

/** Versions of a project for Fabric + this Minecraft version, newest first (as Modrinth returns them). */
export async function projectVersions(projectId: string, minecraft: string): Promise<ModrinthVersion[]> {
  const params = new URLSearchParams({ loaders: JSON.stringify(['fabric']), game_versions: JSON.stringify([minecraft]) })
  const raw = await get(`/project/${encodeURIComponent(projectId)}/version?${params}`)
  // one broken version (odd file name…) must not hide the others
  return z.array(z.unknown()).parse(raw).flatMap((v) => {
    const r = VersionSchema.safeParse(v)
    return r.success ? [r.data] : []
  })
}

/** Project details for up to 100 ids (titles, icons). Never throws: missing info just stays missing. */
export async function getProjects(ids: string[]): Promise<Map<string, ModrinthProject>> {
  const out = new Map<string, ModrinthProject>()
  for (let i = 0; i < ids.length; i += 100) {
    try {
      const chunk = ids.slice(i, i + 100)
      const list = z.array(z.unknown()).parse(await get(`/projects?ids=${encodeURIComponent(JSON.stringify(chunk))}`))
      for (const p of list) {
        const r = ProjectSchema.safeParse(p)
        if (r.success) out.set(r.data.id, r.data)
      }
    } catch {
      /* titles/icons are cosmetic */
    }
  }
  return out
}

const parseVersionMap = (raw: unknown): Record<string, ModrinthVersion> => {
  const out: Record<string, ModrinthVersion> = {}
  for (const [k, v] of Object.entries(z.record(z.string(), z.unknown()).parse(raw))) {
    const r = VersionSchema.safeParse(v)
    if (r.success) out[k] = r.data
  }
  return out
}

/** sha512 -> the Modrinth version that file belongs to (unknown files are missing from the result). */
export async function versionsByHash(hashes: string[]): Promise<Record<string, ModrinthVersion>> {
  if (!hashes.length) return {}
  return parseVersionMap(await post('/version_files', { hashes, algorithm: 'sha512' }))
}

/** sha512 -> newest Fabric version of the same project for this Minecraft version (missing = none exists). */
export async function latestByHash(hashes: string[], minecraft: string): Promise<Record<string, ModrinthVersion>> {
  if (!hashes.length) return {}
  return parseVersionMap(await post('/version_files/update', { hashes, algorithm: 'sha512', loaders: ['fabric'], game_versions: [minecraft] }))
}

/** Best version to install: newest release, else newest beta, else newest alpha. */
export function pickVersion(versions: ModrinthVersion[]): ModrinthVersion | null {
  const byDate = [...versions].sort((a, b) => b.date_published.localeCompare(a.date_published))
  for (const type of ['release', 'beta', 'alpha'] as const) {
    const v = byDate.find((x) => x.version_type === type && x.files.length)
    if (v) return v
  }
  return null
}

/** The file to download for a version: the primary one, else the first. */
export const primaryFile = (v: ModrinthVersion) => v.files.find((f) => f.primary) ?? v.files[0]

/**
 * The version an update should go to. Modrinth's "latest" can be an alpha or beta: then the newest stable release is
 * used instead (betas/alphas only when the mod has no release at all), and never anything older than the current one.
 * null = nothing to update.
 */
export async function updateTarget(projectId: string, currentVersionId: string, latest: ModrinthVersion, minecraft: string): Promise<ModrinthVersion | null> {
  if (latest.project_id !== projectId) return null
  if (latest.version_type === 'release') return latest.id === currentVersionId ? null : latest
  const all = await projectVersions(projectId, minecraft)
  const best = pickVersion(all)
  if (!best || best.id === currentVersionId) return null
  const current = all.find((v) => v.id === currentVersionId)
  if (current && best.date_published <= current.date_published) return null // would be a downgrade
  return best
}
