/**
 * PNG pixels without a canvas (launcher 1.4, step 3c): the Herald server reads a texture's pixels to mark them, and
 * writes the marked picture back. Reading covers what textures use (8-bit RGBA, RGB, grey, palette, not interlaced);
 * writing makes plain RGBA without compression (fast, and the delivery is sealed and padded anyway).
 * Web APIs only (DecompressionStream): the same code runs in the Worker, the launcher and tests.
 */

export interface Pixels {
  width: number
  height: number
  /** 4 bytes per pixel, row by row */
  rgba: Uint8Array
}

export class PngError extends Error {}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const MAX_SIDE = 4096

const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0

/** What stops a PNG from being read here (from its header only), or null */
export function pngProblem(b: Uint8Array): string | null {
  if (b.length < 33 || SIGNATURE.some((x, i) => b[i] !== x) || String.fromCharCode(b[12], b[13], b[14], b[15]) !== 'IHDR') return 'not a PNG picture'
  const [width, height, depth, type, interlace] = [u32(b, 16), u32(b, 20), b[24], b[25], b[28]]
  if (!width || !height || width > MAX_SIDE || height > MAX_SIDE) return 'too big a picture (4096 pixels at most)'
  if (interlace) return 'an interlaced PNG (save it again without interlacing)'
  if (type === 3 ? ![1, 2, 4, 8].includes(depth) : depth !== 8 || ![0, 2, 4, 6].includes(type)) return 'a 16-bit PNG (save it again in 8 bits)'
  return null
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

const paeth = (a: number, b: number, c: number) => {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

/** A PNG's pixels (throws PngError) */
export async function decodePng(b: Uint8Array): Promise<Pixels> {
  const problem = pngProblem(b)
  if (problem) throw new PngError(problem)
  const [width, height, depth, type] = [u32(b, 16), u32(b, 20), b[24], b[25]]
  let palette: Uint8Array | null = null
  let trns: Uint8Array | null = null
  const idat: Uint8Array[] = []
  for (let at = 8; at + 8 <= b.length; ) {
    const length = u32(b, at)
    const name = String.fromCharCode(b[at + 4], b[at + 5], b[at + 6], b[at + 7])
    const data = b.subarray(at + 8, at + 8 + length)
    if (name === 'PLTE') palette = data
    else if (name === 'tRNS') trns = data
    else if (name === 'IDAT') idat.push(data)
    else if (name === 'IEND') break
    at += 12 + length
  }
  if (type === 3 && !palette) throw new PngError('a palette PNG without its palette')
  const joined = new Uint8Array(idat.reduce((n, d) => n + d.length, 0))
  idat.reduce((at, d) => (joined.set(d, at), at + d.length), 0)
  let raw: Uint8Array
  try {
    raw = await inflate(joined)
  } catch {
    throw new PngError('a damaged PNG')
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type]!
  const bpp = Math.max(1, (channels * depth) / 8) // bytes per pixel, for the filters
  const stride = Math.ceil((width * channels * depth) / 8)
  if (raw.length < height * (stride + 1)) throw new PngError('a damaged PNG')
  // undo the row filters, in place
  const rows = new Uint8Array(height * stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const row = rows.subarray(y * stride, (y + 1) * stride)
    const up = y ? rows.subarray((y - 1) * stride, y * stride) : null
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? row[x - bpp] : 0
      const c = up && x >= bpp ? up[x - bpp] : 0
      const u = up ? up[x] : 0
      const v = src[x]
      row[x] = (filter === 0 ? v : filter === 1 ? v + a : filter === 2 ? v + u : filter === 3 ? v + ((a + u) >> 1) : filter === 4 ? v + paeth(a, u, c) : v) & 0xff
    }
    if (filter > 4) throw new PngError('a damaged PNG')
  }
  const rgba = new Uint8Array(width * height * 4)
  const grey = trns && trns.length >= 2 && type === 0 ? (trns[0] << 8) | trns[1] : -1
  const rgbKey = trns && trns.length >= 6 && type === 2 ? [(trns[0] << 8) | trns[1], (trns[2] << 8) | trns[3], (trns[4] << 8) | trns[5]] : null
  for (let y = 0; y < height; y++) {
    const row = rows.subarray(y * stride, (y + 1) * stride)
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      if (type === 6) rgba.set(row.subarray(x * 4, x * 4 + 4), o)
      else if (type === 2) {
        const [r, g, bl] = [row[x * 3], row[x * 3 + 1], row[x * 3 + 2]]
        rgba.set([r, g, bl, rgbKey && rgbKey[0] === r && rgbKey[1] === g && rgbKey[2] === bl ? 0 : 255], o)
      } else if (type === 0) rgba.set([row[x], row[x], row[x], row[x] === grey ? 0 : 255], o)
      else if (type === 4) rgba.set([row[x * 2], row[x * 2], row[x * 2], row[x * 2 + 1]], o)
      else {
        const perByte = 8 / depth
        const i = (row[Math.floor(x / perByte)] >> ((perByte - 1 - (x % perByte)) * depth)) & ((1 << depth) - 1)
        if (i * 3 + 2 >= palette!.length) throw new PngError('a damaged PNG')
        rgba.set([palette![i * 3], palette![i * 3 + 1], palette![i * 3 + 2], trns && i < trns.length ? trns[i] : 255], o)
      }
    }
  }
  return { width, height, rgba }
}

// ------------------------------------------------------------------------------------------------ writing

const CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
const crc32 = (b: Uint8Array) => {
  let c = 0xffffffff
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** An RGBA PNG of these pixels (zlib "stored" blocks: no compression) */
export function encodePng({ width, height, rgba }: Pixels): Uint8Array {
  const stride = width * 4 + 1
  const raw = new Uint8Array(height * stride)
  for (let y = 0; y < height; y++) raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * stride + 1)
  // zlib: header, stored blocks of 65535 bytes at most, Adler-32
  const blocks = Math.max(1, Math.ceil(raw.length / 65535))
  const z = new Uint8Array(2 + raw.length + blocks * 5 + 4)
  z.set([0x78, 0x01])
  let at = 2
  for (let i = 0; i < blocks; i++) {
    const part = raw.subarray(i * 65535, (i + 1) * 65535)
    z.set([i === blocks - 1 ? 1 : 0, part.length & 0xff, part.length >> 8, ~part.length & 0xff, (~part.length >> 8) & 0xff], at)
    z.set(part, at + 5)
    at += 5 + part.length
  }
  let [a, b2] = [1, 0]
  for (let i = 0; i < raw.length; i++) {
    a = (a + raw[i]) % 65521
    b2 = (b2 + a) % 65521
  }
  new DataView(z.buffer).setUint32(at, ((b2 << 16) | a) >>> 0)
  const chunk = (name: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length)
    const view = new DataView(out.buffer)
    view.setUint32(0, data.length)
    out.set([...name].map((c) => c.charCodeAt(0)), 4)
    out.set(data, 8)
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
    return out
  }
  const ihdr = new Uint8Array(13)
  new DataView(ihdr.buffer).setUint32(0, width)
  new DataView(ihdr.buffer).setUint32(4, height)
  ihdr.set([8, 6, 0, 0, 0], 8)
  const parts = [new Uint8Array(SIGNATURE), chunk('IHDR', ihdr), chunk('IDAT', z), chunk('IEND', new Uint8Array())]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  parts.reduce((o, p) => (out.set(p, o), o + p.length), 0)
  return out
}
