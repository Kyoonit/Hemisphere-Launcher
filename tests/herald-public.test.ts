import { describe, expect, it } from 'vitest'
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { DEFAULT_PUBLIC, PublicSettingsSchema, staffCodeFrom, STAFF_CODE_ALPHABET } from '../src/shared/heraldPublic'
import { STAFF_CODE_SCRYPT } from '../src/shared/dev'
import { clearFeed, DEFAULT_FEED_BASE, feedDraft } from '../src/shared/heraldPublications'
import { FeedV2Schema } from '../src/shared/feedV2'
import { resolveFeed } from '../src/shared/schedule'

describe('Herald launcher settings', () => {
  it('a staff code made in Herald looks like npm run staff-code, and the launcher check accepts it', () => {
    const code = staffCodeFrom(randomBytes(12))
    expect(code).toMatch(new RegExp(`^HEMI-[${STAFF_CODE_ALPHABET}]{4}-[${STAFF_CODE_ALPHABET}]{4}-[${STAFF_CODE_ALPHABET}]{4}$`))
    const salt = randomBytes(16).toString('hex')
    const { N, r, p, keylen } = STAFF_CODE_SCRYPT
    const hash = scryptSync(code, salt, keylen, { N, r, p }).toString('hex')
    // what the launcher does (src/main/core/dev/devTools.ts): the typed code, trimmed and upper case
    const typed = ` ${code.toLowerCase()} `.trim().toUpperCase()
    expect(timingSafeEqual(scryptSync(typed, salt, keylen, { N, r, p }), Buffer.from(hash, 'hex'))).toBe(true)
    expect(PublicSettingsSchema.parse({ ...DEFAULT_PUBLIC, staffCode: { salt, hash } }).staffCode).toEqual({ salt, hash })
  })

  it('only Discord links for support, a real-looking Discord id', () => {
    expect(PublicSettingsSchema.safeParse({ support: { url: 'https://discord.com/channels/1/2' } }).success).toBe(true)
    expect(PublicSettingsSchema.safeParse({ support: { url: 'https://evil.example/ticket' } }).success).toBe(false)
    expect(PublicSettingsSchema.safeParse({ discordAppId: '123' }).success).toBe(false)
  })

  it('the settings reach the feed and the launcher view', () => {
    const settings = { ...DEFAULT_PUBLIC, support: { url: 'https://discord.gg/hemisphere', howTo: { en: '#support → Create ticket' } } }
    const now = Date.parse('2026-10-09T10:00:00Z')
    const feed = clearFeed({ ...feedDraft([], DEFAULT_FEED_BASE({ time: '17:00', timeZone: 'Europe/Paris', durationMin: 5 }), now), ...settings })
    expect(() => FeedV2Schema.parse(feed)).not.toThrow()
    const view = resolveFeed(feed, {}, now, 'en')
    expect(view.support?.url).toBe('https://discord.gg/hemisphere')
    expect(view.discordAppId).toBe('1557889951620931644')
  })
})
