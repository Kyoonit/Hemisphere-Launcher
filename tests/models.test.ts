// Model reader (1.4, Patreon try-on): Minecraft JSON models and Blockbench projects, placed like in the game.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'
import { describe, expect, test } from 'vitest'
import { applyPoint, ModelError, placement, readModel, type ModelFile, type Vec3 } from '../src/shared/models'

const dir = join(__dirname, 'fixtures', 'models')

/** alpha of the fixtures' PNGs (RGBA, no filter: how the fixture script writes them) */
function alphaOf(png: Buffer): { width: number; height: number; alpha: Uint8Array } {
  const width = png.readUInt32BE(16)
  const height = png.readUInt32BE(20)
  const idat: Buffer[] = []
  for (let i = 8; i < png.length; ) {
    const len = png.readUInt32BE(i)
    if (png.toString('ascii', i + 4, i + 8) === 'IDAT') idat.push(png.subarray(i + 8, i + 8 + len))
    i += 12 + len
  }
  const raw = inflateSync(Buffer.concat(idat))
  const alpha = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) alpha[y * width + x] = raw[y * (width * 4 + 1) + 1 + x * 4 + 3]
  return { width, height, alpha }
}
const file = (name: string): ModelFile => {
  const b = readFileSync(join(dir, name))
  return name.endsWith('.png') ? { name, content: `data:image/png;base64,${b.toString('base64')}`, ...alphaOf(b) } : { name, content: b.toString('utf8') }
}
const all = () => readdirSync(dir).filter((n) => !n.endsWith('.md'))
const close = (a: Vec3, b: Vec3) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 4))

describe('model reader', () => {
  test('Blockbench project: cubes, group, embedded texture, per-face UVs, faces without texture left out', () => {
    const m = readModel([file('top_hat.bbmodel')])
    expect(m.kind).toBe('java')
    expect(m.textures).toHaveLength(1)
    expect(m.textures[0].src.startsWith('data:image/png;base64,')).toBe(true)
    expect(m.cubes).toHaveLength(3)
    expect(m.cubes[1].faces.north?.uv).toEqual([0.5, 0.25, 0.75, 0.5]) // the "F" marker, 32×32 texture
    expect(m.cubes[2].faces.up).toBeUndefined()
    expect(m.display.head).toEqual({ rotation: [0, 0, 0], translation: [0, 0, 0], scale: [1, 1, 1] })
  })

  test('Minecraft JSON: main model found, texture by resource name, tilted cubes, display merged with block/block', () => {
    const m = readModel(['crown.json', 'crown.png', 'test_sword.png'].map(file))
    expect(m.cubes).toHaveLength(5)
    expect(m.textures.map((t) => t.name)).toEqual(['crown'])
    expect(m.display.head?.scale).toEqual([1, 1, 1])
    expect(m.display.thirdperson_righthand?.rotation).toEqual([75, 45, 0]) // from vanilla block/block
    // a spike tilted 22.5° around z: its top leans away from the pivot
    const spike = m.cubes[1]
    const top = applyPoint(spike.matrix, [3, 22, 8])
    expect(top[1]).toBeLessThan(22)
    expect(top[0]).not.toBeCloseTo(3, 2)
    // UVs in Minecraft pixels (0–16) become 0–1
    expect(m.cubes[0].faces.north?.uv).toEqual([0, 0.5, 0.75, 11 / 16])
  })

  test('flat item (item/handheld): front and back, a side face per edge pixel, handheld display', () => {
    const m = readModel(['test_sword.json', 'test_sword.png'].map(file))
    expect(m.cubes[0]).toMatchObject({ from: [0, 0, 7.5], to: [16, 16, 8.5] })
    expect(m.cubes.length).toBeGreaterThan(10)
    expect(m.display.thirdperson_righthand).toEqual({ rotation: [0, -90, 55], translation: [0, 4, 0.5], scale: [0.85, 0.85, 0.85] })
  })

  test('refused cleanly: missing texture, missing parent, broken JSON, nothing to read', () => {
    expect(() => readModel([file('crown.json')])).toThrow(ModelError)
    expect(() => readModel([{ name: 'a.json', content: '{"parent":"hemisphere:item/base"}' }])).toThrow(/parent model/)
    expect(() => readModel([{ name: 'a.json', content: '{oops' }])).toThrow(/not valid JSON/)
    expect(() => readModel([file('crown.png')])).toThrow(ModelError)
    const bb = JSON.parse(file('top_hat.bbmodel').content)
    bb.textures[0].source = 'textures/top_hat.png' // not saved inside the project
    expect(() => readModel([{ name: 'x.bbmodel', content: JSON.stringify(bb) }])).toThrow(/not saved inside/)
  })

  test('on the head like Minecraft: block centre at the head centre, its north side forward, 0.625 scale', () => {
    const m = readModel([file('top_hat.bbmodel')])
    const head = placement(m, 'head')
    close(applyPoint(head, [8, 8, 8]), [0, 4, 0]) // head frame: neck at 0, head centre 4 above
    close(applyPoint(head, [8, 16, 8]), [0, 9, 0]) // 8 × 0.625 above
    close(applyPoint(head, [8, 8, 0]), [0, 4, 5]) // north → the face (+z)
  })

  test('in the hand like Minecraft: at the end of the arm, in front', () => {
    const m = readModel([file('top_hat.bbmodel')])
    const right = placement(m, 'righthand')
    const p = applyPoint(right, [8, 8, 8])
    expect(p[1]).toBeCloseTo(-10, 4) // the shoulder is at 0, the hand 10 below
    expect(p[2]).toBeGreaterThan(0)
    const left = applyPoint(placement(m, 'lefthand'), [8, 8, 8])
    expect(left[0]).toBeCloseTo(-p[0], 4) // mirrored
  })
})

describe('entity models', () => {
  test('a Blockbench free model: feet on the ground, front forward', () => {
    const bb = JSON.parse(readFileSync(join(dir, 'top_hat.bbmodel'), 'utf8'))
    bb.meta.model_format = 'free'
    const m = readModel([{ name: 'pack.bbmodel', content: JSON.stringify(bb) }])
    expect(m.kind).toBe('entity')
    expect(m.display).toEqual({})
    const at = placement(m, 'head')
    close(applyPoint(at, [0, 0, 0]), [0, -24, 0]) // the body root is at the neck, feet 24 below
    close(applyPoint(at, [0, 24, -4]), [0, 0, 4]) // north (−z) → the front (+z)
  })
})
