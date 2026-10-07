import { createHash } from 'node:crypto'

/** Java's UUID.nameUUIDFromBytes("OfflinePlayer:<name>") — what Minecraft uses for offline players. */
export function offlineUuid(name: string): string {
  const b = createHash('md5').update(`OfflinePlayer:${name}`).digest()
  b[6] = (b[6] & 0x0f) | 0x30
  b[8] = (b[8] & 0x3f) | 0x80
  return b.toString('hex')
}
