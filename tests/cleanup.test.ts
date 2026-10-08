import { existsSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const root = mkdtempSync(join(tmpdir(), 'hemi-clean-'))
vi.mock('electron', () => ({ app: { getPath: () => root, getVersion: () => '1.0.0', isPackaged: false } }))
vi.mock('../src/main/core/game/target', () => ({
  gamePaths: () => ({ root, minecraft: join(root, 'minecraft'), instance: join(root, 'instance'), stateFile: join(root, 'install-state.json') }),
}))
vi.mock('../src/main/core/logging/logger', () => ({ launcherLogDir: () => join(root, 'logs') }))
vi.mock('../src/main/core/remote/content', () => ({ getContent: async () => ({ manifest: { minecraft: '26.3' }, index: { previous: { minecraft: '26.2' } } }) }))

const { runCleanup, scanCleanup } = await import('../src/main/core/system/cleanup')

const put = (rel: string, bytes: number, daysOld = 0) => {
  const p = join(root, rel)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, Buffer.alloc(bytes))
  const t = (Date.now() - daysOld * 24 * 60 * 60_000) / 1000
  utimesSync(p, t, t)
  return p
}

describe('free up space', () => {
  it('finds only what can go, and never touches worlds, screenshots, mods or recent files', async () => {
    writeFileSync(join(root, 'install-state.json'), JSON.stringify({ minecraft: '26.3', versionId: '26.3-fabric0.19.5' }))
    const keep = [
      put('instance/logs/latest.log', 10, 30),
      put('instance/logs/2026-10-08-1.log.gz', 10, 1), // recent
      put('instance/crash-reports/crash-new.txt', 10, 3),
      put('instance/saves/world/level.dat', 10, 90),
      put('instance/screenshots/a.png', 10, 90),
      put('instance/mods/sodium.jar', 10, 90),
      put('logs/launcher.log', 10, 30),
      put('minecraft/versions/26.3/26.3.jar', 10, 90),
      put('minecraft/versions/26.3-fabric0.19.5/26.3-fabric0.19.5.json', 10, 90), // the installed Fabric profile
      put('minecraft/versions/fabric-loader-0.17.2-26.3/x.json', 10, 90),
      put('minecraft/versions/26.2/26.2.jar', 10, 90), // previous client
    ]
    const go = [
      put('instance/logs/2026-09-01-1.log.gz', 100, 30),
      put('logs/launcher.old.log', 100, 30),
      put('instance/crash-reports/crash-old.txt', 100, 60),
      put('instance/hs_err_pid123.log', 100, 10),
      put('store/.partial/abc.part', 100, 0),
      put('minecraft/versions/26.1/26.1.jar', 100, 90),
    ]
    const scan = await scanCleanup()
    expect(scan.categories.logs.items).toBe(2)
    expect(scan.categories.crashes.items).toBe(2)
    expect(scan.categories.downloads.items).toBe(1)
    expect(scan.categories.versions.items).toBe(1)
    expect(scan.totalBytes).toBe(600)
    expect(await runCleanup()).toBe(600)
    for (const p of go) expect(existsSync(p), p).toBe(false)
    for (const p of keep) expect(existsSync(p), p).toBe(true)
    expect((await scanCleanup()).totalBytes).toBe(0)
  })
})
