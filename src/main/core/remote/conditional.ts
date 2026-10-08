import { app } from 'electron'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { savedNotModified } from '../system/network'

/**
 * GET with If-None-Match: when the file hasn't changed since the copy we kept, the server answers "304 Not Modified"
 * and nothing is downloaded again (the feed is checked every 10 minutes, the client definition every 30).
 * An ETag is only remembered once the caller has verified and saved what came with it (rememberEtag).
 */
const file = () => join(app.getPath('userData'), 'content-cache', 'etags.json')
let tags: Record<string, string> | null = null

async function load(): Promise<Record<string, string>> {
  if (!tags) tags = await readFile(file(), 'utf8').then((s) => JSON.parse(s) as Record<string, string>, () => ({}))
  return tags
}

export type ConditionalResult = { notModified: true } | { notModified: false; bytes: Buffer; etag: string | null }

/**
 * `cached` = the size of the copy on disk (null: none, so nothing to compare with). Throws on HTTP errors, and when
 * the answer is bigger than `maxBytes`.
 */
export async function conditionalGet(url: string, maxBytes: number, cached: number | null, timeoutMs = 20_000): Promise<ConditionalResult> {
  const tag = cached !== null ? (await load())[url] : undefined
  const res = await fetch(url, { headers: tag ? { 'If-None-Match': tag } : {}, signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' })
  if (res.status === 304 && cached !== null) {
    savedNotModified(cached)
    return { notModified: true }
  }
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  const bytes = Buffer.from(await res.arrayBuffer())
  if (bytes.length > maxBytes) throw new Error(`${url}: too large`)
  return { notModified: false, bytes, etag: res.headers.get('etag') }
}

/** The response was verified and saved: next time, ask "changed since this one?". */
export async function rememberEtag(url: string, etag: string | null): Promise<void> {
  const all = await load()
  if (etag) all[url] = etag
  else delete all[url]
  try {
    await mkdir(join(app.getPath('userData'), 'content-cache'), { recursive: true })
    await writeFile(`${file()}.tmp`, JSON.stringify(all))
    await rename(`${file()}.tmp`, file())
  } catch {
    /* only an optimisation */
  }
}
