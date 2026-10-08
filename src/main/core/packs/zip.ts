import { open } from 'node:fs/promises'
import { inflateRawSync } from 'node:zlib'

/**
 * Reads one small file out of a .zip (a resource pack's pack.mcmeta or pack.png) without unpacking it: the central
 * directory at the end of the archive says where the entry is. Stored and deflated entries only; anything odd = null.
 */
const MAX_ENTRY = 4 * 1024 * 1024

export async function readZipEntry(zipPath: string, name: string): Promise<Buffer | null> {
  const fh = await open(zipPath, 'r').catch(() => null)
  if (!fh) return null
  try {
    const size = (await fh.stat()).size
    // end of central directory: in the last 64 KB + 22 bytes
    const tailLen = Math.min(size, 65_557)
    const tail = Buffer.alloc(tailLen)
    await fh.read(tail, 0, tailLen, size - tailLen)
    let eocd = -1
    for (let i = tailLen - 22; i >= 0; i--)
      if (tail.readUInt32LE(i) === 0x06054b50) {
        eocd = i
        break
      }
    if (eocd < 0) return null
    const cdSize = tail.readUInt32LE(eocd + 12)
    const cdOffset = tail.readUInt32LE(eocd + 16)
    if (cdSize > 8 * 1024 * 1024 || cdOffset + cdSize > size) return null
    const cd = Buffer.alloc(cdSize)
    await fh.read(cd, 0, cdSize, cdOffset)

    for (let p = 0; p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50; ) {
      const method = cd.readUInt16LE(p + 10)
      const compSize = cd.readUInt32LE(p + 20)
      const rawSize = cd.readUInt32LE(p + 24)
      const nameLen = cd.readUInt16LE(p + 28)
      const extraLen = cd.readUInt16LE(p + 30)
      const commentLen = cd.readUInt16LE(p + 32)
      const local = cd.readUInt32LE(p + 42)
      const entry = cd.subarray(p + 46, p + 46 + nameLen).toString('utf8')
      p += 46 + nameLen + extraLen + commentLen
      if (entry !== name) continue
      if (rawSize > MAX_ENTRY || compSize > MAX_ENTRY) return null
      const head = Buffer.alloc(30)
      await fh.read(head, 0, 30, local)
      if (head.readUInt32LE(0) !== 0x04034b50) return null
      const start = local + 30 + head.readUInt16LE(26) + head.readUInt16LE(28)
      const data = Buffer.alloc(compSize)
      await fh.read(data, 0, compSize, start)
      if (method === 0) return data
      if (method === 8) return inflateRawSync(data, { maxOutputLength: MAX_ENTRY })
      return null
    }
    return null
  } catch {
    return null
  } finally {
    await fh.close()
  }
}
