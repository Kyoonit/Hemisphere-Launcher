// Phase 25: screenshots gallery (names the image scheme accepts, dates from Minecraft's file names, copying several to a folder).
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'

const instance = mkdtempSync(join(tmpdir(), 'hemi-shots-'))
vi.mock('electron', () => ({ app: { getPath: () => '.' }, protocol: {}, nativeImage: {}, clipboard: {}, ClipboardItem: class {}, shell: {} }))
vi.mock('../src/main/core/game/target', () => ({ gamePaths: () => ({ instance }) }))
const { exportScreenshots, isScreenshotName, takenAtFromName } = await import('../src/main/core/system/screenshots')

describe('screenshot names', () => {
  test.each(['2026-10-08_21.14.03.png', '2026-10-08_21.14.03_2.png', 'My base (night).PNG'])('accepts %s', (n) => expect(isScreenshotName(n)).toBe(true))
  test.each(['../options.txt', '..\secret.png', 'sub/2026.png', 'C:x.png', '.hidden.png', 'shot.jpg', 'shot.png.exe', ''])('refuses %j', (n) =>
    expect(isScreenshotName(n)).toBe(false),
  )
})

describe('taken at', () => {
  test("reads Minecraft's date-time file name (local time)", () => {
    expect(takenAtFromName('2026-10-08_21.14.03.png')).toBe(new Date(2026, 9, 8, 21, 14, 3).getTime())
    expect(takenAtFromName('2026-10-08_21.14.03_2.png')).toBe(new Date(2026, 9, 8, 21, 14, 3).getTime())
  })
  test('other names fall back to the file time', () => expect(takenAtFromName('My base.png')).toBeNull())
})

describe('copy to folder', () => {
  test('copies the picked screenshots, never overwrites, ignores anything else', () => {
    mkdirSync(join(instance, 'screenshots'))
    writeFileSync(join(instance, 'screenshots', 'a.png'), 'A')
    writeFileSync(join(instance, 'screenshots', 'b.png'), 'B')
    writeFileSync(join(instance, 'options.txt'), 'x')
    const out = mkdtempSync(join(tmpdir(), 'hemi-out-'))
    writeFileSync(join(out, 'a.png'), 'already there')
    const r = exportScreenshots(['a.png', 'b.png', 'a.png', 'missing.png', '../options.txt'], out)
    expect(r).toEqual({ copied: 2, folder: out })
    expect(readdirSync(out).sort()).toEqual(['a (2).png', 'a.png', 'b.png'])
  })
})
