import { describe, expect, it } from 'vitest'
import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto'
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
