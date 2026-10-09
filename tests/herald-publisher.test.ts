import { describe, expect, it } from 'vitest'
import { createHash, createPublicKey, generateKeyPairSync, randomBytes, verify } from 'node:crypto'
import { FeedSchema } from '../src/shared/feed'
import { fromB64, keyIdOf, seal, toB64, unseal, type SealedDocument } from '../src/shared/sealed'
import { buildRelease, errorText, type RunKey } from '../tools/herald/publisher'

const { privateKey } = generateKeyPairSync('ed25519')
const feed = {
  maintenance: { active: false, message: { en: 'ok' } },
  restart: { time: '17:00', timeZone: 'Europe/Paris', durationMin: 5 },
  news: [{ id: 'a', date: '2026-10-09', category: 'server', title: { en: 'A' }, body: { en: 'B' } }],
}
const runKey = (): RunKey => ({ id: `feed-${randomBytes(12).toString('hex')}`, key: toB64(randomBytes(32)) })

describe('Sealed files', () => {
  it('open only with their key, and any changed byte is refused', async () => {
    const key = randomBytes(32)
    const file = await seal(new TextEncoder().encode('Secret news: the build contest starts Friday'), key, 'feed-abc', 4096)
    expect(keyIdOf(file)).toBe('feed-abc')
    expect(file.length).toBeGreaterThanOrEqual(4096) // padded: the size says little
    expect(Buffer.from(file).includes('contest')).toBe(false)
    expect(new TextDecoder().decode(await unseal(file, key))).toBe('Secret news: the build contest starts Friday')
    await expect(unseal(file, randomBytes(32))).rejects.toThrow()
    const changed = Uint8Array.from(file)
    changed[changed.length - 20] ^= 1
    await expect(unseal(changed, key)).rejects.toThrow()
    expect(keyIdOf(new TextEncoder().encode('{"schema":2}'))).toBeNull()
  })
})

describe('Herald publisher', () => {
  it('schema 1 (local tests only): the feed and a signature the launcher accepts', async () => {
    const { writes } = await buildRelease({ id: 'job-1', sequence: 7, feed }, 'content', privateKey, new Date('2026-10-09T12:00:00Z'))
    expect(writes.map((f) => f.path)).toEqual(['content/feed.json', 'content/feed.json.sig'])
    const [json, sig] = writes
    expect(verify(null, json.bytes, createPublicKey(privateKey), Buffer.from(sig.bytes.toString().trim(), 'base64'))).toBe(true)
    const parsed = FeedSchema.parse(JSON.parse(json.bytes.toString()))
    expect(parsed.sequence).toBe(7)
    expect(parsed.updatedAt).toBe('2026-10-09T12:00:00.000Z')
  })

  it('the server cannot choose the schema or the sequence through the payload', async () => {
    const { writes } = await buildRelease({ id: 'job-1', sequence: 3, feed: { ...feed, schema: 99, sequence: 1000 } }, 'content', privateKey)
    const parsed = JSON.parse(writes[0].bytes.toString())
    expect(parsed.schema).toBe(1)
    expect(parsed.sequence).toBe(3)
  })

  it('refuses invalid content before signing, with a readable reason', async () => {
    let error = ''
    try {
      await buildRelease({ id: 'job-1', sequence: 1, feed: { ...feed, news: [{ ...feed.news[0], image: 'https://evil.example/x.png' }] } }, 'content', privateKey)
    } catch (err) {
      error = errorText(err)
    }
    expect(error).toMatch(/news\.0\.image: image host not allowed/)
  })

  it('refuses a content folder that could escape the repository', async () => {
    await expect(buildRelease({ id: 'job-1', sequence: 1, feed }, '../x', privateKey)).rejects.toThrow(/bad content folder/)
  })
})

describe('Herald publisher, schema 2 (sealed)', () => {
  const v2 = { news: [], maintenances: [], restart: null, events: [], banners: [], welcome: [], backgrounds: [], vaultKeys: {} }
  const file = Buffer.from('sealed bytes')
  const sha = createHash('sha512').update(file).digest('hex')
  const vault = { id: 'v-1', kind: 'news', opensAt: '2026-10-20T16:00:00Z', file: { path: 'v2/vaults/v-1.bin', sha512: sha, size: file.length }, plainSha256: 'b'.repeat(64) }

  it('writes only sealed files: the feed opens with the run key, its signature covers the plaintext', async () => {
    const key = runKey()
    const news = { id: 'n-aaaaaaaaaaaa', date: '2026-10-09', category: 'event', title: { en: 'Secret build contest' }, body: { en: 'Friday at 20:00' }, showFrom: '2026-10-09T10:00:00Z' }
    const { writes } = await buildRelease({ id: 'j', sequence: 2, schema: 2, feed: { ...v2, news: [news], vaults: [vault] }, files: [{ path: 'v2/vaults/v-1.bin', b64: file.toString('base64'), sha512: sha }], seal: { feed: key } }, 'content', privateKey)
    expect(writes.map((f) => f.path)).toEqual(['content/v2/feed.bin', 'content/v2/vaults/v-1.bin'])
    const sealed = writes[0].bytes
    // Nothing of it can be read without the key
    for (const word of ['Secret', 'contest', 'Friday', 'v2/vaults', 'opensAt', '"news"']) expect(sealed.includes(word)).toBe(false)
    expect(keyIdOf(new Uint8Array(sealed))).toBe(key.id)
    const doc = JSON.parse(new TextDecoder().decode(await unseal(new Uint8Array(sealed), fromB64(key.key)))) as SealedDocument
    expect(verify(null, Buffer.from(doc.doc), createPublicKey(privateKey), Buffer.from(doc.sig, 'base64'))).toBe(true)
    const opened = JSON.parse(doc.doc)
    expect(opened.schema).toBe(2)
    expect(opened.news[0].title.en).toBe('Secret build contest')
  })

  it('refuses to publish without the run key, and a file the signed feed does not list byte for byte', async () => {
    await expect(buildRelease({ id: 'j', sequence: 2, schema: 2, feed: { ...v2, vaults: [] } }, 'content', privateKey)).rejects.toThrow(/no key/)
    const other = Buffer.from('something else')
    await expect(buildRelease({ id: 'j', sequence: 2, schema: 2, feed: { ...v2, vaults: [vault] }, files: [{ path: 'v2/vaults/v-1.bin', b64: other.toString('base64'), sha512: sha }], seal: { feed: runKey() } }, 'content', privateKey)).rejects.toThrow(/not listed/)
    await expect(buildRelease({ id: 'j', sequence: 2, schema: 2, feed: { ...v2, vaults: [] }, files: [{ path: 'v2/vaults/v-1.bin', b64: file.toString('base64'), sha512: sha }], seal: { feed: runKey() } }, 'content', privateKey)).rejects.toThrow(/not listed/)
  })
})
