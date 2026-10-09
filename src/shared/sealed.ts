/**
 * Sealed content (go-live, S12): nothing in the public content repository can be read from GitHub or its history.
 * Every file Herald publishes is an ENVELOPE: AES-256-GCM, its plaintext padded so sizes say little.
 *
 *   "HMS1" · keyId length (1 byte) · keyId (ASCII, [a-z0-9-]) · IV (12 bytes) · ciphertext + GCM tag (16 bytes)
 *   plaintext = payload length (4 bytes, big endian) · payload · zero padding up to a multiple of `padTo`
 *
 * The feed and the mod pack index are sealed with a key only the Herald server gives (GET /content-key/<keyId>), and
 * only for what is online now: once replaced, a key is refused, so old copies in the history stay unreadable. Their
 * plaintext carries the keys of the other files (pictures, manifests, config files). Signatures are made on the
 * PLAINTEXT, with the content key, as before: whoever holds a sealing key still cannot forge content.
 *
 * WebCrypto only: the same code runs in the Herald server (Workers), the publisher, the launcher and Herald.
 */
const MAGIC = [0x48, 0x4d, 0x53, 0x31] // "HMS1"
const KEY_ID = /^[a-z0-9-]{1,64}$/

const subtle = () => crypto.subtle
const aes = (raw: Uint8Array, use: 'encrypt' | 'decrypt') => subtle().importKey('raw', raw as Uint8Array<ArrayBuffer>, 'AES-GCM', false, [use])

export const toB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b))
export const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

/** Seals a payload. `iv` only for deterministic files (a key used for ONE plaintext, e.g. a picture's own key). */
export async function seal(payload: Uint8Array, key: Uint8Array, keyId: string, padTo = 4096, iv: Uint8Array = crypto.getRandomValues(new Uint8Array(12))): Promise<Uint8Array> {
  if (!KEY_ID.test(keyId)) throw new Error('bad key id')
  if (key.length !== 32 || iv.length !== 12) throw new Error('bad key or IV')
  const plain = new Uint8Array(Math.ceil((payload.length + 4) / padTo) * padTo)
  new DataView(plain.buffer).setUint32(0, payload.length)
  plain.set(payload, 4)
  const sealed = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: iv as Uint8Array<ArrayBuffer> }, await aes(key, 'encrypt'), plain))
  const id = new TextEncoder().encode(keyId)
  const out = new Uint8Array(MAGIC.length + 1 + id.length + 12 + sealed.length)
  out.set(MAGIC)
  out[4] = id.length
  out.set(id, 5)
  out.set(iv, 5 + id.length)
  out.set(sealed, 17 + id.length)
  return out
}

/** The key id of an envelope (to ask for its key), or null if this is not an envelope. */
export function keyIdOf(file: Uint8Array): string | null {
  if (file.length < 5 || MAGIC.some((b, i) => file[i] !== b)) return null
  const id = new TextDecoder().decode(file.subarray(5, 5 + file[4]))
  return KEY_ID.test(id) ? id : null
}

/** Opens an envelope (throws if the key is wrong or a byte changed). */
export async function unseal(file: Uint8Array, key: Uint8Array): Promise<Uint8Array> {
  const id = keyIdOf(file)
  if (!id) throw new Error('not a sealed file')
  const at = 5 + file[4]
  const plain = new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: file.subarray(at, at + 12) as Uint8Array<ArrayBuffer> }, await aes(key, 'decrypt'), file.subarray(at + 12) as Uint8Array<ArrayBuffer>))
  const length = new DataView(plain.buffer).getUint32(0)
  if (length > plain.length - 4) throw new Error('bad sealed payload')
  return plain.subarray(4, 4 + length)
}

/** SHA-512 (hex), with WebCrypto */
export async function sha512Hex(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await subtle().digest('SHA-512', bytes as Uint8Array<ArrayBuffer>))].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** A file's seal, next to its PLAIN sha512 and size in the content that lists it: the bytes on GitHub and their key */
export interface SealInfo {
  /** AES key (base64, 32 bytes) */
  key: string
  /** SHA-512 and size of the sealed file as stored */
  sha512: string
  size: number
}

/** The plaintext of the sealed feed or pack index: the signed bytes, their signature, the keys of the files they list */
export interface SealedDocument {
  /** The signed document (JSON text, exactly the bytes the signature covers) */
  doc: string
  /** Ed25519 signature of `doc` (base64) */
  sig: string
  /** Logical path → where the sealed file is and its key (pack index: the manifests) */
  files?: Record<string, { path: string } & SealInfo>
}
