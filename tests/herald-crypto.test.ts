import { describe, expect, it } from 'vitest'
import { fromB64, openVault, sealVault, sha256Hex, toB64, unwrapKey, wrapKey } from '../herald/server/src/crypto'

describe('Herald server crypto', () => {
  it('a vault opens only with its own key, and its content matches plainSha256', async () => {
    const plain = new TextEncoder().encode(JSON.stringify({ title: 'Secret' }))
    const v = await sealVault(plain)
    expect(await openVault(v.file, v.key)).toEqual(plain)
    expect(await sha256Hex(await openVault(v.file, v.key))).toBe(v.plainSha256)
    await expect(openVault(v.file, crypto.getRandomValues(new Uint8Array(32)))).rejects.toThrow()
    const tampered = v.file.slice()
    tampered[20] ^= 1
    await expect(openVault(tampered, v.key)).rejects.toThrow()
  })

  it('wraps vault keys with the master secret (a database dump alone opens nothing)', async () => {
    const master = toB64(crypto.getRandomValues(new Uint8Array(32)))
    const key = crypto.getRandomValues(new Uint8Array(32))
    const wrapped = await wrapKey(key, master)
    expect(fromB64(wrapped)).not.toEqual(key)
    expect(await unwrapKey(wrapped, master)).toEqual(key)
    await expect(unwrapKey(wrapped, toB64(crypto.getRandomValues(new Uint8Array(32))))).rejects.toThrow()
  })

  it('base64 helpers round-trip large buffers', () => {
    const big = Uint8Array.from({ length: 300_000 }, (_, i) => (i * 7919) % 256)
    expect(fromB64(toB64(big))).toEqual(big)
    expect(toB64(big)).toBe(Buffer.from(big).toString('base64'))
  })
})
