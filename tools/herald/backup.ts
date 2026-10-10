// Herald backups, on the owner's PC (see herald/backup/README.md):
//   npm run herald:backup -- key [--out <file>]                      the key pair: the PRIVATE key saved in a file
//                                                                      (Documents by default, never in this
//                                                                      repository), the public one printed
//   npm run herald:backup -- token                                    a new report token, saved in
//                                                                      herald/server/.backup-token.txt (git-ignored)
//   npm run herald:backup -- decrypt <backup.sql.gz.enc> --key <file> [--out <dump.sql>]   opens a backup
import { createPrivateKey, generateKeyPairSync, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { decryptBackup } from '../../herald/backup/herald-backup.mjs'

const args = process.argv.slice(2)
const flag = (name: string) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const fail = (message: string): never => {
  console.error(`✗ ${message}`)
  process.exit(1)
}

const cmd = args[0]
if (cmd === 'key') {
  const out = resolve(flag('--out') ?? join(homedir(), 'Documents', 'herald-backup-private.pem'))
  if (existsSync(out)) fail(`${out} already exists: keep it (older backups need it), or choose another file with --out`)
  if (out.startsWith(resolve('.'))) fail('the private key must not be saved in this repository: choose a file outside it')
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 4096 })
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
  console.log(`✓ private key saved: ${out}`)
  console.log('  Keep a copy somewhere safe (a USB key, a password manager): without it no backup can be opened.\n')
  console.log('Public key (the repository variable BACKUP_PUBLIC_KEY of the backups repository):\n')
  console.log((publicKey.export({ type: 'spki', format: 'der' }) as Buffer).toString('base64'))
} else if (cmd === 'token') {
  const file = resolve('herald/server/.backup-token.txt')
  writeFileSync(file, randomBytes(32).toString('base64url'), { mode: 0o600 })
  console.log(`✓ new report token saved in ${file} (git-ignored). Give it to the Herald server and to the backups repository:`)
  console.log('  npx wrangler secret put BACKUP_TOKEN --config herald/server/wrangler.production.toml < herald/server/.backup-token.txt')
  console.log('  gh secret set HERALD_BACKUP_TOKEN --repo <owner>/herald-backups < herald/server/.backup-token.txt')
} else if (cmd === 'decrypt') {
  const file = args[1] ?? fail('which backup? npm run herald:backup -- decrypt <file> --key <private key>')
  const keyFile = flag('--key') ?? fail('--key <private key file> is needed')
  const out = resolve(flag('--out') ?? file.replace(/\.gz\.enc$|\.enc$/, '') + (file.endsWith('.enc') ? '' : '.sql'))
  // a path that is not there (e.g. %USERPROFILE% typed in PowerShell, which only knows $env:USERPROFILE)
  for (const [what, path] of [['backup', file], ['private key', keyFile]] as const)
    if (!existsSync(path)) fail(`the ${what} file is not there: ${resolve(path)}${path.includes('%') ? ' (in PowerShell, write $env:USERPROFILE instead of %USERPROFILE%)' : ''}`)
  let sql: Buffer
  try {
    sql = decryptBackup(readFileSync(file), createPrivateKey(readFileSync(keyFile)))
  } catch (err) {
    fail(`this backup cannot be opened with this key (${err instanceof Error ? err.message : err})`)
  }
  writeFileSync(out, sql!)
  console.log(`✓ ${out} (${(sql!.length / 1024).toFixed(0)} KB). Restore it into a NEW database first (herald/backup/README.md).`)
} else {
  console.log('npm run herald:backup -- key | token | decrypt <file> --key <private key>')
}
