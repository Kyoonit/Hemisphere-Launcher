// Herald go-live helpers (phase S12). Run by the OWNER: keys and secrets are never printed.
//   npm run herald:production -- github-app <downloaded .pem> <App ID> <Installation ID>
//       the production GitHub App → secrets of the production Herald server (straight to Cloudflare, nothing written)
//   npm run herald:production -- copy signing     the REAL content signing key (PKCS#8 DER, base64) → clipboard
//   npm run herald:production -- copy publisher   PUBLISHER_TOKEN (herald/server/.production-secrets) → clipboard
// Paste each copied value in GitHub (content repository → Settings → Secrets and variables → Actions), then copy
// something else to clear the clipboard.
import { spawnSync } from 'node:child_process'
import { createPrivateKey, createPublicKey } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { defaultKeyPath } from '../content/keyPath.ts'

const ROOT = join(import.meta.dirname, '..', '..')
// Relative to ROOT (the command runs there): the repository folder's name has a space
const CONFIG = 'herald/server/wrangler.production.toml'
const [command, ...args] = process.argv.slice(2)

function putSecret(name: string, value: string) {
  const r = spawnSync('npx', ['wrangler', 'secret', 'put', name, '--config', CONFIG], { input: value, cwd: ROOT, shell: true, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`${name}: wrangler failed (${(r.stderr || r.stdout).split('\n').find((l) => /error/i.test(l)) ?? r.status})`)
  console.log(`  ✓ ${name}`)
}

function toClipboard(value: string, what: string) {
  const r = spawnSync('powershell', ['-NoProfile', '-Command', '$input | Set-Clipboard'], { input: value, encoding: 'utf8' })
  if (r.status !== 0) throw new Error('could not reach the clipboard')
  console.log(`${what} copied to the clipboard (${value.length} characters). Paste it in GitHub, then copy something else.`)
}

if (command === 'github-app') {
  const [pem, appId, installationId] = args
  if (!pem || !existsSync(pem) || !/^\d+$/.test(appId ?? '') || !/^\d+$/.test(installationId ?? '')) {
    console.error('usage: npm run herald:production -- github-app <downloaded .pem> <App ID> <Installation ID>')
    process.exitCode = 1
  } else {
    // GitHub gives PKCS#1 PEM; the Worker needs PKCS#8 DER (WebCrypto), base64
    const der = createPrivateKey(readFileSync(pem)).export({ type: 'pkcs8', format: 'der' }) as Buffer
    const values: [string, string][] = [['GITHUB_APP_ID', appId], ['GITHUB_APP_KEY', der.toString('base64')], ['GITHUB_INSTALLATION_ID', installationId]]
    console.log('Production Herald server secrets:')
    try {
      for (const [name, value] of values) putSecret(name, value)
    } catch (err) {
      // wrangler not signed in from this terminal: kept with the other production secrets (git-ignored) instead
      const file = join(ROOT, 'herald', 'server', '.production-secrets')
      const kept = readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l && !/^GITHUB_(APP_ID|APP_KEY|INSTALLATION_ID)=/.test(l))
      writeFileSync(file, [...kept, ...values.map(([n, v]) => `${n}=${v}`)].join('\n') + '\n')
      console.log(`  Cloudflare could not be reached from this terminal (${err instanceof Error ? err.message.slice(0, 80) : err}).`)
      console.log('  The App is saved in herald/server/.production-secrets (git-ignored) instead: Claude sends it to the server.')
    }
    console.log(`Done. Delete ${pem} now (keep a copy only in your safe place if you want one).`)
  }
} else if (command === 'copy' && args[0] === 'signing') {
  const path = process.env.HEMI_SIGNING_KEY ?? defaultKeyPath()
  if (!existsSync(path)) throw new Error(`No signing key at ${path}`)
  const key = createPrivateKey(readFileSync(path))
  // Only the key launchers trust: its public half must be the one built into the launcher
  const launcherKey = readFileSync(join(ROOT, 'src', 'main', 'core', 'remote', 'publicKey.ts'), 'utf8').match(/'([A-Za-z0-9+/=]+)'/)?.[1]
  if (createPublicKey(key).export({ type: 'spki', format: 'der' }).toString('base64') !== launcherKey) throw new Error('This key is not the one launchers trust: nothing copied.')
  toClipboard((key.export({ type: 'pkcs8', format: 'der' }) as Buffer).toString('base64'), 'SIGNING_KEY (the real content key)')
} else if (command === 'copy' && args[0] === 'publisher') {
  const token = readFileSync(join(ROOT, 'herald', 'server', '.production-secrets'), 'utf8').match(/^PUBLISHER_TOKEN=(.+)$/m)?.[1]?.trim()
  if (!token) throw new Error('No PUBLISHER_TOKEN in herald/server/.production-secrets')
  toClipboard(token, 'PUBLISHER_TOKEN')
} else {
  console.error('usage: npm run herald:production -- github-app <.pem> <App ID> <Installation ID> | copy signing | copy publisher')
  process.exitCode = 1
}
