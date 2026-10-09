/**
 * Herald publisher (plan A, phase S2; sealed since S12). Runs in GitHub Actions ("Herald publish" workflow of the
 * content repository), where the content signing key is a repository secret. It asks the Herald server for the newest
 * queued job, validates it with the SAME schema as the launcher, signs the exact plaintext (like tools/content), SEALS
 * it with the key the server gave for this run (src/shared/sealed.ts), commits, and reports the commit back.
 * Nothing readable reaches the repository: after a run, the content folder holds sealed .bin files only.
 *
 * This file is the logic (tested in tests/herald-publisher.test.ts); publish-run.ts is the program (bundled into the
 * content repository by `npm run herald:publisher:build`).
 */
import { createHash, sign, type KeyObject } from 'node:crypto'
import { FeedSchema } from '../../src/shared/feed.ts'
import { FEED_V2_SEALED_PATH, FeedV2Schema, type FeedV2 } from '../../src/shared/feedV2.ts'
import { CONTENT_SCHEMA, ClientManifestSchema, ContentIndexSchema, type ClientManifest, type ContentIndex } from '../../src/shared/manifest.ts'
import { compareVersions, manifestBytesText, PackBaseSchema, type MrVersion } from '../../src/shared/heraldPack.ts'
import { fromB64, seal, toB64, unseal, type SealedDocument } from '../../src/shared/sealed.ts'

/** A content key given by the server for this run (base64 AES key) */
export interface RunKey {
  id: string
  key: string
}

export interface PublishJob {
  id: string
  sequence: number
  /** 2 = Herald feed (content/v2/), absent = schema 1 feed (local tests only) */
  schema?: 2
  feed: Record<string, unknown>
  /** Schema 2: files next to the feed (vaults, pictures), each listed in the signed feed with the same path, SHA-512
   *  and size (a sealed picture: its sealed bytes'). `b64` = the bytes; `keep` = already in the repository as listed */
  files?: { path: string; sha512: string; size?: number; b64?: string; keep?: boolean }[]
  /** An approved change of the mod pack (S10), published with this feed */
  pack?: PackJob
  /** Keys of this run: the feed's; the pack's in force (to read the sealed index) and the next one (to write it) */
  seal?: { feed: RunKey; pack?: { current: RunKey | null; next: RunKey | null } }
}

export interface PackJob {
  proposalId: string
  manifest: unknown
  /** The online pack the change starts from: refused if the repository has another one now */
  basedOn: unknown
  previousCanJoin: boolean
  /** Config files: PLAIN SHA-512 → their SEALED bytes (base64), fetched by publish-run */
  fileBytes?: Record<string, string>
}

/** A refusal caused by the mod pack: the server takes the pack out of the next jobs, the news keep being published */
export class PackError extends Error {}

/** A file of the repository (null = absent) */
export type RepoReader = (path: string) => Buffer | null

export interface Release {
  /** Files to write, paths relative to the repository root */
  writes: { path: string; bytes: Buffer }[]
  /** A new sealed pack index was written (its key can be given from now on) */
  packSealed: boolean
}

const sha512 = (b: Uint8Array) => createHash('sha512').update(b).digest('hex')
const randomHex = (n: number) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('')

/** Every file a schema 2 feed lists, as stored (a sealed picture: its sealed bytes) */
export function listedFiles(feed: FeedV2): { path: string; sha512: string; size: number }[] {
  const stored = (f: { path: string; sha512: string; size: number; seal?: { sha512: string; size: number } }) => (f.seal ? { path: f.path, sha512: f.seal.sha512, size: f.seal.size } : { path: f.path, sha512: f.sha512, size: f.size })
  return [
    ...feed.vaults.flatMap((v) => [v.file, ...(v.image ? [v.image] : [])]),
    ...feed.news.flatMap((n) => (n.imageFile?.path.startsWith('v2/images/') ? [stored(n.imageFile)] : [])),
    ...feed.backgrounds.flatMap((b) => (b.image.path.startsWith('v2/images/') ? [stored(b.image)] : [])),
  ]
}

/** A signed document sealed with a run key */
async function sealDocument(text: string, signingKey: KeyObject, runKey: RunKey, files?: SealedDocument['files'], sig?: string): Promise<Buffer> {
  const doc: SealedDocument = { doc: text, sig: sig ?? sign(null, Buffer.from(text), signingKey).toString('base64'), ...(files ? { files } : {}) }
  return Buffer.from(await seal(new TextEncoder().encode(JSON.stringify(doc)), fromB64(runKey.key), runKey.id, 4096))
}

/** The files of one job. Throws if the content is invalid. */
export async function buildRelease(job: PublishJob, contentDir: string, key: KeyObject, now = new Date(), read: RepoReader = () => null): Promise<Release> {
  if (!/^[a-z0-9-]+$/.test(contentDir)) throw new Error(`bad content folder: ${contentDir}`)
  if (job.schema === 2) {
    const feed = await buildV2(job, contentDir, key, now)
    const pack = await buildPack(job, contentDir, key, read, now)
    return { writes: [...feed, ...pack.writes], packSealed: pack.packSealed }
  }
  const feed = FeedSchema.parse({ ...job.feed, schema: 1, sequence: job.sequence, updatedAt: now.toISOString() })
  const bytes = Buffer.from(JSON.stringify(feed, null, 2) + '\n')
  return {
    writes: [
      { path: `${contentDir}/feed.json`, bytes },
      { path: `${contentDir}/feed.json.sig`, bytes: Buffer.from(sign(null, bytes, key).toString('base64') + '\n') },
    ],
    packSealed: false,
  }
}

/** One line a human can read in the job's error (zod lists every problem). */
export const errorText = (err: unknown): string =>
  err && typeof err === 'object' && 'issues' in err && Array.isArray(err.issues)
    ? err.issues.map((i: { path: unknown[]; message: string }) => `${i.path.join('.') || '(root)'}: ${i.message}`).join(' · ')
    : err instanceof Error ? err.message : String(err)

async function buildV2(job: PublishJob, contentDir: string, key: KeyObject, now: Date): Promise<{ path: string; bytes: Buffer }[]> {
  if (!job.seal?.feed) throw new Error('no key to seal the feed')
  const feed = FeedV2Schema.parse({ ...job.feed, schema: 2, sequence: job.sequence, updatedAt: now.toISOString() })
  const out = [{ path: `${contentDir}/${FEED_V2_SEALED_PATH}`, bytes: await sealDocument(JSON.stringify(feed, null, 2) + '\n', key, job.seal.feed) }]
  const listed = listedFiles(feed)
  for (const f of job.files ?? []) {
    const entry = listed.find((l) => l.path === f.path)
    if (f.keep && entry && entry.sha512 === f.sha512) continue
    const file = Buffer.from(f.b64 ?? '', 'base64')
    // Only files the signed feed lists, byte for byte: nothing else can reach the content folder
    if (!entry || entry.sha512 !== sha512(file) || entry.size !== file.length) throw new Error(`file ${f.path} is not listed in the feed as sent`)
    if (!f.path.endsWith('.bin')) throw new Error(`file ${f.path} is not sealed`)
    out.push({ path: `${contentDir}/${f.path}`, bytes: file })
  }
  for (const l of listed) if (!(job.files ?? []).some((f) => f.path === l.path)) throw new Error(`file ${l.path} is listed but missing from the job`)
  return out
}

/** The pack index in the repository: sealed (opened with the key in force), or still in clear (before it is sealed) */
async function readIndex(contentDir: string, read: RepoReader, current: RunKey | null): Promise<{ text: string; sig: string; index: ContentIndex; files: NonNullable<SealedDocument['files']>; sealed: boolean } | null> {
  const sealed = read(`${contentDir}/index.bin`)
  if (sealed) {
    if (!current) throw new Error('the pack index is sealed but no key was given to read it')
    const doc = JSON.parse(new TextDecoder().decode(await unseal(new Uint8Array(sealed), fromB64(current.key)))) as SealedDocument
    return { text: doc.doc, sig: doc.sig, index: ContentIndexSchema.parse(JSON.parse(doc.doc)), files: doc.files ?? {}, sealed: true }
  }
  const clear = read(`${contentDir}/index.json`)
  if (!clear) return null
  const sig = read(`${contentDir}/index.json.sig`)?.toString('utf8').trim() ?? ''
  return { text: clear.toString('utf8'), sig, index: ContentIndexSchema.parse(JSON.parse(clear.toString('utf8'))), files: {}, sealed: false }
}

/** A manifest sealed with its own random key (the key travels in the sealed index) */
async function sealManifest(bytes: Uint8Array): Promise<{ path: string; bytes: Buffer; entry: { path: string; key: string; sha512: string; size: number } }> {
  const k = crypto.getRandomValues(new Uint8Array(32))
  const sealed = Buffer.from(await seal(bytes, k, 'm', 4096))
  const path = `clients/${randomHex(16)}.bin`
  return { path, bytes: sealed, entry: { path, key: toB64(k), sha512: sha512(sealed), size: sealed.length } }
}

/** A manifest the index lists, as plaintext: from its sealed file (files map) or still in clear */
async function manifestOf(contentDir: string, read: RepoReader, files: NonNullable<SealedDocument['files']>, logical: string): Promise<Uint8Array | null> {
  const f = files[logical]
  if (f) {
    const raw = read(`${contentDir}/${f.path}`)
    return raw ? unseal(new Uint8Array(raw), fromB64(f.key)) : null
  }
  return read(`${contentDir}/${logical}`)
}

/**
 * The mod pack, sealed: an approved change (clients/<random>.bin + its config files + index.bin), or, when the index is
 * still in clear, the same index sealed as it is (its signature kept). Nothing if an earlier job already did it.
 * A change is refused if the online pack changed since it was made, or if its version exists already.
 */
export async function buildPack(job: PublishJob, contentDir: string, key: KeyObject, read: RepoReader, now: Date): Promise<Release> {
  const keys = job.seal?.pack
  const repo = await readIndex(contentDir, read, keys?.current ?? null)
  const out: Release['writes'] = []
  const files: NonNullable<SealedDocument['files']> = {}
  // Keep (or seal) the manifests the new index still lists
  const carry = async (ref: ContentIndex['latest']) => {
    if (repo?.files[ref.manifest]) return void (files[ref.manifest] = repo.files[ref.manifest])
    const plain = await manifestOf(contentDir, read, repo?.files ?? {}, ref.manifest)
    if (!plain || sha512(plain) !== ref.sha512) throw new PackError(`mod pack: ${ref.manifest} is missing or changed`)
    const m = await sealManifest(plain)
    out.push({ path: `${contentDir}/${m.path}`, bytes: m.bytes })
    files[ref.manifest] = m.entry
  }

  if (!job.pack) {
    // No change: seal the index in clear as it is (same signed bytes), once
    if (!repo || repo.sealed || !keys?.next) return { writes: [], packSealed: false }
    await carry(repo.index.latest)
    if (repo.index.previous) await carry(repo.index.previous)
    out.push({ path: `${contentDir}/index.bin`, bytes: await sealDocument(repo.text, key, keys.next, files, repo.sig) })
    return { writes: out, packSealed: true }
  }

  let manifest: ClientManifest
  try {
    manifest = ClientManifestSchema.parse(job.pack.manifest)
  } catch (err) {
    throw new PackError(`mod pack: ${errorText(err)}`)
  }
  const base = PackBaseSchema.parse(job.pack.basedOn)
  const bytes = Buffer.from(manifestBytesText(manifest))
  const index = repo?.index ?? null
  if (index && index.latest.sha512 === sha512(bytes)) return { writes: [], packSealed: false } // published by an earlier job
  if (index && index.latest.sha512 !== base.sha512) throw new PackError(`mod pack: the online pack changed meanwhile (now ${index.latest.clientVersion}). Make the change again from it.`)
  if (index && compareVersions(manifest.clientVersion, index.latest.clientVersion) <= 0) throw new PackError(`mod pack: ${manifest.clientVersion} is not newer than ${index.latest.clientVersion}`)
  if (index?.previous?.clientVersion === manifest.clientVersion) throw new PackError(`mod pack: ${manifest.clientVersion} was already published once. Use a new version number.`)
  if (!keys?.next) throw new Error('no key to seal the pack index')

  // Config files: sealed by the server when they were sent; written where the manifest says
  for (const f of manifest.files) {
    const at = f.url.match(/\/clients\/files\/([0-9a-f]{32})\.bin$/)
    const file = Buffer.from(job.pack.fileBytes?.[f.sha512] ?? '', 'base64')
    if (!f.seal || !at) throw new PackError(`mod pack: ${f.path} is not sealed`)
    if (sha512(file) !== f.seal.sha512 || file.length !== f.seal.size) throw new PackError(`mod pack: ${f.path} does not match the pack`)
    out.push({ path: `${contentDir}/clients/files/${at[1]}.bin`, bytes: file })
  }
  const rel = `clients/${manifest.clientVersion}/manifest.json`
  const m = await sealManifest(bytes)
  out.push({ path: `${contentDir}/${m.path}`, bytes: m.bytes })
  files[rel] = m.entry
  const latest = { clientVersion: manifest.clientVersion, minecraft: manifest.minecraft, manifest: rel, sha512: sha512(bytes), size: bytes.length }
  const previous = index ? (index.latest.clientVersion !== latest.clientVersion ? index.latest : index.previous) : null
  if (previous) await carry(previous)
  const next = ContentIndexSchema.parse({
    schema: CONTENT_SCHEMA,
    // never lower than the pack it replaces (launchers refuse an older index), even when it was read elsewhere
    sequence: Math.max(index?.sequence ?? 0, base.sequence) + 1,
    updatedAt: now.toISOString(),
    latest,
    previous,
    previousCanJoin: job.pack.previousCanJoin,
  })
  out.push({ path: `${contentDir}/index.bin`, bytes: await sealDocument(JSON.stringify(next, null, 2) + '\n', key, keys.next, files) })
  return { writes: out, packSealed: true }
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
