// Phase 15: IPC sender checks, file names from outside sources, player mod moves, AppData redirection.
import { describe, expect, test, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const userData = mkdtempSync(join(tmpdir(), 'hemi-userdata-'))
const ipcHandlers = new Map<string, (...args: unknown[]) => unknown>()
vi.mock('electron', () => ({
  app: { getPath: () => userData, isPackaged: true, getVersion: () => '0.0.0-test', on: () => {}, setLoginItemSettings: () => {} },
  ipcMain: {
    handle: (ch: string, fn: (...args: unknown[]) => unknown) => ipcHandlers.set(ch, fn),
    on: (ch: string, fn: (...args: unknown[]) => unknown) => ipcHandlers.set(ch, fn),
  },
  session: { defaultSession: { setPermissionRequestHandler: () => {}, setPermissionCheckHandler: () => {} } },
  shell: { openPath: async () => '' },
  clipboard: { writeText: () => {} },
}))
const { handle, trustWindow } = await import('../src/main/security')
const { isSafeModFileName, playerMods, setPlayerModEnabled } = await import('../src/main/core/importer/importer')
const { physicalPath } = await import('../src/main/core/system/redirect')

describe('IPC sender check', () => {
  const page = pathToFileURL(join(__dirname, '../src/renderer/index.html')).href
  const mainFrame = { url: page }
  const contents = { mainFrame }
  trustWindow({ webContents: contents, isDestroyed: () => false } as never)
  handle('test:ping', () => 'pong')
  const call = (event: object) => ipcHandlers.get('test:ping')!(event)

  test('answers the launcher page in the main window', () => {
    expect(call({ sender: contents, senderFrame: mainFrame })).toBe('pong')
  })
  test.each([
    ['another page', { sender: contents, senderFrame: { url: 'https://evil.example/' } }],
    ['a sub-frame', { sender: contents, senderFrame: { url: page } }],
    ['another web contents', { sender: {}, senderFrame: mainFrame }],
    ['no frame', { sender: contents, senderFrame: null }],
  ])('blocks %s', (_name, event) => {
    expect(() => call(event)).toThrow('blocked')
  })
})

describe('mod file names from Modrinth / the player', () => {
  test.each(['sodium-fabric-0.9.2+mc26.3.jar', 'Litematica 1.0.JAR'])('accepts %s', (n) => expect(isSafeModFileName(n)).toBe(true))
  test.each(['../evil.jar', 'mods/x.jar', 'a\\b.jar', 'C:x.jar', 'CON.jar', 'nul.jar', '.hidden.jar', 'x.exe', 'x.jar ', 'x.jar:stream', ''])(
    'refuses %j',
    (n) => expect(isSafeModFileName(n)).toBe(false),
  )
})

describe('player mods on/off', () => {
  const inst = join(userData, 'instance')
  mkdirSync(join(inst, 'mods'), { recursive: true })
  writeFileSync(join(inst, 'mods', 'mine.jar'), 'x')
  writeFileSync(join(inst, 'mods', 'hemisphere.jar'), 'x')
  writeFileSync(join(userData, 'outside.jar'), 'x')
  const owned = ['mods/hemisphere.jar']

  test("lists only the player's own jars", async () => {
    expect((await playerMods(owned)).map((m) => m.file)).toEqual(['mine.jar'])
  })
  test('moves a player mod to mods-disabled and back', async () => {
    expect(await setPlayerModEnabled('mine.jar', false, owned)).toBe(true)
    expect(existsSync(join(inst, 'mods-disabled', 'mine.jar'))).toBe(true)
    expect(await playerMods(owned)).toEqual([{ file: 'mine.jar', size: 1, enabled: false }])
    expect(await setPlayerModEnabled('mine.jar', true, owned)).toBe(true)
    expect(existsSync(join(inst, 'mods', 'mine.jar'))).toBe(true)
  })
  test("never touches Hemisphere's files or anything outside mods/", async () => {
    expect(await setPlayerModEnabled('hemisphere.jar', false, owned)).toBe(false)
    expect(await setPlayerModEnabled('../outside.jar', true, owned)).toBe(false)
    expect(await setPlayerModEnabled('../../outside.jar', false, owned)).toBe(false)
    expect(existsSync(join(userData, 'outside.jar'))).toBe(true)
  })
})

describe('physicalPath', () => {
  test('returns the resolved path when Windows does not redirect the folder', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hemi-real-'))
    expect(physicalPath(dir, dir)).toBe(realpathSync.native(dir))
  })
})
