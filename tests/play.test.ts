// Phase 11: update decision, playtime recording, whitelist API (server + launcher client).
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decideUpdate } from '../src/shared/update'

const dataDir = mkdtempSync(join(tmpdir(), 'hemi-playtime-'))
vi.mock('electron', () => ({ app: { getPath: () => dataDir, isPackaged: true } }))
const { recordSession, getPlaytime, splitByDay, localDateKey } = await import('../src/main/core/playtime/playtimeStore')
const { checkWhitelist } = await import('../src/main/core/hemisphere-api/whitelist')

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

describe('whitelist API', () => {
  let server: ChildProcess
  const port = 18787
  const base = `http://127.0.0.1:${port}`
  const whitelisted = '358be223-3a14-4f16-a3c0-3afa849d9a70'

  beforeAll(async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'hemi-wl-')), 'whitelist.json')
    writeFileSync(file, JSON.stringify([{ uuid: whitelisted, name: 'nic5999' }]))
    server = spawn(process.execPath, [join(__dirname, '..', 'server', 'whitelist-api', 'server.mjs')], {
      env: { ...process.env, WHITELIST_PATH: file, PORT: String(port) },
      stdio: 'ignore',
    })
    for (let i = 0; i < 50; i++) {
      if (await fetch(`${base}/health`).then((r) => r.ok).catch(() => false)) return
      await new Promise((r) => setTimeout(r, 100))
    }
    throw new Error('whitelist server did not start')
  })
  afterAll(() => {
    server.kill()
  })

  test('answers yes / no, with or without dashes', async () => {
    expect(await (await fetch(`${base}/v1/whitelist/${whitelisted}`)).json()).toEqual({ whitelisted: true })
    expect(await (await fetch(`${base}/v1/whitelist/${whitelisted.replace(/-/g, '').toUpperCase()}`)).json()).toEqual({ whitelisted: true })
    expect(await (await fetch(`${base}/v1/whitelist/00000000000000000000000000000001`)).json()).toEqual({ whitelisted: false })
  })
  test('rejects anything else', async () => {
    expect((await fetch(`${base}/v1/whitelist/not-a-uuid`)).status).toBe(404)
    expect((await fetch(`${base}/v1/whitelist/${whitelisted}`, { method: 'POST' })).status).toBe(405)
    expect((await fetch(`${base}/../../etc/passwd`)).status).toBe(404)
  })
  test('launcher client: yes, no, and "unknown" when the service is down', async () => {
    expect(await checkWhitelist(whitelisted.replace(/-/g, ''), base)).toBe(true)
    expect(await checkWhitelist('00000000000000000000000000000002', base)).toBe(false)
    expect(await checkWhitelist('00000000000000000000000000000003', 'http://127.0.0.1:1')).toBe(null)
  })
  test('rate limit: 60 requests per minute per client', async () => {
    const results = await Promise.all(Array.from({ length: 70 }, () => fetch(`${base}/health`, { headers: { 'cf-connecting-ip': '203.0.113.9' } }).then((r) => r.status)))
    expect(results.filter((s) => s === 429).length).toBeGreaterThan(0)
  })
})
