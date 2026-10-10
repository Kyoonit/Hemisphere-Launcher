// Catalogue delivery (1.4, step 3c): PNG pixels without a canvas, and the invisible per-player mark in textures.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { crc32, deflateSync, inflateSync } from 'node:zlib'
import { describe, expect, test } from 'vitest'
import { decodePng, encodePng, pngProblem, PngError } from '../src/shared/png'
import { markPixels, readMark } from '../src/shared/watermark'

const chunk = (name: string, data: Buffer) => {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length)
  head.write(name, 4, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])))
  return Buffer.concat([head, data, crc])
}

/** A PNG written like other tools do: compressed, each row with its own filter (rows are already packed bytes) */
function png(width: number, height: number, type: number, depth: number, rows: Buffer[], extra: Buffer[] = []): Uint8Array {
  const bpp = Math.max(1, ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[type] * depth / 8)
  const out: Buffer[] = []
  rows.forEach((row, y) => {
    const filter = y % 5
    const up = y ? rows[y - 1] : Buffer.alloc(row.length)
    const f = Buffer.alloc(row.length)
    for (let x = 0; x < row.length; x++) {
      const a = x >= bpp ? row[x - bpp] : 0
      const c = x >= bpp ? up[x - bpp] : 0
      const p = a + up[x] - c
      const pr = Math.abs(p - a) <= Math.abs(p - up[x]) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - up[x]) <= Math.abs(p - c) ? up[x] : c
      f[x] = (row[x] - [0, a, up[x], (a + up[x]) >> 1, pr][filter]) & 0xff
    }
    out.push(Buffer.from([filter]), f)
  })
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width)
  ihdr.writeUInt32BE(height, 4)
  ihdr.set([depth, type, 0, 0, 0], 8)
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), ...extra, chunk('IDAT', deflateSync(Buffer.concat(out))), chunk('IEND', Buffer.alloc(0))])
}

/** A colourful 32×32 RGBA picture with a transparent corner */
function picture(width = 32, height = 32) {
  const rgba = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) rgba.set([(i * 37) & 0xff, (i * 11 + 50) & 0xff, (i * 5) & 0xff, i % width < 4 && i < width * 4 ? 0 : 255], i * 4)
  return { width, height, rgba }
}

describe('PNG pixels', () => {
  test('RGBA, RGB, grey with alpha and palette PNGs read the same pixels, whatever the row filters', async () => {
    const p = picture()
    const rows = (bytesPerPixel: (i: number) => number[]) => Array.from({ length: p.height }, (_, y) => Buffer.from(Array.from({ length: p.width }, (_, x) => bytesPerPixel(y * p.width + x)).flat()))
    const px = (i: number) => [...p.rgba.subarray(i * 4, i * 4 + 4)]
    expect((await decodePng(png(32, 32, 6, 8, rows(px)))).rgba).toEqual(p.rgba)

    const rgb = await decodePng(png(32, 32, 2, 8, rows((i) => px(i).slice(0, 3))))
    expect(rgb.rgba.filter((_, k) => k % 4 === 3).every((a) => a === 255)).toBe(true)
    expect(rgb.rgba[4 * 40]).toBe(p.rgba[4 * 40])

    const ga = await decodePng(png(32, 32, 4, 8, rows((i) => [p.rgba[i * 4], p.rgba[i * 4 + 3]])))
    expect([...ga.rgba.subarray(0, 4)]).toEqual([p.rgba[0], p.rgba[0], p.rgba[0], 0])

    // 4-bit palette, colour 0 transparent
    const palette = Buffer.from(Array.from({ length: 16 }, (_, k) => [k * 16, 255 - k * 16, k]).flat())
    const indexRows = Array.from({ length: 8 }, (_, y) => Buffer.from(Array.from({ length: 4 }, (_, b) => (((y + b * 2) % 16) << 4) | ((y + b * 2 + 1) % 16))))
    const pal = await decodePng(png(8, 8, 3, 4, indexRows, [chunk('PLTE', palette), chunk('tRNS', Buffer.from([0]))]))
    expect([...pal.rgba.subarray(0, 4)]).toEqual([0, 255, 0, 0])
    expect([...pal.rgba.subarray(4, 8)]).toEqual([16, 239, 1, 255])
  })

  test('written PNGs are valid and read back exactly', async () => {
    const p = picture(300, 300) // more than one stored block
    const out = encodePng(p)
    const idat = Buffer.from(out).subarray(41, 41 + Buffer.from(out).readUInt32BE(33))
    expect(inflateSync(idat).length).toBe(300 * (300 * 4 + 1))
    expect((await decodePng(out)).rgba).toEqual(p.rgba)
  })

  test('what cannot be read is said before (16-bit, interlaced, not a PNG)', async () => {
    const p = png(2, 2, 6, 8, [Buffer.alloc(8), Buffer.alloc(8)])
    expect(pngProblem(p)).toBeNull()
    const sixteen = Uint8Array.from(p)
    sixteen[24] = 16
    expect(pngProblem(sixteen)).toMatch(/16-bit/)
    const interlaced = Uint8Array.from(p)
    interlaced[28] = 1
    expect(pngProblem(interlaced)).toMatch(/interlaced/)
    await expect(decodePng(new Uint8Array(40))).rejects.toThrow(PngError)
    expect(pngProblem(readFileSync(join(__dirname, 'fixtures', 'models', 'crown.png')))).toBeNull()
  })
})

describe('marks', () => {
  const seed = new TextEncoder().encode('test seed')
  const tag = Uint8Array.from([0xa5, 0x01, 0xff, 0x00, 0x3c, 0x77, 0x10, 0xee])

  test('a marked texture gives its tag back, and looks the same (each value moved by 1 at most)', async () => {
    const p = picture()
    const marked = Uint8Array.from(p.rgba)
    expect(markPixels(marked, 32, 32, tag, seed)).toBe(true)
    expect(marked.every((v, i) => Math.abs(v - p.rgba[i]) <= 1)).toBe(true)
    expect(marked.filter((_, i) => i % 4 === 3)).toEqual(p.rgba.filter((_, i) => i % 4 === 3))
    // through a PNG file and back
    const back = await decodePng(encodePng({ width: 32, height: 32, rgba: marked }))
    expect(readMark(back.rgba, 32, 32, seed)).toEqual(tag)
    // another seed (another server) reads nothing
    expect(readMark(back.rgba, 32, 32, new TextEncoder().encode('other'))).toBeNull()
  })

  test('a few changed pixels do not hide it; an unmarked texture has none', () => {
    const p = picture()
    const marked = Uint8Array.from(p.rgba)
    markPixels(marked, 32, 32, tag, seed)
    for (let i = 0; i < 40; i++) marked[(i * 97 * 4) % marked.length] ^= 1
    expect(readMark(marked, 32, 32, seed)).toEqual(tag)
    expect(readMark(p.rgba, 32, 32, seed)).toBeNull()
  })

  test('a texture too small to hold the tag is left as it is', () => {
    const p = picture(8, 8)
    const copy = Uint8Array.from(p.rgba)
    expect(markPixels(copy, 8, 8, tag, seed)).toBe(false)
    expect(copy).toEqual(p.rgba)
  })
})
