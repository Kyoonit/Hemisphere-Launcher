import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const root = mkdtempSync(join(tmpdir(), 'hemi-net-'))
let limit = 0
vi.mock('electron', () => ({ app: { getPath: (k: string) => join(root, k), getVersion: () => '1.0.0' } }))
vi.mock('../src/main/core/settings/settings', () => ({ getSettings: () => ({ downloadLimit: limit, saveDataOnMetered: true }) }))

const net = await import('../src/main/core/system/network')
const { conditionalGet, rememberEtag } = await import('../src/main/core/remote/conditional')
const { reuseAssets } = await import('../src/main/core/game/reuseAssets')

const realFetch = globalThis.fetch
afterAll(() => {
  globalThis.fetch = realFetch
})

describe('download speed limit', () => {
  beforeEach(() => {
    limit = 0
  })
  const drain = async (bytes: number) => {
    let got = 0
    const started = Date.now()
    await pipeline(
      Readable.from([Buffer.alloc(bytes)]),
      net.throttle(),
      new Writable({
        write(c: Buffer, _e, cb) {
          got += c.length
          cb()
        },
      }),
    )
    return { got, ms: Date.now() - started }
  }
  it('passes everything straight through without a limit', async () => {
    const { got, ms } = await drain(8 * 1024 * 1024)
    expect(got).toBe(8 * 1024 * 1024)
    expect(ms).toBeLessThan(500)
  })
  it('slows a download down to the limit (2 MB/s: 1 MB takes about half a second)', async () => {
    limit = 2
    await new Promise((r) => setTimeout(r, 300)) // let the budget fill like after a pause
    const { got, ms } = await drain(1.5 * 1024 * 1024)
    expect(got).toBe(1.5 * 1024 * 1024)
    expect(ms).toBeGreaterThan(400)
  })
  it('fewer Minecraft files at once with a limit', () => {
    expect(net.xmclConcurrency().assetsDownloadConcurrency).toBe(16)
    limit = 5
    expect(net.xmclConcurrency().assetsDownloadConcurrency).toBe(4)
  })
})

describe('conditional downloads', () => {
  it('sends the remembered ETag only when a copy is kept, and counts what a 304 saved', async () => {
    const seen: (string | null)[] = []
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const tag = new Headers(init?.headers).get('if-none-match')
      seen.push(tag)
      return tag === '"v1"' ? new Response(null, { status: 304 }) : new Response('hello', { status: 200, headers: { etag: '"v1"' } })
    }) as typeof fetch
    const first = await conditionalGet('https://x.test/feed.json', 1000, null)
    expect(first.notModified).toBe(false)
    if (!first.notModified) await rememberEtag('https://x.test/feed.json', first.etag)
    const before = net.networkSavings().notModified
    expect((await conditionalGet('https://x.test/feed.json', 1000, 5)).notModified).toBe(true)
    // no copy on disk: the ETag isn't sent, the file comes in full
    expect((await conditionalGet('https://x.test/feed.json', 1000, null)).notModified).toBe(false)
    expect(seen).toEqual([null, '"v1"', null])
    expect(net.networkSavings().notModified).toBe(before + 1)
  })
  it('refuses an answer bigger than allowed', async () => {
    globalThis.fetch = (async () => new Response('x'.repeat(50))) as typeof fetch
    await expect(conditionalGet('https://x.test/big', 10, null)).rejects.toThrow(/too large/)
  })
})

describe('reusing another launcher’s Minecraft assets', () => {
  it('takes only files whose size matches the official index, and writes the index', async () => {
    const official = join(root, 'appData', '.minecraft', 'assets')
    const ours = join(root, 'game')
    const file = (content: string) => ({ hash: createHash('sha1').update(content).digest('hex'), size: content.length, content })
    const a = file('sound-a')
    const b = file('lang-b')
    for (const f of [a, b]) {
      mkdirSync(join(official, 'objects', f.hash.slice(0, 2)), { recursive: true })
      writeFileSync(join(official, 'objects', f.hash.slice(0, 2), f.hash), f === b ? 'truncated' : f.content)
    }
    const index = JSON.stringify({ objects: { 'a.ogg': { hash: a.hash, size: a.size }, 'b.json': { hash: b.hash, size: b.size } } })
    const indexSha1 = createHash('sha1').update(index).digest('hex')
    mkdirSync(join(official, 'indexes'), { recursive: true })
    writeFileSync(join(official, 'indexes', '29.json'), index)
    globalThis.fetch = (async () => new Response(JSON.stringify({ assetIndex: { id: '29', url: 'https://x.test/29.json', sha1: indexSha1 } }))) as typeof fetch
    const mc = {
      getAssetsIndex: (id: string) => join(ours, 'assets', 'indexes', `${id}.json`),
      getAsset: (hash: string) => join(ours, 'assets', 'objects', hash.slice(0, 2), hash),
    }
    const before = net.networkSavings().reusedFiles
    await reuseAssets('https://x.test/version.json', mc as never)
    expect(readFileSync(mc.getAsset(a.hash), 'utf8')).toBe('sound-a')
    expect(existsSync(mc.getAsset(b.hash))).toBe(false) // wrong size: downloaded as usual
    expect(readFileSync(mc.getAssetsIndex('29'), 'utf8')).toBe(index)
    expect(net.networkSavings().reusedFiles).toBe(before + 1)
  })
})
