// Catalogue (1.4): a launcher proves its Minecraft account to Herald with the player certificate, checked offline.
import { generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { certificatePayload, proofMessage, proofProblem, type PlayerProof } from '../src/shared/playerProof'
import { MOJANG_PLAYER_CERTIFICATE_KEYS } from '../src/shared/mojangKeys'

const rsa = () => generateKeyPairSync('rsa', { modulusLength: 2048 })
const mojang = rsa()
const mojangKey = mojang.publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
const ID = '0123456789abcdef0123456789abcdef'

/** A proof as the launcher makes it, its certificate signed by `signer` */
function proof(challenge: string, { signer = mojang.privateKey, expiresAt = Date.now() + 86_400_000, id = ID } = {}): PlayerProof {
  const player = rsa()
  const der = player.publicKey.export({ type: 'spki', format: 'der' })
  return {
    id,
    name: 'Kyo',
    publicKey: der.toString('base64'),
    expiresAt,
    keySignature: sign('sha1', certificatePayload(id, expiresAt, der), signer).toString('base64'),
    signature: sign('sha256', proofMessage(challenge, id), player.privateKey).toString('base64'),
  }
}

describe('player proof', () => {
  test('a certificate signed by Mojang and the challenge signed with it: accepted', async () => {
    expect(await proofProblem(proof('c1'), 'c1', Date.now(), [mojangKey])).toBeNull()
  })

  test('refused: another signer, an expired certificate, another challenge, another account', async () => {
    expect(await proofProblem(proof('c1', { signer: rsa().privateKey }), 'c1', Date.now(), [mojangKey])).toMatch(/not signed by Mojang/)
    expect(await proofProblem(proof('c1', { expiresAt: Date.now() - 1 }), 'c1', Date.now(), [mojangKey])).toMatch(/expired/)
    expect(await proofProblem(proof('c1'), 'c2', Date.now(), [mojangKey])).toMatch(/challenge/)
    const p = proof('c1')
    expect(await proofProblem({ ...p, id: 'f'.repeat(32) }, 'c1', Date.now(), [mojangKey])).toMatch(/not signed by Mojang/)
    expect(await proofProblem({ ...p, name: '<b>' }, 'c1', Date.now(), [mojangKey])).toMatch(/bad account/)
  })

  test('Mojang’s real keys are readable (and a test certificate is not taken for theirs)', async () => {
    expect(MOJANG_PLAYER_CERTIFICATE_KEYS.length).toBeGreaterThan(0)
    for (const k of MOJANG_PLAYER_CERTIFICATE_KEYS) {
      const der = Uint8Array.from(atob(k), (c) => c.charCodeAt(0))
      await expect(crypto.subtle.importKey('spki', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-1' }, false, ['verify'])).resolves.toBeTruthy()
    }
    expect(await proofProblem(proof('c1'), 'c1')).toMatch(/not signed by Mojang/)
  })
})
