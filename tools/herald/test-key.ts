// Herald test environment: a TEST signing key (never the real one) and the local secrets of the Herald server.
//   npm run herald:test-key     creates them once; later runs keep them and only fill in what is missing
// Private key: ~/.hemisphere/herald-test-key.pem (outside the repository). Local secrets: herald/server/.dev.vars
// (git-ignored). The test PUBLIC key is written to herald/server/test-public-key.txt for dev launcher builds.
// Plan A: the signing key is NOT a server secret; it goes in the content repository's Actions secrets, whose values
// are written to herald/server/.actions-secrets.txt (git-ignored) to copy into GitHub, then delete.
import { createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const ROOT = join(import.meta.dirname, '..', '..')
const keyPath = join(homedir(), '.hemisphere', 'herald-test-key.pem')
const varsPath = join(ROOT, 'herald', 'server', '.dev.vars')

if (!existsSync(keyPath)) {
  mkdirSync(dirname(keyPath), { recursive: true })
  const { privateKey } = generateKeyPairSync('ed25519')
  writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
  console.log(`Test signing key created: ${keyPath}`)
} else console.log(`Test signing key kept: ${keyPath}`)

const priv = createPrivateKey(readFileSync(keyPath))
const publicB64 = (createPublicKey(priv).export({ type: 'spki', format: 'der' }) as Buffer).toString('base64')
writeFileSync(join(ROOT, 'herald', 'server', 'test-public-key.txt'), publicB64 + '\n')

// .dev.vars: KEY=value lines; existing values (a GitHub token added by hand…) are kept
const vars = new Map<string, string>()
if (existsSync(varsPath)) for (const line of readFileSync(varsPath, 'utf8').split(/\r?\n/)) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) vars.set(m[1], m[2]) }
vars.delete('SIGNING_KEY')
if (!vars.has('VAULT_MASTER')) vars.set('VAULT_MASTER', randomBytes(32).toString('base64'))
if (!vars.has('PUBLISHER_TOKEN')) vars.set('PUBLISHER_TOKEN', randomBytes(32).toString('base64url'))
if (!vars.has('CODE_PEPPER')) vars.set('CODE_PEPPER', randomBytes(32).toString('base64'))
if (!vars.has('BOOTSTRAP_TOKEN')) vars.set('BOOTSTRAP_TOKEN', randomBytes(24).toString('base64url'))
if (!vars.has('DEV_TOKEN')) vars.set('DEV_TOKEN', randomBytes(24).toString('base64url'))
writeFileSync(varsPath, '# Local secrets of the Herald server (git-ignored). TEST values only.\n' + [...vars].map(([k, v]) => `${k}=${v}`).join('\n') + '\n')

const actionsPath = join(ROOT, 'herald', 'server', '.actions-secrets.txt')
writeFileSync(actionsPath, [
  'TEST values for the content repository: Settings → Secrets and variables → Actions. Delete this file afterwards.',
  '',
  'Secret SIGNING_KEY:',
  (priv.export({ type: 'pkcs8', format: 'der' }) as Buffer).toString('base64'),
  '',
  'Secret PUBLISHER_TOKEN:',
  vars.get('PUBLISHER_TOKEN'),
  '',
].join('\n'))
console.log(`Local server secrets: ${varsPath}`)
console.log(`Values for the GitHub Actions secrets: ${actionsPath} (delete it once copied)`)
console.log(`Test public key (base64 SPKI): ${publicB64}`)
