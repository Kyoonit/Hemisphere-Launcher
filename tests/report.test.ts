// Phase 24: problem reports (private details removed, quick look, Discord message, the zip itself).
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'

const root = mkdtempSync(join(tmpdir(), 'hemi-report-'))
vi.mock('electron', () => ({
  app: { getPath: () => root, getVersion: () => '1.0.0', isPackaged: false },
  shell: {},
  clipboard: { writeText: () => {} },
  nativeImage: {},
  safeStorage: { isEncryptionAvailable: () => false },
  protocol: {},
  ClipboardItem: class {},
  net: {},
}))
vi.mock('../src/main/core/game/target', () => ({ gamePaths: () => ({ root, instance: join(root, 'instance') }) }))

const { scrub, quickLook, discordMessage } = await import('../src/main/core/support/report')
const { ZipWriter } = await import('../src/main/core/support/zipWriter')
const { readZipEntry } = await import('../src/main/core/packs/zip')

const privacy = { home: 'C:\\Users\\Valentin', user: 'Valentin', names: ['AltAccount'], removeChat: true }

describe('private details', () => {
  test('home folder, Windows name, tokens, e-mail, IPs, other accounts and chat are removed', () => {
    const log = [
      '[21:14:03] [Render thread/INFO]: Loading C:\\Users\\Valentin\\AppData\\Roaming\\.minecraft and C:/Users/Valentin/x',
      'Setting user: Kyo (AltAccount was used before)',
      'accessToken=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop',
      'contact valentin.dupont@gmail.com, connecting to /82.65.10.200 then 82.65.10.201:25565, local 127.0.0.1',
      'Loading BetterAdvancements 0.6.0.78 and lib 1.20.4.1',
      '[21:15:00] [Render thread/INFO]: [System] [CHAT] <Steve> my secret base is at 100 64 -200',
      'Windows user Valentin logged in',
    ].join('\n')
    const out = scrub(log, privacy)
    expect(out).toContain('%USERPROFILE%\\AppData\\Roaming')
    expect(out).toContain('%USERPROFILE%/x')
    expect(out).not.toMatch(/Valentin/i)
    expect(out).toContain('Kyo') // the player's own name stays: staff need it
    expect(out).toContain('<other-account>')
    expect(out).not.toContain('eyJhbGci')
    expect(out).toContain('<e-mail>')
    expect(out).toContain('<ip>')
    expect(out).toContain('127.0.0.1')
    expect(out).not.toContain('82.65.10.20')
    expect(out).toContain('0.6.0.78') // a version, not an address
    expect(out).toContain('1.20.4.1')
    expect(out).toContain('[CHAT] (message removed)')
    expect(out).not.toContain('secret base')
  })
  test('chat stays when the player chooses so', () => {
    expect(scrub('[CHAT] <Steve> hi', { ...privacy, removeChat: false })).toContain('<Steve> hi')
  })
})

describe('quick look', () => {
  const base = {
    logText: '',
    crashTexts: [],
    memoryMb: 4096,
    recommendedMb: 4096,
    totalMb: 16384,
    customJava: null,
    jvmArgs: [],
    mods: null,
    history: [],
    freeGb: 50,
    hybridGpu: false,
    highPerformanceGpu: true,
    shadersOn: false,
    irisOn: true,
    server: null,
    lang: 'en',
  }
  test('nothing unusual', () => expect(quickLook(base)).toEqual(['Nothing unusual found automatically.']))
  test('spots the usual causes', () => {
    const out = quickLook({
      ...base,
      memoryMb: 2048,
      logText: "Exception in thread: java.lang.OutOfMemoryError: Java heap space\n - Mod 'Jade' (jade) 26.3.5 requires version 26.4 of minecraft, but only the wrong version is present: 26.3!\nMixin apply for mod sodium failed",
      crashTexts: [{ name: 'crash-2026-10-08_21.14.03-client.txt', mtimeMs: Date.now(), text: 'Description: Rendering overlay\njava.lang.NullPointerException: x\nprovided by \'sodium\'' }],
      history: [{ id: 'a', at: Date.now() - 3600_000, kind: 'version', name: 'Sodium', projectId: 'x', from: '0.7', to: '0.6', fromVersionId: null, toVersionId: null }],
      freeGb: 0.8,
      hybridGpu: true,
      highPerformanceGpu: false,
      shadersOn: true,
      irisOn: false,
      server: { online: false, latencyMs: null },
    })
    const all = out.join('\n')
    expect(all).toContain('Crash report')
    expect(all).toContain('Rendering overlay — java.lang.NullPointerException')
    expect(all).toContain('Out of memory: Minecraft had 2048 MB')
    expect(all).toContain('Fabric refused Jade 26.3.5: needs minecraft 26.4')
    expect(all).toContain('sodium')
    expect(all).toContain('Changed in the last 24 h: Sodium 0.7 → 0.6 (version)')
    expect(all).toContain('Low disk space')
    expect(all).toContain('two graphics chips')
    expect(all).toContain('Iris is off')
    expect(all).toContain('OFFLINE')
  })
})

describe('Discord message', () => {
  const x = {
    id: 'HR-ABC234',
    player: 'Kyo',
    launcherVersion: '1.0.0',
    client: { clientVersion: '1.0.2', minecraft: '26.3' },
    java: '21.0.5',
    gpu: 'RTX 3080',
    totalMb: 32768,
    look: ['Out of memory'],
    zipName: 'Hemisphere report HR-ABC234.zip',
  }
  const d = { category: 'crash' as const, title: 'Crash on inventory', description: 'It crashes', expected: '', steps: '', when: 'now' as const, frequency: 'always' as const, discord: 'kyo_99' }
  test('has the essentials', () => {
    const m = discordMessage({ ...x, d })
    for (const s of ['HR-ABC234', 'Crash on inventory', 'Kyo', 'kyo_99', 'every time', 'client 1.0.2', 'Out of memory', 'Hemisphere report HR-ABC234.zip']) expect(m).toContain(s)
  })
  test('never longer than Discord allows', () => {
    const m = discordMessage({ ...x, d: { ...d, description: 'x'.repeat(4000), steps: 'y'.repeat(2000) } })
    expect(m.length).toBeLessThanOrEqual(2000)
    expect(m).toContain('README.txt')
  })
})

describe('zip', () => {
  test('files written can be read back (stored and deflated)', async () => {
    const z = new ZipWriter()
    z.add('Report/README.txt', 'hello '.repeat(200))
    z.add('Report/tiny.txt', 'a')
    z.add('Report/README.txt', 'duplicate is ignored')
    const file = join(root, 'r.zip')
    writeFileSync(file, z.toBuffer())
    expect((await readZipEntry(file, 'Report/README.txt'))!.toString()).toBe('hello '.repeat(200))
    expect((await readZipEntry(file, 'Report/tiny.txt'))!.toString()).toBe('a')
    expect(z.files).toEqual(['Report/README.txt', 'Report/tiny.txt'])
  })
})
