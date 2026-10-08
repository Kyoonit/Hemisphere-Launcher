import { createHash, randomBytes } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { isAllowedDownloadUrl } from '@shared/manifest'
import { throttle } from '../system/network'

/**
 * Content-addressed store: every file is kept once, named by its SHA-512, e.g. store/ab/abcdef….
 * A file only enters the store after its size and hash were verified, so the store is always trustworthy.
 */

export interface StoreFile {
  url: string
  sha512: string
  size: number
}

export class DownloadError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message)
  }
}

export const blobPath = (storeDir: string, sha512: string) => join(storeDir, sha512.slice(0, 2), sha512)

export async function hasBlob(storeDir: string, f: StoreFile): Promise<boolean> {
  try {
    return (await stat(blobPath(storeDir, f.sha512))).size === f.size
  } catch {
    return false
  }
}

export async function sha512OfFile(path: string): Promise<string> {
  const hash = createHash('sha512')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

/**
 * Downloads one file into the store: resumes a previous partial download (HTTP Range), retries with backoff,
 * verifies size + SHA-512, then moves it into place atomically. `onBytes` reports newly received bytes.
 */
export async function downloadToStore(
  storeDir: string,
  f: StoreFile,
  onBytes: (n: number) => void,
  options: { attempts?: number; timeoutMs?: number; allowUrl?: (url: string) => boolean } = {},
): Promise<void> {
  const { attempts = 4, timeoutMs = 60_000, allowUrl = isAllowedDownloadUrl } = options
  if (!allowUrl(f.url)) throw new DownloadError(`download host not allowed: ${f.url}`, false)
  if (await hasBlob(storeDir, f)) return

  const part = join(storeDir, '.partial', `${f.sha512}.part`)
  await mkdir(dirname(part), { recursive: true })
  let lastError: unknown

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      let have = existsSync(part) ? (await stat(part)).size : 0
      if (have > f.size) {
        await rm(part, { force: true })
        have = 0
      }
      if (have > 0) onBytes(have) // count what an earlier attempt already got

      if (have < f.size) {
        const res = await fetch(f.url, {
          headers: have > 0 ? { Range: `bytes=${have}-` } : {},
          signal: AbortSignal.timeout(timeoutMs),
        })
        if (res.status >= 400) throw new DownloadError(`HTTP ${res.status} for ${f.url}`, res.status >= 500 || res.status === 429)
        const resumed = res.status === 206
        if (!resumed && have > 0) {
          onBytes(-have) // server ignored Range: start over
          have = 0
        }
        if (!res.body) throw new DownloadError('empty response', true)
        const body = Readable.fromWeb(res.body as never)
        const limited = throttle() // Settings > Launcher > download speed limit
        limited.on('data', (chunk: Buffer) => onBytes(chunk.length))
        await pipeline(body, limited, createWriteStream(part, { flags: resumed ? 'a' : 'w' }))
      }

      const size = (await stat(part)).size
      if (size !== f.size) throw new DownloadError(`size mismatch (${size} != ${f.size})`, true)
      if ((await sha512OfFile(part)) !== f.sha512) {
        await rm(part, { force: true })
        onBytes(-size)
        throw new DownloadError(`hash mismatch for ${f.url}`, true)
      }
      const dest = blobPath(storeDir, f.sha512)
      await mkdir(dirname(dest), { recursive: true })
      await rename(part, dest)
      return
    } catch (err) {
      lastError = err
      if (err instanceof DownloadError && !err.retryable) throw err
      if (attempt < attempts) await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)))
    }
  }
  throw lastError instanceof Error ? lastError : new DownloadError(String(lastError), true)
}

/** A unique temp name next to `path` (same folder = same drive, so rename is atomic). */
export const tempNameFor = (path: string) => `${path}.${randomBytes(4).toString('hex')}.tmp`
