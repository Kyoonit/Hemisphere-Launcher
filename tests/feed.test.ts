// Phase 12: signed feed (news, maintenance, restart schedule).
import { describe, expect, test, vi } from 'vitest'
import { generateKeyPairSync, sign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FeedSchema, isAllowedImageUrl } from '../src/shared/feed'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', isPackaged: true } }))
const { verifyFeed } = await import('../src/main/core/remote/feed')

const base = {
  schema: 1,
  sequence: 1,
  updatedAt: new Date().toISOString(),
  maintenance: { active: false, message: { en: 'Down' } },
  restart: { time: '17:00', timeZone: 'Europe/Paris', durationMin: 5 },
  news: [{ id: 'a', date: '2026-10-08', category: 'update', title: { en: 'A' }, body: { en: 'Body' } }],
}

describe('FeedSchema', () => {
  test('accepts a valid feed (and no restart at all)', () => {
    expect(FeedSchema.safeParse(base).success).toBe(true)
    expect(FeedSchema.safeParse({ ...base, restart: null }).success).toBe(true)
  })
  test.each([
    ['unknown time zone', { ...base, restart: { ...base.restart, timeZone: 'Mars/Olympus' } }],
    ['bad time', { ...base, restart: { ...base.restart, time: '25:00' } }],
    ['duplicate news id', { ...base, news: [base.news[0], base.news[0]] }],
    ['image from another site', { ...base, news: [{ ...base.news[0], image: 'https://evil.example/x.png' }] }],
    ['non-https link', { ...base, news: [{ ...base.news[0], link: { label: { en: 'x' }, url: 'http://example.com' } }] }],
    ['javascript: link', { ...base, news: [{ ...base.news[0], link: { label: { en: 'x' }, url: 'javascript:alert(1)' } }] }],
  ])('rejects %s', (_name, feed) => expect(FeedSchema.safeParse(feed).success).toBe(false))
})

test('image hosts: website and our content folder only', () => {
  expect(isAllowedImageUrl('https://hemispheresurvival.club/images/a.png')).toBe(true)
  expect(isAllowedImageUrl('https://raw.githubusercontent.com/Kyoonit/Hemisphere-Launcher/main/content/news/images/a.png')).toBe(true)
  expect(isAllowedImageUrl('https://raw.githubusercontent.com/other/repo/main/a.png')).toBe(false)
  expect(isAllowedImageUrl('http://hemispheresurvival.club/a.png')).toBe(false)
})

describe('verifyFeed', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const bytes = Buffer.from(JSON.stringify(base))
  const sig = sign(null, bytes, privateKey).toString('base64')
  test('accepts a correctly signed feed', () => expect(verifyFeed(bytes, sig, publicKey).news).toHaveLength(1))
  test('rejects a modified feed (e.g. fake maintenance)', () => {
    const tampered = Buffer.from(bytes.toString().replace('"active":false', '"active":true '))
    expect(() => verifyFeed(tampered, sig, publicKey)).toThrow(/signature/)
  })
})

test('the published content/feed.json verifies with the key built into the launcher', () => {
  const dir = join(__dirname, '..', 'content')
  const feed = verifyFeed(readFileSync(join(dir, 'feed.json')), readFileSync(join(dir, 'feed.json.sig'), 'utf8'))
  expect(feed.restart?.timeZone).toBe('Europe/Paris')
  expect(feed.news.length).toBeGreaterThan(0)
})
