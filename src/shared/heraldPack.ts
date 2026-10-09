/**
 * The mod pack in Herald (phase S10). The pack keeps its format (src/shared/manifest.ts): Herald builds the next client
 * manifest on the staff PC from Modrinth, the server keeps it as a PROPOSAL, ANOTHER member with `pack.approve`
 * approves it, then the publisher (GitHub Actions) checks every mod against Modrinth again and writes
 * clients/<v>/manifest.json, its config files and the signed index.json next to the Herald feed.
 *
 * Modrinth is reached through `get` (JSON of an API path): the Herald app gives its fetch, tests a fake.
 */
import { z } from 'zod'
import { MOD_CATEGORIES, type ClientManifest, type ExtraFile, type Localized, type ModEntry } from './manifest.ts'

export const MODRINTH_API = 'https://api.modrinth.com/v2'

export interface MrFile { url: string; filename: string; primary: boolean; size: number; hashes: { sha512: string } }
export interface MrVersion {
  id: string
  project_id: string
  name?: string
  version_number: string
  version_type: 'release' | 'beta' | 'alpha'
  date_published?: string
  game_versions: string[]
  loaders: string[]
  files: MrFile[]
  dependencies: { project_id: string | null; version_id: string | null; dependency_type: string }[]
}
export interface MrProject { id: string; slug: string; title: string; description: string; icon_url?: string | null }
export interface MrHit { project_id: string; slug: string; title: string; description: string; icon_url?: string | null; downloads: number; author?: string }

/** JSON of a Modrinth API path ("/project/sodium") */
export type ModrinthGet = <T>(path: string) => Promise<T>

/** A fetch-based getter (retries when Modrinth asks to slow down). */
export function modrinthGetter(userAgent: string, fetchImpl: typeof fetch = fetch): ModrinthGet {
  return async <T>(path: string): Promise<T> => {
    for (let attempt = 1; ; attempt++) {
      const res = await fetchImpl(`${MODRINTH_API}${path}`, { headers: { 'User-Agent': userAgent }, signal: AbortSignal.timeout(20_000) })
      if (res.ok) return (await res.json()) as T
      if (res.status === 429 && attempt < 5) {
        await new Promise((r) => setTimeout(r, 1000 * attempt))
        continue
      }
      throw new Error(`Modrinth ${path.split('?')[0]}: HTTP ${res.status}`)
    }
  }
}

const ids = (list: string[]) => encodeURIComponent(JSON.stringify(list))

/** Fabric versions of a project for one Minecraft version, newest first. */
export const compatibleVersions = (get: ModrinthGet, projectId: string, minecraft: string) =>
  get<MrVersion[]>(`/project/${projectId}/version?game_versions=${ids([minecraft])}&loaders=${ids(['fabric'])}`)

/** The newest release (a beta only when there is no release and betas are accepted). */
export const pickVersion = (versions: MrVersion[], allowBeta = false) => versions.find((v) => v.version_type === 'release') ?? (allowBeta ? versions.find((v) => v.version_type === 'beta') : undefined)

export function modFile(v: MrVersion, name: string): ModEntry['file'] {
  const f = v.files.find((x) => x.primary) ?? v.files[0]
  if (!f) throw new Error(`${name}: version ${v.version_number} has no file`)
  return { path: `mods/${f.filename}`, url: f.url, sha512: f.hashes.sha512, size: f.size }
}

/** Mods search for the editor: Fabric mods that have a version for this Minecraft. */
export const searchMods = (get: ModrinthGet, query: string, minecraft: string) =>
  get<{ hits: MrHit[] }>(`/search?query=${encodeURIComponent(query)}&limit=20&facets=${encodeURIComponent(JSON.stringify([['project_type:mod'], ['categories:fabric'], [`versions:${minecraft}`]]))}`).then((r) => r.hits)

// ------------------------------------------------------------------------------------------------ the editor's draft

/** One mod as the staff chose it: a Modrinth version + how the launcher shows it. */
export interface DraftMod {
  projectId: string
  versionId: string
  category: ModEntry['category']
  recommended: boolean
  defaultEnabled: boolean
  description: Localized
}

export const draftMods = (m: ClientManifest): DraftMod[] =>
  m.mods.flatMap((x) => (x.source ? [{ projectId: x.source.modrinth.projectId, versionId: x.source.modrinth.versionId, category: x.category, recommended: x.recommended, defaultEnabled: x.defaultEnabled, description: x.description }] : []))

export interface Resolved {
  mods: ModEntry[]
  /** Libraries added because a mod needs them */
  added: string[]
  /** Blocking: the pack cannot be proposed */
  problems: string[]
  /** Worth a look (betas, libraries nothing needs any more) */
  warnings: string[]
  /** Libraries no mod needs any more (ids) */
  unused: string[]
}

/**
 * The pack's mods from the staff's choices: each pinned version read again from Modrinth (file, hash, size), the
 * libraries they need added (newest compatible release), conflicts found.
 */
export async function resolvePack(get: ModrinthGet, minecraft: string, chosen: DraftMod[]): Promise<Resolved> {
  const problems: string[] = []
  const warnings: string[] = []
  const added: string[] = []
  const seen = new Set<string>()
  const list = chosen.filter((c) => (seen.has(c.projectId) ? false : (seen.add(c.projectId), true)))
  const versions = new Map<string, MrVersion>()
  const projects = new Map<string, MrProject>()
  if (list.length) for (const v of await get<MrVersion[]>(`/versions?ids=${ids(list.map((c) => c.versionId))}`)) versions.set(v.id, v)
  const loadProjects = async (pids: string[]) => {
    const missing = pids.filter((p) => !projects.has(p))
    if (missing.length) for (const p of await get<MrProject[]>(`/projects?ids=${ids(missing)}`)) projects.set(p.id, p)
  }
  await loadProjects(list.map((c) => c.projectId))

  const entries = new Map<string, { entry: ModEntry; version: MrVersion }>()
  const make = (p: MrProject, v: MrVersion, meta: Omit<DraftMod, 'projectId' | 'versionId'>): ModEntry => ({
    id: p.slug,
    name: p.title.slice(0, 64),
    description: meta.description,
    category: meta.category,
    recommended: meta.recommended,
    defaultEnabled: meta.defaultEnabled,
    requires: [],
    version: v.version_number.slice(0, 64),
    file: modFile(v, p.title),
    source: { modrinth: { projectId: p.id, versionId: v.id } },
  })
  const fits = (v: MrVersion) => v.game_versions.includes(minecraft) && v.loaders.includes('fabric')

  for (const c of list) {
    const p = projects.get(c.projectId)
    const v = versions.get(c.versionId)
    if (!p || !v) {
      problems.push(`${p?.title ?? c.projectId}: this version is not on Modrinth any more`)
      continue
    }
    if (!fits(v)) problems.push(`${p.title} ${v.version_number} is not made for Minecraft ${minecraft} (Fabric): pick another version`)
    entries.set(p.id, { entry: make(p, v, c), version: v })
  }

  // Required libraries, recursively (a library can need another one)
  const queue = [...entries.values()]
  while (queue.length) {
    const { entry, version } = queue.shift()!
    const deps = version.dependencies.filter((d) => d.dependency_type === 'required')
    for (const d of deps) {
      let pid = d.project_id
      let pinned: MrVersion | null = null
      if (d.version_id) {
        pinned = (await get<MrVersion[]>(`/versions?ids=${ids([d.version_id])}`))[0] ?? null
        pid ??= pinned?.project_id ?? null
      }
      if (!pid) continue
      await loadProjects([pid])
      const p = projects.get(pid)
      if (!p) continue
      const need = () => !entry.requires.includes(p.slug) && entry.requires.push(p.slug)
      if (entries.has(pid)) {
        need()
        continue
      }
      const v = pinned && fits(pinned) ? pinned : (pickVersion(await compatibleVersions(get, pid, minecraft), true) ?? null)
      if (!v) {
        problems.push(`${entry.name} needs ${p.title}, which has no version for Minecraft ${minecraft} (Fabric)`)
        continue
      }
      const lib = { entry: make(p, v, { category: 'library', recommended: true, defaultEnabled: true, description: { en: p.description.slice(0, 140) || p.title } }), version: v }
      entries.set(pid, lib)
      need()
      added.push(p.slug)
      queue.push(lib)
    }
  }

  const all = [...entries.values()]
  for (const { entry, version } of all) {
    if (version.version_type !== 'release') warnings.push(`${entry.name} uses a ${version.version_type} build (${version.version_number})`)
    for (const d of version.dependencies.filter((x) => x.dependency_type === 'incompatible' && x.project_id && entries.has(x.project_id)))
      problems.push(`${entry.name} does not work with ${entries.get(d.project_id!)!.entry.name}: remove one of them`)
  }
  const needed = new Set(all.flatMap((x) => x.entry.requires))
  const unused = all.filter((x) => x.entry.category === 'library' && !needed.has(x.entry.id)).map((x) => x.entry.id)
  for (const x of all) if (unused.includes(x.entry.id)) warnings.push(`${x.entry.name}: no mod of the pack needs this library any more`)
  return { mods: all.map((x) => x.entry), added, problems, warnings, unused }
}

/** Newest compatible release of each mod (betas only for a mod already on a beta); null = none for this Minecraft. */
export async function newestVersions(get: ModrinthGet, minecraft: string, mods: { projectId: string; beta?: boolean }[]): Promise<Record<string, { versionId: string; version: string } | null>> {
  const out: Record<string, { versionId: string; version: string } | null> = {}
  for (const m of mods) {
    const v = pickVersion(await compatibleVersions(get, m.projectId, minecraft), m.beta)
    out[m.projectId] = v ? { versionId: v.id, version: v.version_number } : null
  }
  return out
}

// ------------------------------------------------------------------------------------------------ a new Minecraft

/** Mojang's list of every Minecraft version (releases, snapshots), newest first */
export const MOJANG_VERSIONS = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'
/** Fabric's list of loaders for a Minecraft version (empty: Fabric does not support it yet) */
export const fabricLoadersUrl = (minecraft: string) => `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(minecraft)}`

export interface MinecraftRelease {
  id: string
  releasedAt: string
}

/** Releases (no snapshots) newer than `current`, newest first. Unknown current version: none. */
export function newerReleases(versions: { id: string; type: string; releaseTime: string }[], current: string): MinecraftRelease[] {
  const releases = versions.filter((v) => v.type === 'release').sort((a, b) => b.releaseTime.localeCompare(a.releaseTime))
  const at = releases.findIndex((v) => v.id === current)
  return at < 0 ? [] : releases.slice(0, at).map((v) => ({ id: v.id, releasedAt: v.releaseTime }))
}

/** The loader to use: Fabric's newest stable one for this Minecraft (null: Fabric is not ready) */
export const pickLoader = (loaders: { version: string; stable: boolean }[]) => (loaders.find((l) => l.stable) ?? loaders[0])?.version ?? null

export interface ModReadiness {
  projectId: string
  id: string
  name: string
  library: boolean
  /** release = ready; beta = only a beta/alpha build so far; none = nothing for this Minecraft yet */
  status: 'release' | 'beta' | 'none'
  versionId: string | null
  version: string | null
}

/** Which mods of the pack already have a version for another Minecraft (each mod's newest build for it). */
export async function packReadiness(get: ModrinthGet, minecraft: string, mods: Pick<ModEntry, 'id' | 'name' | 'category' | 'source'>[]): Promise<ModReadiness[]> {
  const out: ModReadiness[] = []
  for (const m of mods) {
    if (!m.source) continue
    const list = await compatibleVersions(get, m.source.modrinth.projectId, minecraft)
    const v = pickVersion(list, true) ?? list[0]
    out.push({
      projectId: m.source.modrinth.projectId,
      id: m.id,
      name: m.name,
      library: m.category === 'library',
      status: !v ? 'none' : v.version_type === 'release' ? 'release' : 'beta',
      versionId: v?.id ?? null,
      version: v?.version_number ?? null,
    })
  }
  return out
}

// ------------------------------------------------------------------------------------------------ versions, changes

export const SEMVER = /^\d+\.\d+\.\d+$/
export function compareVersions(a: string, b: string): number {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number))
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0)
  return 0
}

export interface PackChanges {
  minecraft: [string, string] | null
  loader: [string, string] | null
  added: ModEntry[]
  removed: ModEntry[]
  updated: { mod: ModEntry; from: string }[]
  /** Category, Recommended, On for new players, description */
  settings: { mod: ModEntry; what: string[] }[]
  files: { added: string[]; removed: string[]; changed: string[] }
  size: [number, number]
}

const packSize = (m: ClientManifest | null) => (m ? m.mods.reduce((s, x) => s + x.file.size, 0) + m.files.reduce((s, f) => s + f.size, 0) : 0)

/** What a new manifest changes compared with the one players have. */
export function packChanges(prev: ClientManifest | null, next: Pick<ClientManifest, 'minecraft' | 'loader' | 'mods' | 'files'>): PackChanges {
  const before = new Map((prev?.mods ?? []).map((m) => [m.id, m]))
  const after = new Map(next.mods.map((m) => [m.id, m]))
  const settings: PackChanges['settings'] = []
  for (const m of next.mods) {
    const o = before.get(m.id)
    if (!o) continue
    const what = [
      ...(o.category !== m.category ? ['category'] : []),
      ...(o.recommended !== m.recommended ? ['Recommended'] : []),
      ...(o.defaultEnabled !== m.defaultEnabled ? ['On for new players'] : []),
      ...(JSON.stringify(o.description) !== JSON.stringify(m.description) ? ['description'] : []),
    ]
    if (what.length) settings.push({ mod: m, what })
  }
  const prevFiles = new Map((prev?.files ?? []).map((f) => [f.path, f]))
  return {
    minecraft: prev && prev.minecraft !== next.minecraft ? [prev.minecraft, next.minecraft] : null,
    loader: prev && prev.loader.version !== next.loader.version ? [prev.loader.version, next.loader.version] : null,
    added: next.mods.filter((m) => !before.has(m.id)),
    removed: (prev?.mods ?? []).filter((m) => !after.has(m.id)),
    updated: next.mods.flatMap((m) => {
      const o = before.get(m.id)
      return o && o.file.sha512 !== m.file.sha512 ? [{ mod: m, from: o.version }] : []
    }),
    settings,
    files: {
      added: next.files.filter((f) => !prevFiles.has(f.path)).map((f) => f.path),
      removed: (prev?.files ?? []).filter((f) => !next.files.some((n) => n.path === f.path)).map((f) => f.path),
      changed: next.files.filter((f) => prevFiles.has(f.path) && (prevFiles.get(f.path)!.sha512 !== f.sha512 || prevFiles.get(f.path)!.policy !== f.policy)).map((f) => f.path),
    },
    size: [packSize(prev), packSize(next as ClientManifest)],
  }
}

export const hasChanges = (c: PackChanges) =>
  Boolean(c.minecraft || c.loader || c.added.length || c.removed.length || c.updated.length || c.settings.length || c.files.added.length || c.files.removed.length || c.files.changed.length)

/** The pack's version rule (docs/CONTENT.md): new Minecraft → major, new mods → minor, the rest → patch. */
export const bumpKind = (c: PackChanges): 'major' | 'minor' | 'patch' => (c.minecraft ? 'major' : c.added.some((m) => m.category !== 'library') ? 'minor' : 'patch')

export function nextVersion(v: string, kind: 'major' | 'minor' | 'patch'): string {
  const [a, b, c] = v.split('.').map(Number)
  return kind === 'major' ? `${a + 1}.0.0` : kind === 'minor' ? `${a}.${b + 1}.0` : `${a}.${b}.${c + 1}`
}

// ------------------------------------------------------------------------------------------------ proposals

/** The online pack the proposal starts from (what Herald read): the publisher refuses if it changed meanwhile. */
export const PackBaseSchema = z.object({
  sequence: z.number().int().nonnegative(),
  clientVersion: z.string().regex(SEMVER),
  /** SHA-512 of the online manifest */
  sha512: z.string().regex(/^[0-9a-f]{128}$/),
})
export type PackBase = z.infer<typeof PackBaseSchema>

export const PACK_STATUSES = ['proposed', 'approved', 'published', 'rejected', 'withdrawn', 'replaced', 'failed'] as const
export type PackStatus = (typeof PACK_STATUSES)[number]

export interface PackProposal {
  id: string
  status: PackStatus
  clientVersion: string
  manifest: ClientManifest
  basedOn: PackBase
  previousCanJoin: boolean
  /** Why: shown to whoever approves */
  note: string
  proposedBy: string
  proposedByName: string | null
  proposedAt: number
  decidedBy: string | null
  decidedByName: string | null
  decidedAt: number | null
  /** Why it was rejected, or why publishing failed */
  decisionNote: string | null
  commit: string | null
  updatedAt: number
}

export const PACK_ID = /^k-[a-z0-9]{10}$/
/** Config files sent by Herald (configs, small packs): kept by the server until published */
export const MAX_PACK_FILE = 1024 * 1024
/** Where the server keeps an uploaded config file (fetched by the publisher, checked against the manifest) */
export const packFileKey = (sha512: string) => `pack/${sha512.slice(0, 64)}.bin`
/** A config file's address next to its client */
export const packFileUrl = (contentBase: string, clientVersion: string, path: string) => `${contentBase}clients/${clientVersion}/files/${path}`

export const MOD_CATEGORY_LABEL: Record<(typeof MOD_CATEGORIES)[number], string> = { performance: 'Performance', voice: 'Voice', visual: 'Visual', comfort: 'Comfort', library: 'Library' }

/** Exact bytes of a manifest as published (the index records their SHA-512). */
export const manifestBytesText = (m: ClientManifest) => JSON.stringify(m, null, 2) + '\n'

export type { ExtraFile }
