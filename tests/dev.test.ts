// Developer tab: locked in the installed launcher until the staff code is entered; the pretend layer.
import { scryptSync } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'

const root = mkdtempSync(join(tmpdir(), 'hemi-dev-'))
// the installed launcher
vi.mock('electron', () => ({ app: { getPath: () => root, isPackaged: true, getVersion: () => '1.0.0' }, shell: {}, nativeImage: {} }))
vi.mock('../src/main/core/game/target', () => ({ gamePaths: () => ({ root, instance: join(root, 'instance') }) }))

const dev = await import('../src/main/core/dev/devTools')
const testCode = 'HEMI-TEST-CODE-1234'
const salt = '00112233445566778899aabbccddeeff'
const feedCode = { salt, hash: scryptSync(testCode, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex') }
const feed = { schema: 1, sequence: 5, updatedAt: '2026-10-08T00:00:00.000Z', maintenance: { active: false, message: { en: 'x' } }, restart: null, news: [] } as never

describe('Developer tab in the installed launcher', () => {
  test('locked: nothing changes, switches are refused', async () => {
    expect(dev.devEnabled()).toBe(false)
    await dev.setDevState({ maintenance: true, sampleEvents: true })
    expect(dev.devFeed(feed)).toBe(feed)
    expect(dev.devStatus(null)).toBeNull()
  })

  test('a wrong code is refused, five in a row make it wait', async () => {
    for (let i = 0; i < 4; i++) expect(await dev.unlockDev('nope', feedCode)).toEqual({ ok: false, reason: 'wrong' })
    expect(await dev.unlockDev('nope', feedCode)).toMatchObject({ ok: false, reason: 'wait' })
    expect(await dev.unlockDev(testCode, feedCode)).toMatchObject({ ok: false, reason: 'wait' }) // even the right one, while waiting
    expect(dev.devEnabled()).toBe(false)
  })

  test('the built-in code isn’t a test code', async () => {
    vi.useFakeTimers({ now: Date.now() + 10 * 60_000 })
    expect(await dev.unlockDev(testCode)).toMatchObject({ ok: false })
    vi.useRealTimers()
  })

  test('the right code (here a staff code published in the feed) unlocks this PC; Lock hides it again', async () => {
    vi.useFakeTimers({ now: Date.now() + 60 * 60_000 })
    expect(await dev.unlockDev(` ${testCode.toLowerCase()} `, feedCode)).toEqual({ ok: true }) // case and spaces don't matter
    vi.useRealTimers()
    expect(dev.devEnabled()).toBe(true)
    await dev.setDevState({ maintenance: true, sampleEvents: true, extraNews: 12 })
    const f = dev.devFeed(feed)
    expect(f.maintenance.active).toBe(true)
    expect(f.events?.map((e) => e.id)).toEqual(['dev-live', 'dev-soon', 'dev-later'])
    expect(f.news).toHaveLength(12)
    await dev.lockDev()
    expect(dev.devEnabled()).toBe(false)
    expect(dev.devFeed(feed)).toBe(feed)
  })
})
