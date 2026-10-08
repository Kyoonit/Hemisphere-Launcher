// Builds and signs a Hemisphere client from content-src/client.json.
//   npm run content:publish -- --dry-run     resolve and show what would be published
//   npm run content:publish                  write content/ (then commit + push to make it live)
import { createHash, createPrivateKey, sign } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import {
  CONTENT_BASE,
  CONTENT_SCHEMA,
  ClientManifestSchema,
  ContentIndexSchema,
  MOD_CATEGORIES,
  isSafeRelativePath,
  type ClientManifest,
  type ContentIndex,
  type ExtraFile,
  type ModEntry,
} from '../../src/shared/manifest.ts'
import { defaultKeyPath } from './keyPath.ts'

const ROOT = join(import.meta.dirname, '..', '..')
const SRC = join(ROOT, 'content-src')
const OUT = join(ROOT, 'content')
const dryRun = process.argv.includes('--dry-run')
const force = process.argv.includes('--force')

// ---------- source file ----------
const SourceSchema = z.object({
  clientVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  minecraft: z.string(),
  fabricLoader: z.string(),
  previousCanJoin: z.boolean(),
  mods: z.array(
    z.object({
      modrinth: z.string(),
      category: z.enum(MOD_CATEGORIES),
      recommended: z.boolean(),
      default: z.boolean(),
      description: z.object({ en: z.string() }).catchall(z.string()),
      /** pin an exact Modrinth version number; otherwise the newest compatible release is used */
      version: z.string().optional(),
      allowBeta: z.boolean().optional(),
    }),
  ),
  files: z.array(z.object({ path: z.string().refine(isSafeRelativePath, 'unsafe path'), policy: z.enum(['enforced', 'default']) })),
  /** "What's new" lines for players, e.g. { "en": "…", "fr": "…" } */
  changelog: z.array(z.object({ en: z.string() }).catchall(z.string())).max(30).optional(),
})
const src = SourceSchema.parse(JSON.parse(readFileSync(join(SRC, 'client.json'), 'utf8')))

// ---------- Modrinth ----------
const UA = { 'User-Agent': 'Kyoonit/Hemisphere-Launcher (content publisher)' }
interface MrFile { url: string; filename: string; primary: boolean; size: number; hashes: { sha512: string } }
interface MrVersion { id: string; project_id: string; version_number: string; version_type: 'release' | 'beta' | 'alpha'; game_versions: string[]; loaders: string[]; files: MrFile[]; dependencies: { project_id: string | null; version_id: string | null; dependency_type: string }[] }
interface MrProject { id: string; slug: string; title: string; description: string }

async function api<T>(path: string): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`https://api.modrinth.com/v2${path}`, { headers: UA })
    if (res.ok) return (await res.json()) as T
    if (res.status === 429 && attempt < 5) {
      await new Promise((r) => setTimeout(r, 1000 * attempt))
      continue
    }
    throw new Error(`Modrinth ${path}: HTTP ${res.status}`)
  }
}
const projects = new Map<string, MrProject>()
async function project(idOrSlug: string): Promise<MrProject> {
  if (!projects.has(idOrSlug)) {
    const p = await api<MrProject>(`/project/${idOrSlug}`)
    projects.set(p.id, p).set(p.slug, p)
  }
  return projects.get(idOrSlug)!
}

async function resolveVersion(p: MrProject, pin?: string, allowBeta = false): Promise<MrVersion> {
  const q = new URLSearchParams({ game_versions: JSON.stringify([src.minecraft]), loaders: JSON.stringify(['fabric']) })
  const versions = await api<MrVersion[]>(`/project/${p.id}/version?${q}`)
  if (pin) {
    const v = versions.find((x) => x.version_number === pin)
    if (!v) throw new Error(`${p.slug}: pinned version "${pin}" not found for ${src.minecraft} fabric`)
    return v
  }
  const pick = versions.find((v) => v.version_type === 'release') ?? (allowBeta ? versions.find((v) => v.version_type === 'beta') : undefined)
  if (!pick)
    throw new Error(
      versions.length
        ? `${p.slug}: only ${versions[0].version_type} builds for ${src.minecraft} (add "allowBeta": true to accept)`
        : `${p.slug}: no Fabric version for Minecraft ${src.minecraft}`,
    )
  return pick
}

function fileEntry(v: MrVersion, slug: string): ModEntry['file'] {
  const f = v.files.find((x) => x.primary) ?? v.files[0]
  if (!f) throw new Error(`${slug}: version ${v.version_number} has no file`)
  return { path: `mods/${f.filename}`, url: f.url, sha512: f.hashes.sha512, size: f.size }
}

// ---------- resolve mods + required dependencies ----------
const mods = new Map<string, ModEntry>()
const warnings: string[] = []

async function addMod(p: MrProject, v: MrVersion, meta: Omit<ModEntry, 'id' | 'name' | 'version' | 'file' | 'requires' | 'source'>): Promise<void> {
  if (mods.has(p.slug)) return
  const entry: ModEntry = { id: p.slug, name: p.title, version: v.version_number, file: fileEntry(v, p.slug), requires: [], source: { modrinth: { projectId: p.id, versionId: v.id } }, ...meta }
  mods.set(p.slug, entry)
  if (v.version_type !== 'release') warnings.push(`${p.slug} uses a ${v.version_type} build (${v.version_number})`)

  for (const dep of v.dependencies.filter((d) => d.dependency_type === 'required')) {
    const depVersion = dep.version_id ? await api<MrVersion>(`/version/${dep.version_id}`) : null
    const depProject = await project(dep.project_id ?? depVersion!.project_id)
    entry.requires.push(depProject.slug)
    if (mods.has(depProject.slug)) continue
    const resolved = depVersion ?? (await resolveVersion(depProject, undefined, true))
    await addMod(depProject, resolved, {
      category: 'library',
      recommended: true,
      defaultEnabled: true,
      description: { en: depProject.description.slice(0, 140) },
    })
  }
}

console.log(`Resolving Hemisphere Client ${src.clientVersion} for Minecraft ${src.minecraft} (Fabric ${src.fabricLoader})…`)
for (const m of src.mods) {
  const p = await project(m.modrinth)
  const v = await resolveVersion(p, m.version, m.allowBeta)
  mods.delete(p.slug) // explicit entry wins over an auto-added library
  await addMod(p, v, { category: m.category, recommended: m.recommended, defaultEnabled: m.default, description: m.description })
}

// ---------- extra files (configs, packs) ----------
const files: ExtraFile[] = src.files.map((f) => {
  const local = join(SRC, 'files', f.path)
  if (!existsSync(local)) throw new Error(`content-src/files/${f.path} does not exist`)
  const bytes = readFileSync(local)
  return { path: f.path, url: `${CONTENT_BASE}clients/${src.clientVersion}/files/${f.path}`, sha512: sha512(bytes), size: bytes.length, policy: f.policy }
})

const manifest: ClientManifest = ClientManifestSchema.parse({
  schema: CONTENT_SCHEMA,
  clientVersion: src.clientVersion,
  createdAt: new Date().toISOString(),
  minecraft: src.minecraft,
  loader: { type: 'fabric', version: src.fabricLoader },
  mods: [...mods.values()],
  files,
  ...(src.changelog?.length ? { changelog: src.changelog } : {}),
} satisfies ClientManifest)

// ---------- report ----------
const total = manifest.mods.reduce((s, m) => s + m.file.size, 0)
console.log(`\n${'MOD'.padEnd(26)}${'CATEGORY'.padEnd(13)}${'DEFAULT'.padEnd(9)}VERSION`)
for (const m of manifest.mods) console.log(`${m.id.padEnd(26)}${m.category.padEnd(13)}${(m.defaultEnabled ? 'on' : 'off').padEnd(9)}${m.version}`)
console.log(`\n${manifest.mods.length} mods (${(total / 1024 / 1024).toFixed(1)} MB), ${files.length} extra files`)
warnings.forEach((w) => console.log(`  ! ${w}`))
if (dryRun) {
  console.log('\nDry run: nothing written.')
  process.exit(0)
}

// ---------- write + sign ----------
const manifestRel = `clients/${manifest.clientVersion}/manifest.json`
const manifestPath = join(OUT, manifestRel)
if (existsSync(manifestPath) && !force) {
  console.error(`\n${manifestRel} already exists. Published versions are immutable: bump clientVersion (or use --force before anyone downloaded it).`)
  process.exit(1)
}
const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n')
mkdirSync(dirname(manifestPath), { recursive: true })
writeFileSync(manifestPath, manifestBytes)
for (const f of src.files) {
  const dest = join(OUT, 'clients', manifest.clientVersion, 'files', f.path)
  mkdirSync(dirname(dest), { recursive: true })
  copyFileSync(join(SRC, 'files', f.path), dest)
}

const indexPath = join(OUT, 'index.json')
const old: ContentIndex | null = existsSync(indexPath) ? ContentIndexSchema.parse(JSON.parse(readFileSync(indexPath, 'utf8'))) : null
const latest = { clientVersion: manifest.clientVersion, minecraft: manifest.minecraft, manifest: manifestRel, sha512: sha512(manifestBytes), size: manifestBytes.length }
const index: ContentIndex = ContentIndexSchema.parse({
  schema: CONTENT_SCHEMA,
  sequence: (old?.sequence ?? 0) + 1,
  updatedAt: new Date().toISOString(),
  latest,
  previous: old && old.latest.clientVersion !== latest.clientVersion ? old.latest : (old?.previous ?? null),
  previousCanJoin: src.previousCanJoin,
} satisfies ContentIndex)
const indexBytes = Buffer.from(JSON.stringify(index, null, 2) + '\n')

const keyPath = process.env.HEMI_SIGNING_KEY ?? defaultKeyPath()
if (!existsSync(keyPath)) {
  console.error(`\nNo signing key at ${keyPath}. Run "npm run content:keygen" once (or set HEMI_SIGNING_KEY).`)
  process.exit(1)
}
const signature = sign(null, indexBytes, createPrivateKey(readFileSync(keyPath)))
writeFileSync(indexPath, indexBytes)
writeFileSync(`${indexPath}.sig`, signature.toString('base64') + '\n')

console.log(`\nWrote content/${manifestRel}, content/index.json (sequence ${index.sequence}) and its signature.`)
console.log('Next: commit and push the content/ folder — launchers pick it up on their next start.')

function sha512(bytes: Buffer): string {
  return createHash('sha512').update(bytes).digest('hex')
}
