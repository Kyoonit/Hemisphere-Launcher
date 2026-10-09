import { describe, expect, it } from 'vitest'
import { createHash, createPublicKey, generateKeyPairSync, verify } from 'node:crypto'
import { FeedSchema } from '../src/shared/feed'
import { buildRelease, errorText } from '../tools/herald/publisher'

const { privateKey } = generateKeyPairSync('ed25519')
const feed = {
  maintenance: { active: false, message: { en: 'ok' } },
  restart: { time: '17:00', timeZone: 'Europe/Paris', durationMin: 5 },
  news: [{ id: 'a', date: '2026-10-09', category: 'server', title: { en: 'A' }, body: { en: 'B' } }],
}

describe('Herald publisher', () => {
  it('writes the feed and a signature the launcher accepts', () => {
    const files = buildRelease({ id: 'job-1', sequence: 7, feed }, 'content', privateKey, new Date('2026-10-09T12:00:00Z'))
    expect(files.map((f) => f.path)).toEqual(['content/feed.json', 'content/feed.json.sig'])
    const [json, sig] = files
    expect(verify(null, json.bytes, createPublicKey(privateKey), Buffer.from(sig.bytes.toString().trim(), 'base64'))).toBe(true)
    const parsed = FeedSchema.parse(JSON.parse(json.bytes.toString()))
    expect(parsed.sequence).toBe(7)
    expect(parsed.updatedAt).toBe('2026-10-09T12:00:00.000Z')
  })

  it('the server cannot choose the schema or the sequence through the payload', () => {
    const [json] = buildRelease({ id: 'job-1', sequence: 3, feed: { ...feed, schema: 99, sequence: 1000 } }, 'content', privateKey)
    const parsed = JSON.parse(json.bytes.toString())
    expect(parsed.schema).toBe(1)
    expect(parsed.sequence).toBe(3)
  })

  it('refuses invalid content before signing, with a readable reason', () => {
    let error = ''
    try {
      buildRelease({ id: 'job-1', sequence: 1, feed: { ...feed, news: [{ ...feed.news[0], image: 'https://evil.example/x.png' }] } }, 'content', privateKey)
    } catch (err) {
      error = errorText(err)
    }
    expect(error).toMatch(/news\.0\.image: image host not allowed/)
  })

  it('refuses a content folder that could escape the repository', () => {
    expect(() => buildRelease({ id: 'job-1', sequence: 1, feed }, '../x', privateKey)).toThrow(/bad content folder/)
  })
})

describe('Herald publisher, schema 2', () => {
  const v2 = { news: [], maintenances: [], restart: null, events: [], banners: [], welcome: [], backgrounds: [], vaultKeys: {} }
  const file = Buffer.from('sealed bytes')
  const sha = createHash('sha512').update(file).digest('hex')
  const vault = { id: 'v-1', kind: 'news', opensAt: '2026-10-20T16:00:00Z', file: { path: 'v2/vaults/v-1.bin', sha512: sha, size: file.length }, plainSha256: 'b'.repeat(64) }

  it('writes v2/feed.json, its signature and the vault files listed in the feed', () => {
    const out = buildRelease({ id: 'j', sequence: 2, schema: 2, feed: { ...v2, vaults: [vault] }, files: [{ path: 'v2/vaults/v-1.bin', b64: file.toString('base64'), sha512: sha }] }, 'content', privateKey)
    expect(out.map((f) => f.path)).toEqual(['content/v2/feed.json', 'content/v2/feed.json.sig', 'content/v2/vaults/v-1.bin'])
    expect(verify(null, out[0].bytes, createPublicKey(privateKey), Buffer.from(out[1].bytes.toString().trim(), 'base64'))).toBe(true)
    expect(JSON.parse(out[0].bytes.toString()).schema).toBe(2)
  })

  it('refuses a file the signed feed does not list byte for byte', () => {
    const other = Buffer.from('something else')
    expect(() => buildRelease({ id: 'j', sequence: 2, schema: 2, feed: { ...v2, vaults: [vault] }, files: [{ path: 'v2/vaults/v-1.bin', b64: other.toString('base64'), sha512: sha }] }, 'content', privateKey)).toThrow(/not listed/)
    expect(() => buildRelease({ id: 'j', sequence: 2, schema: 2, feed: { ...v2, vaults: [] }, files: [{ path: 'v2/vaults/v-1.bin', b64: file.toString('base64'), sha512: sha }] }, 'content', privateKey)).toThrow(/not listed/)
  })
})
