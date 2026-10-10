// Herald backup — goes in the private BACKUPS repository as .github/herald/herald-backup.mjs, next to the workflow
// .github/workflows/herald-backup.yml. No dependency: Node's own crypto, zlib and fetch.
//
//   node herald-backup.mjs run <dump.sql>   compress + encrypt the export, publish it as a release of this repository,
//                                           keep 30 days + one a month for 12 months, tell Herald
//   node herald-backup.mjs failed           tell Herald the backup failed (the workflow's last step, on failure)
//
// Encrypted for the owner's PUBLIC key only (BACKUP_PUBLIC_KEY): neither GitHub nor this workflow can read a backup
// afterwards. The private key stays with the owner; `npm run herald:backup -- decrypt` (launcher repository) opens one.
// Env: BACKUP_PUBLIC_KEY, HERALD_URL, HERALD_BACKUP_TOKEN, GITHUB_TOKEN, GITHUB_REPOSITORY (the last two from Actions).
import { constants, createCipheriv, createDecipheriv, createHash, createPublicKey, privateDecrypt, publicEncrypt, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { gunzipSync, gzipSync } from 'node:zlib'

const MAGIC = Buffer.from('HERALDBK')
const VERSION = 1

/** gzip, then AES-256-GCM with a fresh key, that key wrapped with RSA-OAEP (SHA-256) for the owner's public key */
export function encryptBackup(plain, publicKeyB64) {
  const key = randomBytes(32)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const body = Buffer.concat([cipher.update(gzipSync(plain, { level: 9 })), cipher.final(), cipher.getAuthTag()])
  const wrapped = publicEncrypt({ key: createPublicKey({ key: Buffer.from(publicKeyB64, 'base64'), format: 'der', type: 'spki' }), padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, key)
  const head = Buffer.alloc(MAGIC.length + 3)
  MAGIC.copy(head)
  head.writeUInt8(VERSION, MAGIC.length)
  head.writeUInt16BE(wrapped.length, MAGIC.length + 1)
  return Buffer.concat([head, wrapped, iv, body])
}

/** The export back, with the owner's private key (a KeyObject or PEM); throws when the file was changed or the key is another */
export function decryptBackup(file, privateKey) {
  if (!file.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('not a Herald backup')
  if (file.readUInt8(MAGIC.length) !== VERSION) throw new Error('unknown backup version')
  const n = file.readUInt16BE(MAGIC.length + 1)
  let at = MAGIC.length + 3
  const key = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, file.subarray(at, (at += n)))
  const iv = file.subarray(at, (at += 12))
  const body = file.subarray(at)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(body.subarray(body.length - 16))
  return gunzipSync(Buffer.concat([decipher.update(body.subarray(0, body.length - 16)), decipher.final()]))
}

/** Backups to keep (by tag "backup-YYYY-MM-DD-HHMM"): the newest of each of the last 30 days, the oldest of each of the last 12 months */
export function keep(tags, now) {
  const dated = tags.map((tag) => ({ tag, m: /^backup-(\d{4}-\d{2}-\d{2})-(\d{4})$/.exec(tag) })).filter((x) => x.m)
  const today = new Date(now).toISOString().slice(0, 10)
  const daysAgo = (day) => Math.round((Date.parse(today) - Date.parse(day)) / 86_400_000)
  const kept = new Set()
  const byDay = new Map()
  for (const x of dated) if (daysAgo(x.m[1]) < 30 && (!byDay.has(x.m[1]) || byDay.get(x.m[1]).tag < x.tag)) byDay.set(x.m[1], x)
  for (const x of byDay.values()) kept.add(x.tag)
  const byMonth = new Map()
  for (const x of dated) {
    const month = x.m[1].slice(0, 7)
    if (daysAgo(`${month}-01`) < 366 && (!byMonth.has(month) || byMonth.get(month).tag > x.tag)) byMonth.set(month, x)
  }
  for (const x of byMonth.values()) kept.add(x.tag)
  // never nothing: the newest one stays whatever its date
  const newest = dated.map((x) => x.tag).sort().at(-1)
  if (newest) kept.add(newest)
  return tags.filter((t) => kept.has(t))
}

// ------------------------------------------------------------------ GitHub and Herald

const env = (name) => {
  const v = process.env[name]
  if (!v) throw new Error(`${name} is missing (repository secret or variable)`)
  return v
}

async function github(method, path, body, host = 'https://api.github.com', type = 'application/json') {
  const res = await fetch(host + path, {
    method,
    headers: { authorization: `Bearer ${env('GITHUB_TOKEN')}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', ...(body ? { 'content-type': type } : {}) },
    body: body === undefined ? undefined : type === 'application/json' ? JSON.stringify(body) : body,
  })
  if (!res.ok && res.status !== 404) throw new Error(`GitHub ${method} ${path}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`)
  return res.status === 204 || res.status === 404 ? null : res.json()
}

async function report(result) {
  const res = await fetch(`${env('HERALD_URL')}/internal/backup`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env('HERALD_BACKUP_TOKEN')}`, 'content-type': 'application/json' },
    body: JSON.stringify(result),
  })
  if (!res.ok) throw new Error(`Herald did not take the report: HTTP ${res.status}`)
}

async function run(dumpPath) {
  const repo = env('GITHUB_REPOSITORY')
  const plain = readFileSync(dumpPath)
  if (plain.length < 100 || !plain.toString('utf8', 0, 4000).includes('CREATE TABLE')) throw new Error('the export looks empty')
  const file = encryptBackup(plain, env('BACKUP_PUBLIC_KEY'))
  const now = new Date()
  const stamp = now.toISOString().replace(/[-:]/g, '').slice(0, 13) // 20261010T0317
  const tag = `backup-${now.toISOString().slice(0, 10)}-${stamp.slice(9, 13)}`
  const name = `herald-${now.toISOString().slice(0, 10)}-${stamp.slice(9, 13)}.sql.gz.enc`
  const sha256 = createHash('sha256').update(file).digest('hex')

  const release = await github('POST', `/repos/${repo}/releases`, { tag_name: tag, name: tag, body: `Herald database, ${now.toISOString()}\nEncrypted for the owner's key. SHA-256: ${sha256}` })
  await github('POST', `/repos/${repo}/releases/${release.id}/assets?name=${name}`, file, 'https://uploads.github.com', 'application/octet-stream')
  console.log(`saved ${name}: ${(file.length / 1024).toFixed(0)} KB (export ${(plain.length / 1024).toFixed(0)} KB)`)

  // what to keep: the last 30 days, one a month for a year
  const all = []
  for (let page = 1; page < 20; page++) {
    const list = await github('GET', `/repos/${repo}/releases?per_page=100&page=${page}`)
    all.push(...list)
    if (list.length < 100) break
  }
  const kept = new Set(keep(all.map((r) => r.tag_name), now.getTime()))
  for (const r of all.filter((r) => r.tag_name.startsWith('backup-') && !kept.has(r.tag_name))) {
    await github('DELETE', `/repos/${repo}/releases/${r.id}`)
    await github('DELETE', `/repos/${repo}/git/refs/tags/${r.tag_name}`)
    console.log(`removed ${r.tag_name}`)
  }
  await report({ ok: true, name, size: file.length, sha256, url: release.html_url, kept: kept.size })
}

// run as a script only (the tests and the decrypt tool import the functions above)
const main = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
const [cmd, arg] = main ? process.argv.slice(2) : []
if (cmd === 'run') {
  run(arg).catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
} else if (cmd === 'failed') {
  const runUrl = process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null
  report({ ok: false, error: 'The backup workflow failed: see its run on GitHub.', url: runUrl }).catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
