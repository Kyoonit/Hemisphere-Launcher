import { app } from 'electron'
import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  CONTENT_BASE,
  HERALD_TEST_CONTENT_BASE,
  ClientManifestSchema,
  ContentIndexSchema,
  type ClientManifest,
  type ContentIndex,
} from '@shared/manifest'
import { CONTENT_PUBLIC_KEY } from './publicKey'
import { heraldContentBase } from './feedV2'
import { conditionalGet, rememberEtag } from './conditional'
import { savedNotModified } from '../system/network'

/**
 * Downloads, verifies and caches the Hemisphere client definition.
 *  1. index.json + index.json.sig  → Ed25519 signature checked against the key built into the launcher
 *  2. manifest.json                 → must match the size + sha512 recorded in the signed index
 *  3. both validated (schema, safe paths, allowed download hosts)
 * Anything that fails is rejected; the last verified copy on disk is used instead (works offline).
 * Where: Herald's content repository first (Herald publishes the pack there since S10), then this repository's content
 * folder (where it was published before, the fallback until the move is done).
 */

export interface LoadedContent {
  index: ContentIndex
  manifest: ClientManifest
  source: 'network' | 'cache'
}

export class ContentError extends Error {}

const dev = () => !app.isPackaged
/** Dev builds pointed at Herald's TEST environment read the test pack (test key, own cache): never mixed with the real one */
const testKey = () => (dev() && import.meta.env?.MAIN_VITE_HERALD_PUBLIC_KEY !== CONTENT_PUBLIC_KEY && import.meta.env?.MAIN_VITE_HERALD_PUBLIC_KEY) || null
let publicKey: KeyObject | null = null
const packKey = () => (publicKey ??= createPublicKey({ key: Buffer.from(testKey() ?? CONTENT_PUBLIC_KEY, 'base64'), format: 'der', type: 'spki' }))
const cacheDir = () => join(app.getPath('userData'), 'content-cache', ...(testKey() ? ['pack-test'] : []))
const MAX_INDEX_BYTES = 64 * 1024

/** Where the pack is read, in order. Dev builds may point at a local folder/server (MAIN_VITE_CONTENT_BASE) or at
 *  Herald's test content; releases always use GitHub. */
function contentBases(): string[] {
  if (testKey()) return [import.meta.env?.MAIN_VITE_HERALD_CONTENT_BASE || HERALD_TEST_CONTENT_BASE]
  if (dev() && import.meta.env?.MAIN_VITE_CONTENT_BASE) return [import.meta.env.MAIN_VITE_CONTENT_BASE]
  return [...new Set([heraldContentBase(), CONTENT_BASE])]
}

async function download(url: string, maxBytes: number): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000), cache: 'no-store' })
  if (!res.ok) throw new ContentError(`${url}: HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > maxBytes) throw new ContentError(`${url}: too large`)
  return buf
}

/** Verifies raw index + signature + manifest bytes. Pure function: same checks for network and cache. */
export function verifyContent(indexBytes: Buffer, signatureB64: string, manifestBytes: Buffer, key = packKey()) {
  const signature = Buffer.from(signatureB64.trim(), 'base64')
  if (!verify(null, indexBytes, key, signature)) throw new ContentError('index signature is invalid')
  const index = ContentIndexSchema.parse(JSON.parse(indexBytes.toString('utf8')))

  if (manifestBytes.length !== index.latest.size) throw new ContentError('manifest size mismatch')
  const hash = createHash('sha512').update(manifestBytes).digest('hex')
  if (hash !== index.latest.sha512) throw new ContentError('manifest hash mismatch')
  const manifest = ClientManifestSchema.parse(JSON.parse(manifestBytes.toString('utf8')))
  if (manifest.clientVersion !== index.latest.clientVersion || manifest.minecraft !== index.latest.minecraft)
    throw new ContentError('manifest does not match index')
  return { index, manifest }
}

async function readCache(): Promise<{ index: ContentIndex; manifest: ClientManifest; raw: [Buffer, string, Buffer] } | null> {
  try {
    const dir = cacheDir()
    const raw: [Buffer, string, Buffer] = [
      await readFile(join(dir, 'index.json')),
      await readFile(join(dir, 'index.json.sig'), 'utf8'),
      await readFile(join(dir, 'manifest.json')),
    ]
    return { ...verifyContent(...raw), raw } // re-verified: a tampered cache is ignored
  } catch {
    return null
  }
}

async function writeCache(indexBytes: Buffer, sig: string, manifestBytes: Buffer): Promise<void> {
  const dir = cacheDir()
  await mkdir(dir, { recursive: true })
  for (const [name, data] of [['index.json', indexBytes], ['index.json.sig', sig], ['manifest.json', manifestBytes]] as const) {
    await writeFile(join(dir, `${name}.tmp`), data)
    await rename(join(dir, `${name}.tmp`), join(dir, name))
  }
}

/**
 * The previous client's manifest (for "Play on <previous Minecraft>"), verified against the hash recorded in the
 * signed index. Cached on disk so it also works offline.
 */
export async function getPreviousManifest(): Promise<ClientManifest | null> {
  const { index } = await getContent()
  const ref = index.previous
  if (!ref) return null
  const check = (bytes: Buffer) => {
    if (bytes.length !== ref.size || createHash('sha512').update(bytes).digest('hex') !== ref.sha512) throw new ContentError('previous manifest hash mismatch')
    return ClientManifestSchema.parse(JSON.parse(bytes.toString('utf8')))
  }
  const cached = join(cacheDir(), 'previous-manifest.json')
  try {
    return check(await readFile(cached))
  } catch {
    // from where the index came, else from each place in order
    const bases = [...new Set([...(loadedFrom ? [loadedFrom] : []), ...contentBases()])]
    let bytes: Buffer | null = null
    for (const base of bases) {
      bytes = await download(`${base}${ref.manifest}`, ref.size).catch(() => null)
      if (bytes) break
    }
    if (!bytes) throw new ContentError('previous manifest unavailable')
    const manifest = check(bytes)
    await mkdir(cacheDir(), { recursive: true })
    await writeFile(cached, bytes)
    return manifest
  }
}

let current: Promise<LoadedContent> | null = null
/** The place the last index was read from (network) */
let loadedFrom: string | null = null

/** Latest verified content. Cached in memory; `refresh` forces a new download attempt. */
export function getContent(refresh = false): Promise<LoadedContent> {
  if (!current || refresh) {
    current = loadContent().catch((err) => {
      current = null // allow a retry next time
      throw err
    })
  }
  return current
}

async function loadContent(): Promise<LoadedContent> {
  const cached = await readCache()
  const errors: string[] = []
  for (const base of contentBases()) {
    try {
      const loaded = await loadFrom(base, cached)
      loadedFrom = base
      return loaded
    } catch (err) {
      errors.push(`${base}: ${err instanceof Error ? err.message : err}`)
    }
  }
  console.warn('[content] using cached client definition:', errors.join(' · '))
  if (cached) return { index: cached.index, manifest: cached.manifest, source: 'cache' }
  throw new ContentError(`client definition unavailable: ${errors.join(' · ')}`)
}

type Cached = Awaited<ReturnType<typeof readCache>>

async function loadFrom(base: string, cached: Cached): Promise<LoadedContent> {
  // Unchanged since the copy we kept (and verified again above): nothing else to download.
  const indexUrl = `${base}index.json`
  const got = await conditionalGet(indexUrl, MAX_INDEX_BYTES, cached ? cached.raw[0].length + cached.raw[2].length : null)
  if (got.notModified && cached) return { index: cached.index, manifest: cached.manifest, source: 'network' }
  if (got.notModified) throw new ContentError('index unchanged but no cached copy')
  const indexBytes = got.bytes
  const sig = (await download(`${base}index.json.sig`, 1024)).toString('utf8')
  // Peek at the (unverified) index only to know which manifest to fetch; everything is verified below.
  const peek = ContentIndexSchema.parse(JSON.parse(indexBytes.toString('utf8')))
  // the same client as before (only the index changed): keep the manifest we have
  const sameManifest = cached && cached.index.latest.sha512 === peek.latest.sha512
  if (sameManifest) savedNotModified(cached.raw[2].length)
  const manifestBytes = sameManifest ? cached.raw[2] : await download(`${base}${peek.latest.manifest}`, peek.latest.size)
  const { index, manifest } = verifyContent(indexBytes, sig, manifestBytes)

  // Replay protection: never go back to an older signed index than one we already trusted.
  if (cached && index.sequence < cached.index.sequence) {
    console.warn(`[content] ignoring older index (sequence ${index.sequence} < ${cached.index.sequence})`)
    return { index: cached.index, manifest: cached.manifest, source: 'cache' }
  }
  await writeCache(indexBytes, sig, manifestBytes)
  await rememberEtag(indexUrl, got.etag)
  return { index, manifest, source: 'network' }
}
