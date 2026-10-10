// Herald catalogue (1.4): item sheets and file checks, shared by the server and the app.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cleanSheet, EMPTY_SHEET, filesProblem, safeLink, seesCatalogue, sheetProblems } from '../src/shared/heraldCatalogue'
import { effectivePermissions } from '../src/shared/heraldRoles'

const fixture = (name: string) => ({ name, bytes: new Uint8Array(readFileSync(join(__dirname, 'fixtures', 'models', name))) })
const png = (w: number, h: number) => {
  const b = new Uint8Array(33)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  b.set([...'IHDR'].map((c) => c.charCodeAt(0)), 12)
  new DataView(b.buffer).setUint32(16, w)
  new DataView(b.buffer).setUint32(20, h)
  b.set([8, 6], 24) // 8-bit RGBA
  return b
}

describe('catalogue sheet', () => {
  it('is cleaned: unknown values replaced, texts cut, adjustments kept in range', () => {
    const s = cleanSheet({ kind: 'hat', name: '  Top hat  ', slot: 'feet', adjust: { x: 99, y: -3, z: 'a', scale: 10 }, newUntil: 'soon', description: 'x'.repeat(2000) })
    expect(s).toMatchObject({ kind: 'model', name: 'Top hat', slot: 'head', adjust: { x: 16, y: -3, z: 0, scale: 4 }, newUntil: null })
    expect(s.description).toHaveLength(1000)
    // a change keeps what it doesn't mention
    expect(cleanSheet({ tier: 'Tier 2' }, { ...EMPTY_SHEET, name: 'Crown' })).toMatchObject({ name: 'Crown', tier: 'Tier 2' })
  })

  it('needs a name; the Patreon link (https) is needed to show it in the launchers, not to keep it on Herald', () => {
    expect(sheetProblems(EMPTY_SHEET)).toEqual(['Give it a name.'])
    const crown = { ...EMPTY_SHEET, name: 'Crown' }
    expect(sheetProblems(crown)).toEqual([])
    expect(sheetProblems(crown, true)).toContain('Add the link to its Patreon page before showing it in the launchers.')
    expect(sheetProblems({ ...crown, patreonUrl: 'http://patreon.com/x' })).toContain('The Patreon link must be an https:// address.')
    expect(sheetProblems({ ...crown, patreonUrl: 'https://www.patreon.com/posts/crown-123' }, true)).toEqual([])
    expect(sheetProblems({ ...crown, patreonUrl: 'https://www.patreon.com/posts/crown-123' }, true, false)).toEqual(['Add its files first.'])
    expect(safeLink('https://user:pass@patreon.com/')).toBe(false)
    expect(safeLink('javascript:alert(1)')).toBe(false)
  })

  it('is seen by profiles with a catalogue permission (not Lodge keepers)', () => {
    expect(seesCatalogue(effectivePermissions('moderator'))).toBe(true)
    expect(seesCatalogue(effectivePermissions('lodgeKeeper'))).toBe(false)
  })
})

describe('catalogue files', () => {
  it('a model: a Blockbench project, or a JSON model with its textures, that the reader can read', () => {
    expect(filesProblem('model', [fixture('top_hat.bbmodel')])).toBeNull()
    expect(filesProblem('model', [fixture('crown.json'), fixture('crown.png')])).toBeNull()
    expect(filesProblem('model', [fixture('crown.json')])).toMatch(/can’t be read: texture/)
    expect(filesProblem('model', [{ name: 'hat.bbmodel', bytes: new TextEncoder().encode('{nope') }])).toMatch(/not valid JSON/)
  })

  it('a skin: one PNG of Minecraft size', () => {
    expect(filesProblem('skin', [{ name: 'knight.png', bytes: png(64, 64) }])).toBeNull()
    expect(filesProblem('skin', [{ name: 'knight.png', bytes: png(128, 128) }])).toMatch(/64×64/)
    expect(filesProblem('skin', [fixture('top_hat.bbmodel')])).toMatch(/64×64/)
  })

  it('names, sizes and pictures are checked', () => {
    expect(filesProblem('model', [])).toBe('No files.')
    expect(filesProblem('model', [{ name: '../evil.json', bytes: new Uint8Array([1]) }])).toMatch(/only .bbmodel/)
    expect(filesProblem('model', [{ name: 'x.exe', bytes: new Uint8Array([1]) }])).toMatch(/only .bbmodel/)
    expect(filesProblem('model', [{ name: 'a.png', bytes: new Uint8Array([1, 2, 3]) }])).toMatch(/not a PNG/)
    expect(filesProblem('model', [fixture('crown.json'), fixture('crown.json')])).toMatch(/twice/)
    expect(filesProblem('model', [{ name: 'big.bbmodel', bytes: new Uint8Array(5 * 1024 * 1024) }])).toMatch(/too big/)
  })
})

describe('studio look', () => {
  const look = { player: 'Notch', background: 'sunset', animation: 'none', format: 'fullhd', caption: false, camera: [10, 5, 80], target: [0, 1, 0], turn: 0.6, shift: { x: 0.2, y: -0.1 } }

  it('is kept with the sheet, and a sheet saved without it keeps the one there', () => {
    const saved = cleanSheet({ name: 'Crown', studio: look })
    expect(saved.studio).toEqual(look)
    expect(cleanSheet({ name: 'Crown 2' }, saved).studio).toEqual(look)
    expect(cleanSheet({ studio: null }, saved).studio).toBeNull()
  })

  it('odd values are replaced, never kept', () => {
    const s = cleanSheet({ studio: { player: '<script>', background: 'a/b', camera: [1e9, 'x', 2], shift: { x: 50 }, turn: 'no' } }).studio!
    expect(s.player).toBe('Steve')
    expect(s.background).toBe('night')
    expect(s.camera).toEqual([1000, 0, 2])
    expect(s.shift).toEqual({ x: 2, y: 0 })
    expect(s.turn).toBe(0)
    expect(EMPTY_SHEET.studio).toBeNull()
  })
})
