import { crc32, deflateRawSync } from 'node:zlib'

/**
 * A small .zip writer (deflate, UTF-8 names) for the problem report: everything is in memory (a report is a few MB).
 * Opens with Windows Explorer, Discord previews, 7-Zip…
 */
export class ZipWriter {
  private parts: Buffer[] = []
  private central: Buffer[] = []
  private offset = 0
  private names = new Set<string>()

  /** Adds a file; folders are part of the name ("logs/latest.log"). The same name twice keeps the first one. */
  add(name: string, data: Buffer | string, mtime = new Date()): void {
    const clean = name.replace(/\\/g, '/').replace(/^\/+/, '')
    if (!clean || this.names.has(clean)) return
    this.names.add(clean)
    const raw = typeof data === 'string' ? Buffer.from(data, 'utf8') : data
    const packed = deflateRawSync(raw, { level: 6 })
    const stored = packed.length >= raw.length // already compressed (png, gz): keep as is
    const body = stored ? raw : packed
    const fileName = Buffer.from(clean, 'utf8')
    const crc = crc32(raw)
    const { time, date } = dosTime(mtime)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // UTF-8 names
    local.writeUInt16LE(stored ? 0 : 8, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(fileName.length, 26)
    this.parts.push(local, fileName, body)

    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50, 0)
    entry.writeUInt16LE(20, 4)
    entry.writeUInt16LE(20, 6)
    entry.writeUInt16LE(0x0800, 8)
    entry.writeUInt16LE(stored ? 0 : 8, 10)
    entry.writeUInt16LE(time, 12)
    entry.writeUInt16LE(date, 14)
    entry.writeUInt32LE(crc, 16)
    entry.writeUInt32LE(body.length, 20)
    entry.writeUInt32LE(raw.length, 24)
    entry.writeUInt16LE(fileName.length, 28)
    entry.writeUInt32LE(this.offset, 42)
    this.central.push(entry, fileName)
    this.offset += 30 + fileName.length + body.length
  }

  get files(): string[] {
    return [...this.names]
  }

  toBuffer(): Buffer {
    const cd = Buffer.concat(this.central)
    const end = Buffer.alloc(22)
    end.writeUInt32LE(0x06054b50, 0)
    end.writeUInt16LE(this.names.size, 8)
    end.writeUInt16LE(this.names.size, 10)
    end.writeUInt32LE(cd.length, 12)
    end.writeUInt32LE(this.offset, 16)
    return Buffer.concat([...this.parts, cd, end])
  }
}

function dosTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear())
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}
