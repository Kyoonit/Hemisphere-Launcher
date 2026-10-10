/**
 * Invisible marks in textures (launcher 1.4, step 3c): every player gets the catalogue's textures marked with a tag of
 * their own (64 bits), so a texture found elsewhere says who it was given to. The tag is written many times in the
 * lowest bit of the red, green and blue values of opaque pixels (a change of 1 in 255: unseen), at places a secret
 * seed chooses. Reading takes each bit's majority, so a few changed pixels do not hide it; a picture saved again
 * without loss (PNG) keeps it. Pure code, shared by the Herald server (marks, reads) and tests.
 */

export const TAG_BYTES = 8
const TAG_BITS = TAG_BYTES * 8
/** below this many places for each bit, a texture is left as it is (too small to hold the tag) */
const MIN_COPIES = 3

/** Places of the texture's bits (pixel × 3 + channel), in the order the seed gives */
function places(rgba: Uint8Array, width: number, height: number, seed: Uint8Array): Uint32Array {
  const out: number[] = []
  for (let i = 0; i < width * height; i++) if (rgba[i * 4 + 3] === 255) out.push(i * 3, i * 3 + 1, i * 3 + 2)
  // xorshift32 from the seed and the texture's size
  let s = (width * 73856093) ^ (height * 19349663)
  for (const b of seed) s = (Math.imul(s, 31) + b) | 0
  s ||= 0x9e3779b9
  const next = () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return s >>> 0
  }
  for (let i = out.length - 1; i > 0; i--) {
    const j = next() % (i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return Uint32Array.from(out)
}

const at = (place: number) => Math.floor(place / 3) * 4 + (place % 3)

/** Marks the pixels with the tag (in place). False when the texture is too small to hold it. */
export function markPixels(rgba: Uint8Array, width: number, height: number, tag: Uint8Array, seed: Uint8Array): boolean {
  if (tag.length !== TAG_BYTES) throw new Error('bad tag')
  const list = places(rgba, width, height, seed)
  if (list.length < TAG_BITS * MIN_COPIES) return false
  for (let k = 0; k < list.length; k++) {
    const bit = k % TAG_BITS
    const value = (tag[bit >> 3] >> (7 - (bit & 7))) & 1
    const o = at(list[k])
    rgba[o] = (rgba[o] & 0xfe) | value
  }
  return true
}

/** The tag in these pixels, or null when there is none (an unmarked picture reads as noise) */
export function readMark(rgba: Uint8Array, width: number, height: number, seed: Uint8Array): Uint8Array | null {
  const list = places(rgba, width, height, seed)
  if (list.length < TAG_BITS * MIN_COPIES) return null
  const ones = new Uint32Array(TAG_BITS)
  const counts = new Uint32Array(TAG_BITS)
  for (let k = 0; k < list.length; k++) {
    counts[k % TAG_BITS]++
    ones[k % TAG_BITS] += rgba[at(list[k])] & 1
  }
  const tag = new Uint8Array(TAG_BYTES)
  let agreement = 0
  for (let bit = 0; bit < TAG_BITS; bit++) {
    const one = ones[bit] * 2 > counts[bit]
    if (one) tag[bit >> 3] |= 1 << (7 - (bit & 7))
    agreement += Math.max(ones[bit], counts[bit] - ones[bit]) / counts[bit]
  }
  // marked: nearly every copy agrees; noise: about 75 % for 3 copies, less for more (a flat texture reads as a
  // tag too: only a tag given to a player means something)
  return agreement / TAG_BITS >= 0.9 ? tag : null
}
