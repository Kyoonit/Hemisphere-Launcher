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

  test('like Windows: each wrong code waits longer, and nothing is tried while waiting', async () => {
    vi.useFakeTimers({ now: Date.now() })
    expect(await dev.unlockDev('nope', feedCode)).toEqual({ ok: false, reason: 'wrong', seconds: 3 })
    expect(await dev.unlockDev(testCode, feedCode)).toMatchObject({ ok: false, reason: 'wait' }) // even the right one, while waiting
    expect(dev.unlockWait()).toBe(3)
    vi.advanceTimersByTime(3000)
    expect(await dev.unlockDev('nope', feedCode)).toEqual({ ok: false, reason: 'wrong', seconds: 5 })
    vi.advanceTimersByTime(5000)
    expect(await dev.unlockDev('nope', feedCode)).toEqual({ ok: false, reason: 'wrong', seconds: 10 })
    vi.advanceTimersByTime(10_000)
    for (const s of [30, 60, 120, 300, 300]) {
      expect(await dev.unlockDev('nope', feedCode)).toEqual({ ok: false, reason: 'wrong', seconds: s })
      vi.advanceTimersByTime(s * 1000)
    }
    vi.useRealTimers()
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

  test('a new staff code (a leaked one replaced) locks every PC unlocked with the old one', async () => {
    vi.useFakeTimers({ now: Date.now() + 2 * 60 * 60_000 })
    expect(await dev.unlockDev(testCode, feedCode)).toEqual({ ok: true })
    vi.useRealTimers()
    // same code in the feed: stays unlocked
    expect(await dev.lockIfCodeChanged(feedCode)).toBe(false)
    expect(dev.devUnlocked()).toBe(true)
    // the staff made a new code: locked, the switches off, and the PC says why
    await dev.setDevState({ maintenance: true })
    const other = { salt, hash: scryptSync('HEMI-NEW-CODE-5678', salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex') }
    expect(await dev.lockIfCodeChanged(other)).toBe(true)
    expect(dev.devUnlocked()).toBe(false)
    expect(dev.devCodeChanged()).toBe(true)
    expect(dev.devFeed(feed)).toBe(feed)
    expect(await dev.lockIfCodeChanged(other)).toBe(false) // already locked
    // the old code no longer opens it, the new one does (and clears the message)
    vi.useFakeTimers({ now: Date.now() + 3 * 60 * 60_000 })
    expect(await dev.unlockDev(testCode, other)).toMatchObject({ ok: false, reason: 'wrong' })
    vi.advanceTimersByTime(10_000)
    expect(await dev.unlockDev('HEMI-NEW-CODE-5678', other)).toEqual({ ok: true })
    vi.useRealTimers()
    expect(dev.devCodeChanged()).toBe(false)
    // back to the built-in code: locked again too
    expect(await dev.lockIfCodeChanged(undefined)).toBe(true)
  })

  test('a PC unlocked by an older launcher (code not remembered) is locked once, then needs the code', async () => {
    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(root, 'dev-tools.json'), JSON.stringify({ unlocked: true }))
    vi.resetModules()
    const fresh = await import('../src/main/core/dev/devTools')
    expect(fresh.devUnlocked()).toBe(true)
    expect(await fresh.lockIfCodeChanged(feedCode)).toBe(true)
    expect(fresh.devUnlocked()).toBe(false)
  })
})
