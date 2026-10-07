// Phase 11: update decision and playtime recording.
import { describe, expect, test, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decideUpdate } from '../src/shared/update'

const dataDir = mkdtempSync(join(tmpdir(), 'hemi-playtime-'))
vi.mock('electron', () => ({ app: { getPath: () => dataDir, isPackaged: true } }))
const { recordSession, getPlaytime, splitByDay, localDateKey } = await import('../src/main/core/playtime/playtimeStore')

describe('decideUpdate', () => {
  const index = { latest: { clientVersion: '2.0.0', minecraft: '26.4' }, previous: { clientVersion: '1.0.1', minecraft: '26.3' } }
  test('fresh install or latest installed: plain PLAY', () => {
    expect(decideUpdate(index, null).kind).toBe('upToDate')
    expect(decideUpdate(index, { clientVersion: '2.0.0', minecraft: '26.4' }).kind).toBe('upToDate')
  })
  test('same Minecraft version: silent update', () => {
    expect(decideUpdate({ ...index, latest: { clientVersion: '1.0.2', minecraft: '26.3' } }, { clientVersion: '1.0.1', minecraft: '26.3' })).toEqual({
      kind: 'silent',
      from: '1.0.1',
      to: '1.0.2',
    })
  })
  test('new Minecraft version: update + play on previous', () => {
    expect(decideUpdate(index, { clientVersion: '1.0.1', minecraft: '26.3' })).toEqual({
      kind: 'major',
      latestMinecraft: '26.4',
      installedMinecraft: '26.3',
      canPlayPrevious: true,
    })
  })
  test('installed client older than "previous": update only', () => {
    expect(decideUpdate(index, { clientVersion: '0.9.0', minecraft: '26.2' })).toMatchObject({ kind: 'major', canPlayPrevious: false })
  })
})

describe('playtime', () => {
  const H = 3_600_000
  test('a session past midnight counts for both days', () => {
    const start = new Date(2026, 9, 7, 23, 30).getTime()
    const days = splitByDay(start, start + H)
    expect(days[localDateKey(new Date(2026, 9, 7))]).toBe(30 * 60_000)
    expect(days[localDateKey(new Date(2026, 9, 8))]).toBe(30 * 60_000)
  })
  test('records sessions; ignores crash-length and impossible ones', async () => {
    const now = Date.now()
    expect(await recordSession('acc', now - 2 * H, now - H)).toBe(true) // 1 h
    expect(await recordSession('acc', now - 30 * 60_000, now)).toBe(true) // 30 min
    expect(await recordSession('acc', now - 5_000, now)).toBe(false) // 5 s crash
    expect(await recordSession('acc', now - 30 * H, now)).toBe(false) // 30 h: bad clock / stuck process
    const p = await getPlaytime('acc')
    expect(p.sessions).toBe(2)
    expect(p.totalMs).toBe(1.5 * H)
    expect(p.lastSessionMs).toBe(30 * 60_000)
    expect(p.weekMs).toBe(1.5 * H)
    expect((await getPlaytime('someone-else')).sessions).toBe(0) // per account
  })
})
