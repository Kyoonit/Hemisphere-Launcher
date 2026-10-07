// Phase 13: JVM argument filter, log redaction, moving the game folder.
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseJvmArgs } from '../src/shared/settings'

const userData = mkdtempSync(join(tmpdir(), 'hemi-userdata-'))
vi.mock('electron', () => ({
  app: { getPath: () => userData, isPackaged: true, getVersion: () => '0.0.0-test', setLoginItemSettings: () => {} },
  shell: { openPath: async () => '' },
  clipboard: { writeText: () => {} },
}))
const { redact } = await import('../src/main/core/logging/logger')
const { moveGameFolder } = await import('../src/main/core/system/system')
const { getSettings } = await import('../src/main/core/settings/settings')

describe('parseJvmArgs', () => {
  test('accepts memory/GC tuning and system properties', () => {
    expect(parseJvmArgs('-XX:+UseZGC -XX:MaxGCPauseMillis=50 -Xss4M -Dfile.encoding=UTF-8').invalid).toEqual([])
  })
  test.each(['-javaagent:evil.jar', '-cp', 'C:\\x.jar', '--add-opens', '"-Xmx4G"', '-XX:OnOutOfMemoryError="calc.exe"', '&&', 'calc'])('refuses %s', (a) => {
    expect(parseJvmArgs(`-Xmx4G ${a}`).invalid).toContain(a)
  })
})

describe('redact', () => {
  test('masks tokens that might ever reach a log line', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
    expect(redact(`token ${jwt}`)).toBe('token [token]')
    expect(redact('{"access_token":"abc.def.ghi"}')).toContain('[token]')
    expect(redact('refresh_token=M.R3_BAY.CRAzYlongValue123456789')).not.toContain('CRAzY')
    expect(redact('Loading 94 mods')).toBe('Loading 94 mods')
  })
})

describe('moveGameFolder', () => {
  const fill = (dir: string) => {
    mkdirSync(join(dir, 'instance', 'mods'), { recursive: true })
    writeFileSync(join(dir, 'instance', 'mods', 'sodium.jar'), 'jar')
    mkdirSync(join(dir, 'minecraft', 'versions'), { recursive: true })
    writeFileSync(join(dir, 'install-state.json'), '{}')
  }
  beforeEach(() => fill(userData))

  test('moves the game files there and back; launcher data stays', async () => {
    writeFileSync(join(userData, 'accounts.json'), '{}')
    const target = join(mkdtempSync(join(tmpdir(), 'hemi-move-')), 'Hemisphere')
    expect(await moveGameFolder(target, false)).toEqual({ ok: true, gameDir: target })
    expect(readFileSync(join(target, 'instance', 'mods', 'sodium.jar'), 'utf8')).toBe('jar')
    expect(existsSync(join(userData, 'instance'))).toBe(false)
    expect(existsSync(join(userData, 'accounts.json'))).toBe(true) // not a game file
    expect(getSettings().gameDir).toBe(target)

    expect((await moveGameFolder(userData, false)).ok).toBe(true) // back to default
    expect(existsSync(join(userData, 'instance', 'mods', 'sodium.jar'))).toBe(true)
    expect(getSettings().gameDir).toBe(null)
  })
  test('refuses while Minecraft is running', async () => {
    expect(await moveGameFolder(join(tmpdir(), 'x'), true)).toMatchObject({ ok: false, reason: 'busy' })
  })
  test('refuses a non-empty folder', async () => {
    const target = mkdtempSync(join(tmpdir(), 'hemi-full-'))
    writeFileSync(join(target, 'something.txt'), 'x')
    expect(await moveGameFolder(target, false)).toMatchObject({ ok: false, reason: 'notEmpty' })
    expect(existsSync(join(userData, 'instance'))).toBe(true) // nothing moved
  })
  test('refuses a folder inside the current one, system folders and long paths', async () => {
    expect(await moveGameFolder(join(userData, 'instance', 'sub'), false)).toMatchObject({ ok: false, reason: 'invalid' })
    expect(await moveGameFolder('C:\\Windows\\Hemisphere', false)).toMatchObject({ ok: false, reason: 'invalid' })
    expect(await moveGameFolder(join(tmpdir(), 'x'.repeat(130)), false)).toMatchObject({ ok: false, reason: 'tooLong' })
  })
})
