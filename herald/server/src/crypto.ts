/**
 * Vaults (AES-256-GCM, one random key per vault) and helpers. WebCrypto only: runs the same in the Worker and in tests.
 * The content SIGNING key is not on this server (plan A): see tools/herald/publisher.ts.
 */

export const toB64 = (bytes: Uint8Array): string => {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
export const fromB64 = (b64: string): Uint8Array => Uint8Array.from(atob(b64.trim()), (c) => c.charCodeAt(0))
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')

export const sha512Hex = async (bytes: Uint8Array) => hex(await crypto.subtle.digest('SHA-512', bytes))
export const sha256Hex = async (bytes: Uint8Array) => hex(await crypto.subtle.digest('SHA-256', bytes))

// ------------------------------------------------------------------------------------------------ vaults

const IV_BYTES = 12

/** Vault file = IV (12 bytes) + AES-256-GCM ciphertext. plainSha256 goes in the signed feed: only one key opens it. */
export async function sealVault(plain: Uint8Array) {
  const raw = crypto.getRandomValues(new Uint8Array(32))
  const file = await sealWith(plain, raw)
  return { key: raw, file, sha512: await sha512Hex(file), plainSha256: await sha256Hex(plain) }
}

export async function openVault(file: Uint8Array, rawKey: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt'])
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: file.subarray(0, IV_BYTES) }, key, file.subarray(IV_BYTES)))
}

/** Vault keys are stored wrapped with the VAULT_MASTER secret (32 bytes, base64): a database dump alone opens nothing. */
export async function wrapKey(rawKey: Uint8Array, masterB64: string): Promise<string> {
  return toB64(await sealWith(rawKey, fromB64(masterB64)))
}
export async function unwrapKey(wrappedB64: string, masterB64: string): Promise<Uint8Array> {
  return openVault(fromB64(wrappedB64), fromB64(masterB64))
}

async function sealWith(plain: Uint8Array, raw: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain))
  const file = new Uint8Array(IV_BYTES + sealed.length)
  file.set(iv)
  file.set(sealed, IV_BYTES)
  return file
}
