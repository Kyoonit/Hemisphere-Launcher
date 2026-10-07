// Live check of the Xbox -> Minecraft chain with an invalid Microsoft token: must fail cleanly, never crash.
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { minecraftSessionFromMs } from '../src/main/core/auth/minecraft'
import { AuthError } from '../src/main/core/auth/errors'

test('invalid Microsoft token is rejected by Xbox Live with an AuthError', async () => {
  await assert.rejects(minecraftSessionFromMs('not-a-real-token'), (err: unknown) => {
    assert.ok(err instanceof AuthError, 'should be AuthError')
    assert.match(err.message, /^unknown: xbl (400|401)/)
    return true
  })
})
