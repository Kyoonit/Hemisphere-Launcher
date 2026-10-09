import { app } from 'electron'
import { createPublicKey, verify } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CONTENT_BASE } from '@shared/manifest'
import { FeedSchema, type Feed } from '@shared/feed'
import { RESTART_SCHEDULE } from '@shared/server'
import { viewOfV1, type FeedView } from '@shared/schedule'
import { getFeedV2View, startFeedV2 } from './feedV2'
import { CONTENT_PUBLIC_KEY } from './publicKey'
import { conditionalGet, rememberEtag } from './conditional'

/**
 * News + maintenance + restart schedule. Same trust model as the client definition: signed by staff, verified with
 * the key built into the launcher, older versions refused, last good copy cached. Never blocks the launcher:
 * if nothing was ever downloaded, a built-in default (no news, standard restart time) is used.
 */

const REFRESH_MS = 10 * 60_000
const MAX_BYTES = 256 * 1024
const publicKey = createPublicKey({ key: Buffer.from(CONTENT_PUBLIC_KEY, 'base64'), format: 'der', type: 'spki' })
const cacheDir = () => join(app.getPath('userData'), 'content-cache')

export const FALLBACK_FEED: Feed = {
  schema: 1,
  sequence: 0,
  updatedAt: new Date(0).toISOString(),
  maintenance: { active: false, message: { en: '' } },
  restart: { ...RESTART_SCHEDULE },
  news: [],
}

/** Verifies signature + schema. Pure: same checks for network and cache. */
export function verifyFeed(bytes: Buffer, signatureB64: string, key = publicKey): Feed {
  if (!verify(null, bytes, key, Buffer.from(signatureB64.trim(), 'base64'))) throw new Error('feed signature is invalid')
  return FeedSchema.parse(JSON.parse(bytes.toString('utf8')))
}

async function readCached(): Promise<Feed | null> {
  try {
    return verifyFeed(await readFile(join(cacheDir(), 'feed.json')), await readFile(join(cacheDir(), 'feed.json.sig'), 'utf8'))
  } catch {
    return null
  }
}

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000), cache: 'no-store' })
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > MAX_BYTES) throw new Error(`${url}: too large`)
  return buf
}

let current: Feed = FALLBACK_FEED

/** What the launcher shows: the schema 2 feed (Herald) once one is published, else the schema 1 feed. */
/** Herald's feed once published, else this one. The mod policy is not edited in Herald (S1): this feed's applies until
 *  Herald's carries one (copied at go-live), so the blocked mods never disappear in between. */
export const getFeed = (): FeedView => {
  const v2 = getFeedV2View()
  return v2 ? { ...v2, ...(!v2.modPolicy && current.modPolicy ? { modPolicy: current.modPolicy } : {}) } : viewOfV1(current)
}

async function refresh(): Promise<Feed> {
  const cached = await readCached()
  if (cached && cached.sequence > current.sequence) current = cached
  try {
    const base = (!app.isPackaged && import.meta.env?.MAIN_VITE_CONTENT_BASE) || CONTENT_BASE
    // Unchanged since the copy we kept: nothing downloaded (the feed is checked every 10 minutes).
    const feedUrl = `${base}feed.json`
    const got = await conditionalGet(feedUrl, MAX_BYTES, cached ? (await readFile(join(cacheDir(), 'feed.json'))).length : null, 15_000)
    if (got.notModified) return current
    const bytes = got.bytes
    const sig = (await download(`${base}feed.json.sig`)).toString('utf8')
    const feed = verifyFeed(bytes, sig)
    if (feed.sequence < current.sequence) {
      console.warn(`[feed] ignoring older feed (sequence ${feed.sequence} < ${current.sequence})`)
      return current
    }
    await mkdir(cacheDir(), { recursive: true })
    for (const [name, data] of [['feed.json', bytes], ['feed.json.sig', sig]] as const) {
      await writeFile(join(cacheDir(), `${name}.tmp`), data)
      await rename(join(cacheDir(), `${name}.tmp`), join(cacheDir(), name))
    }
    current = feed
    await rememberEtag(feedUrl, got.etag)
  } catch (err) {
    console.warn('[feed] using last known feed:', err instanceof Error ? err.message : err)
  }
  return current
}

/** Loads the feeds now, then schema 1 every 10 minutes and schema 2 every 2 (feedV2.ts); `onUpdate` fires whenever
 *  what the launcher shows changes. */
export function startFeedPolling(onUpdate: (feed: FeedView) => void): void {
  let lastSequence = -1
  const tick = () =>
    void refresh().then((feed) => {
      if (feed.sequence !== lastSequence) {
        lastSequence = feed.sequence
        if (!getFeedV2View()) onUpdate(getFeed())
      }
    })
  tick()
  setInterval(tick, REFRESH_MS)
  void startFeedV2(() => onUpdate(getFeed()))
}
