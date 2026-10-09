/**
 * Herald publisher (plan A, phase S2). Runs in GitHub Actions ("Herald publish" workflow of the content repository),
 * where the content signing key is a repository secret. It asks the Herald server for the newest queued job,
 * validates it with the SAME schema as the launcher, signs the exact file bytes (like tools/content), commits, and
 * reports the commit back (the server's /pulse then points launchers at it).
 *
 * This file is the logic (tested in tests/herald-publisher.test.ts); publish-run.ts is the program (bundled into the
 * content repository by `npm run herald:publisher:build`).
 */
import { createHash, sign, type KeyObject } from 'node:crypto'
import { FeedSchema } from '../../src/shared/feed.ts'
import { FEED_V2_PATH, FeedV2Schema, type FeedV2 } from '../../src/shared/feedV2.ts'
import { CONTENT_SCHEMA, ClientManifestSchema, ContentIndexSchema, type ClientManifest } from '../../src/shared/manifest.ts'
import { compareVersions, manifestBytesText, PackBaseSchema, type MrVersion } from '../../src/shared/heraldPack.ts'

export interface PublishJob {
  id: string
  sequence: number
  /** 2 = Herald feed (content/v2/), absent = schema 1 feed */
  schema?: 2
  feed: Record<string, unknown>
  /** Schema 2: files next to the feed (vaults, pictures), each listed in the signed feed with the same path, SHA-512
   *  and size. `b64` = the bytes; `keep` = already in the repository as listed (publish-run checked), not written */
  files?: { path: string; sha512: string; size?: number; b64?: string; keep?: boolean }[]
  /** An approved change of the mod pack (S10), published with this feed */
  pack?: PackJob
}

export interface PackJob {
  proposalId: string
  manifest: unknown
  /** The online pack the change starts from: refused if the repository has another one now */
  basedOn: unknown
  previousCanJoin: boolean
  /** Config files: SHA-512 → bytes (base64), fetched by publish-run */
  fileBytes?: Record<string, string>
}

/** A refusal caused by the mod pack: the server takes the pack out of the next jobs, the news keep being published */
export class PackError extends Error {}

/** A file of the repository (null = absent) */
export type RepoReader = (path: string) => Buffer | null

/** Every file a schema 2 feed lists: vault files, their pictures, pictures of the news and backgrounds in clear */
export function listedFiles(feed: FeedV2): { path: string; sha512: string; size: number }[] {
  return [
    ...feed.vaults.flatMap((v) => [v.file, ...(v.image ? [v.image] : [])]),
    ...feed.news.flatMap((n) => (n.imageFile?.path.startsWith('v2/images/') ? [n.imageFile] : [])),
    ...feed.backgrounds.flatMap((b) => (b.image.path.startsWith('v2/images/') ? [b.image] : [])),
  ]
}

/** Files to write (paths relative to the repository root) for one job. Throws if the content is invalid. */
export function buildRelease(job: PublishJob, contentDir: string, key: KeyObject, now = new Date(), read: RepoReader = () => null): { path: string; bytes: Buffer }[] {
  if (!/^[a-z0-9-]+$/.test(contentDir)) throw new Error(`bad content folder: ${contentDir}`)
  if (job.schema === 2) return [...buildV2(job, contentDir, key, now), ...(job.pack ? buildPack(job.pack, contentDir, key, read, now) : [])]
  const feed = FeedSchema.parse({ ...job.feed, schema: 1, sequence: job.sequence, updatedAt: now.toISOString() })
  const bytes = Buffer.from(JSON.stringify(feed, null, 2) + '\n')
  return [
    { path: `${contentDir}/feed.json`, bytes },
    { path: `${contentDir}/feed.json.sig`, bytes: Buffer.from(sign(null, bytes, key).toString('base64') + '\n') },
  ]
}

/** One line a human can read in the job's error (zod lists every problem). */
export const errorText = (err: unknown): string =>
  err && typeof err === 'object' && 'issues' in err && Array.isArray(err.issues)
    ? err.issues.map((i: { path: unknown[]; message: string }) => `${i.path.join('.') || '(root)'}: ${i.message}`).join(' · ')
    : err instanceof Error ? err.message : String(err)

function buildV2(job: PublishJob, contentDir: string, key: KeyObject, now: Date): { path: string; bytes: Buffer }[] {
  const feed = FeedV2Schema.parse({ ...job.feed, schema: 2, sequence: job.sequence, updatedAt: now.toISOString() })
  const bytes = Buffer.from(JSON.stringify(feed, null, 2) + '\n')
  const out = [
    { path: `${contentDir}/${FEED_V2_PATH}`, bytes },
    { path: `${contentDir}/${FEED_V2_PATH}.sig`, bytes: Buffer.from(sign(null, bytes, key).toString('base64') + '\n') },
  ]
  const listed = listedFiles(feed)
  for (const f of job.files ?? []) {
    const entry = listed.find((l) => l.path === f.path)
    if (f.keep && entry && entry.sha512 === f.sha512) continue
    const file = Buffer.from(f.b64 ?? '', 'base64')
    const sha = createHash('sha512').update(file).digest('hex')
    // Only files the signed feed lists, byte for byte: nothing else can reach the content folder
    if (!entry || entry.sha512 !== sha || entry.size !== file.length) throw new Error(`file ${f.path} is not listed in the feed as sent`)
    out.push({ path: `${contentDir}/${f.path}`, bytes: file })
  }
  for (const l of listed) if (!(job.files ?? []).some((f) => f.path === l.path)) throw new Error(`file ${l.path} is listed but missing from the job`)
  return out
}

const sha512 = (b: Buffer) => createHash('sha512').update(b).digest('hex')

/**
 * The files of an approved pack change: clients/<v>/manifest.json (+ its config files) and index.json signed. Nothing if
 * an earlier job already published it. Refused if the online pack changed since the change was made, or if the
 * version exists already (published versions never change).
 */
export function buildPack(pack: PackJob, contentDir: string, key: KeyObject, read: RepoReader, now: Date): { path: string; bytes: Buffer }[] {
  let manifest: ClientManifest
  try {
    manifest = ClientManifestSchema.parse(pack.manifest)
  } catch (err) {
    throw new PackError(`mod pack: ${errorText(err)}`)
  }
  const base = PackBaseSchema.parse(pack.basedOn)
  const bytes = Buffer.from(manifestBytesText(manifest))
  const rel = `clients/${manifest.clientVersion}/manifest.json`
  const indexRaw = read(`${contentDir}/index.json`)
  const index = indexRaw ? ContentIndexSchema.parse(JSON.parse(indexRaw.toString('utf8'))) : null
  if (index && index.latest.sha512 === sha512(bytes)) return [] // published by an earlier job
  if (index && index.latest.sha512 !== base.sha512) throw new PackError(`mod pack: the online pack changed meanwhile (now ${index.latest.clientVersion}). Make the change again from it.`)
  if (index && compareVersions(manifest.clientVersion, index.latest.clientVersion) <= 0) throw new PackError(`mod pack: ${manifest.clientVersion} is not newer than ${index.latest.clientVersion}`)
  if (read(`${contentDir}/${rel}`)) throw new PackError(`mod pack: ${manifest.clientVersion} was already published once. Use a new version number.`)

  const out = [{ path: `${contentDir}/${rel}`, bytes }]
  for (const f of manifest.files) {
    if (!f.url.endsWith(`/${contentDir}/clients/${manifest.clientVersion}/files/${f.path}`)) throw new PackError(`mod pack: ${f.path} has a wrong address`)
    const file = Buffer.from(pack.fileBytes?.[f.sha512] ?? '', 'base64')
    if (sha512(file) !== f.sha512 || file.length !== f.size) throw new PackError(`mod pack: ${f.path} does not match the pack`)
    out.push({ path: `${contentDir}/clients/${manifest.clientVersion}/files/${f.path}`, bytes: file })
  }
  const latest = { clientVersion: manifest.clientVersion, minecraft: manifest.minecraft, manifest: rel, sha512: sha512(bytes), size: bytes.length }
  const next = ContentIndexSchema.parse({
    schema: CONTENT_SCHEMA,
    // never lower than the pack it replaces (launchers refuse an older index), even when it was read elsewhere
    sequence: Math.max(index?.sequence ?? 0, base.sequence) + 1,
    updatedAt: now.toISOString(),
    latest,
    previous: index ? (index.latest.clientVersion !== latest.clientVersion ? index.latest : index.previous) : null,
    previousCanJoin: pack.previousCanJoin,
  })
  const indexBytes = Buffer.from(JSON.stringify(next, null, 2) + '\n')
  out.push({ path: `${contentDir}/index.json`, bytes: indexBytes }, { path: `${contentDir}/index.json.sig`, bytes: Buffer.from(sign(null, indexBytes, key).toString('base64') + '\n') })
  return out
}

/** Every mod as Modrinth has it: same project, version, file (address, SHA-512, size), for this Minecraft and Fabric. */
export function checkOnModrinth(manifest: unknown, versions: MrVersion[]): void {
  const m = ClientManifestSchema.parse(manifest)
  const wrong: string[] = []
  for (const mod of m.mods) {
    const src = mod.source?.modrinth
    const v = src && versions.find((x) => x.id === src.versionId)
    const file = v?.files.find((f) => f.hashes.sha512 === mod.file.sha512)
    if (!src || !v || v.project_id !== src.projectId) wrong.push(`${mod.name}: not on Modrinth`)
    else if (!file || file.url !== mod.file.url || file.size !== mod.file.size) wrong.push(`${mod.name}: the file is not Modrinth's`)
    else if (!v.game_versions.includes(m.minecraft) || !v.loaders.includes('fabric')) wrong.push(`${mod.name}: not made for Minecraft ${m.minecraft} (Fabric)`)
  }
  if (wrong.length) throw new PackError(`mod pack: ${wrong.join(' · ')}`)
}
