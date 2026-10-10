/**
 * Proof that a launcher plays a Minecraft account (the catalogue, launcher 1.4), checked by Herald OFFLINE: Herald calls
 * no Mojang or Microsoft API, and never sees the player's token.
 *
 * The launcher asks Minecraft's services for the account's player certificate (the key pair the game signs chat with):
 * a public key, its expiry, and Mojang's signature binding them to the account (the same check Minecraft servers do
 * for signed chat). With the private key it signs Herald's one-time challenge. Herald checks Mojang's signature with
 * Mojang's public keys (src/shared/mojangKeys.ts), then the challenge's signature with the player's key.
 *
 * Mojang signs (SHA1withRSA): profile id (16 bytes) · expiry in ms (8 bytes, big endian) · the key (X.509 DER).
 * The player signs (SHA256withRSA): "hemisphere-herald:" + challenge + ":" + profile id.
 */
import { MOJANG_PLAYER_CERTIFICATE_KEYS } from './mojangKeys'

export interface PlayerProof {
  /** Minecraft profile id, 32 hex digits */
  id: string
  /** profile name as the launcher knows it (shown to staff; not part of Mojang's signature) */
  name: string
  /** the player's public key, base64 X.509 (SPKI) DER */
  publicKey: string
  /** when the certificate ends (ms) */
  expiresAt: number
  /** Mojang's signature of the key (base64, "publicKeySignatureV2") */
  keySignature: string
  /** the challenge's signature by the player's key (base64) */
  signature: string
}

const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
const hexBytes = (hex: string) => Uint8Array.from(hex.match(/../g)!.map((h) => parseInt(h, 16)))

/** What the player signs for a challenge */
export const proofMessage = (challenge: string, id: string) => new TextEncoder().encode(`hemisphere-herald:${challenge}:${id}`)

/** What Mojang signed: profile id · expiry · key */
export function certificatePayload(id: string, expiresAt: number, publicKeyDer: Uint8Array): Uint8Array {
  const out = new Uint8Array(24 + publicKeyDer.length)
  out.set(hexBytes(id), 0)
  new DataView(out.buffer).setBigUint64(16, BigInt(expiresAt))
  out.set(publicKeyDer, 24)
  return out
}

async function verify(spki: Uint8Array, hash: 'SHA-1' | 'SHA-256', signature: Uint8Array, data: Uint8Array): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey('spki', spki as Uint8Array<ArrayBuffer>, { name: 'RSASSA-PKCS1-v1_5', hash }, false, ['verify'])
    return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature as Uint8Array<ArrayBuffer>, data as Uint8Array<ArrayBuffer>)
  } catch {
    return false
  }
}

/** Why a proof is refused, or null when it is good (`mojangKeys`: base64 SPKI keys; tests give their own) */
export async function proofProblem(p: PlayerProof, challenge: string, now = Date.now(), mojangKeys: string[] = MOJANG_PLAYER_CERTIFICATE_KEYS): Promise<string | null> {
  if (!/^[0-9a-f]{32}$/.test(p.id) || !/^\w{1,16}$/.test(p.name)) return 'bad account'
  if (!Number.isFinite(p.expiresAt) || p.expiresAt <= now) return 'the certificate has expired'
  let publicKey: Uint8Array, keySignature: Uint8Array, signature: Uint8Array
  try {
    ;[publicKey, keySignature, signature] = [fromB64(p.publicKey), fromB64(p.keySignature), fromB64(p.signature)]
  } catch {
    return 'unreadable proof'
  }
  if (publicKey.length > 1024 || keySignature.length > 1024 || signature.length > 1024) return 'unreadable proof'
  const payload = certificatePayload(p.id, p.expiresAt, publicKey)
  let byMojang = false
  for (const k of mojangKeys) if ((byMojang = await verify(fromB64(k), 'SHA-1', keySignature, payload))) break
  if (!byMojang) return 'the certificate is not signed by Mojang'
  if (!(await verify(publicKey, 'SHA-256', signature, proofMessage(challenge, p.id)))) return 'the challenge is not signed by this account'
  return null
}
