// Phase 25: screenshots gallery (names the image scheme accepts, dates from Minecraft's file names).
import { describe, expect, test, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '.' }, protocol: {}, nativeImage: {}, clipboard: {}, ClipboardItem: class {}, shell: {} }))
const { isScreenshotName, takenAtFromName } = await import('../src/main/core/system/screenshots')

describe('screenshot names', () => {
  test.each(['2026-10-08_21.14.03.png', '2026-10-08_21.14.03_2.png', 'My base (night).PNG'])('accepts %s', (n) => expect(isScreenshotName(n)).toBe(true))
  test.each(['../options.txt', '..\\secret.png', 'sub/2026.png', 'C:x.png', '.hidden.png', 'shot.jpg', 'shot.png.exe', ''])('refuses %j', (n) =>
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
