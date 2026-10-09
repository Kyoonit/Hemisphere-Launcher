// Go-live (phase S12): what players see today (content/feed.json, schema 1) brought into the PRODUCTION Herald server,
// so nothing disappears when launchers switch to Herald's feed. Writes the database only: nothing is published.
//   npm run herald:import-v1 -- <profile id of who imports>      (then Herald publishes it, with the owner's go-ahead)
// · each news → a published Herald news (same texts, date, link; its picture converted to WebP like Herald's)
// · the Discord application id and the mod policy → the launcher settings (the mod policy is not edited in Herald)
// Safe to run again: everything is keyed (images by hash, news by their schema 1 id).
import { execFileSync } from 'node:child_process'
import { createHash, createPublicKey, verify } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { FeedSchema } from '../../src/shared/feed.ts'
import { PublicationDataSchema, type PublicationData } from '../../src/shared/heraldPublications.ts'
import { PublicSettingsSchema } from '../../src/shared/heraldPublic.ts'

const ROOT = join(import.meta.dirname, '..', '..')
// HERALD_IMPORT_TARGET=staging: the same import into the staging server (to try it first)
const staging = process.env.HERALD_IMPORT_TARGET === 'staging'
const CONFIG = staging ? 'herald/server/wrangler.toml' : 'herald/server/wrangler.production.toml'
const DB = staging ? 'herald-staging' : 'herald'
const by = process.argv[2]
if (!by || !/^p-[a-z0-9-]{1,20}$/.test(by)) throw new Error('usage: npm run herald:import-v1 -- <profile id>')

// The schema 1 feed, checked like a launcher checks it
const bytes = readFileSync(join(ROOT, 'content', 'feed.json'))
const sig = Buffer.from(readFileSync(join(ROOT, 'content', 'feed.json.sig'), 'utf8').trim(), 'base64')
const keyB64 = readFileSync(join(ROOT, 'src', 'main', 'core', 'remote', 'publicKey.ts'), 'utf8').match(/'([A-Za-z0-9+/=]+)'/)![1]
if (!verify(null, bytes, createPublicKey({ key: Buffer.from(keyB64, 'base64'), format: 'der', type: 'spki' }), sig)) throw new Error('content/feed.json: signature invalid')
const feed = FeedSchema.parse(JSON.parse(bytes.toString('utf8')))

const sql: string[] = []
const q = (s: string) => `'${s.replace(/'/g, "''")}'`
const sha = (alg: string, b: Buffer) => createHash(alg).update(b).digest('hex')
const now = Date.now()
const pictures: { id: string; sha512: string }[] = []

/** A picture as Herald makes them: WebP, at most 1600 × 1000, under 1.5 MB */
async function picture(url: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  const src = Buffer.from(await res.arrayBuffer())
  for (const quality of [86, 78, 70, 62]) {
    const { data, info } = await sharp(src).resize({ width: 1600, height: 1000, fit: 'inside', withoutEnlargement: true }).webp({ quality }).toBuffer({ resolveWithObject: true })
    if (data.length > 1.5 * 1024 * 1024) continue
    const ref = { id: sha('sha256', data), sha512: sha('sha512', data), size: data.length, width: info.width, height: info.height }
    // D1 statements are limited to 100 KB: the bytes go in 40 KB pieces (concatenated as BLOB, checked afterwards)
    const hex = data.toString('hex')
    const piece = 80_000
    sql.push(`INSERT OR IGNORE INTO images (id, bytes, sha512, size, width, height, created_by, created_at) VALUES (${q(ref.id)}, X'${hex.slice(0, piece)}', ${q(ref.sha512)}, ${ref.size}, ${ref.width}, ${ref.height}, ${q(by)}, ${now});`)
    for (let i = piece; i < hex.length; i += piece) sql.push(`UPDATE images SET bytes = CAST(bytes || X'${hex.slice(i, i + piece)}' AS BLOB) WHERE id = ${q(ref.id)} AND length(bytes) = ${i / 2};`)
    pictures.push(ref)
    return ref
  }
  throw new Error(`${url}: too big even at low quality`)
}

const PARIS = 'Europe/Paris'
for (const n of feed.news) {
  const id = `n-${sha('sha256', Buffer.from(`v1:${n.id}`)).slice(0, 12).replace(/[^a-z0-9]/g, '0')}`
  // midnight in Paris on its date: the same date shown everywhere in Europe
  const from = new Date(`${n.date}T00:00:00+02:00`).toISOString()
  const langs = [...new Set(['en', ...Object.keys(n.title), ...Object.keys(n.body)])]
  const texts: PublicationData['texts'] = {}
  for (const l of langs) texts[l] = { title: n.title[l] ?? '', body: n.body[l] ?? '', ...(n.link?.label[l] ? { linkLabel: n.link.label[l] } : {}) }
  const image = n.image ? await picture(n.image) : null
  const data = PublicationDataSchema.parse({
    texts,
    done: Object.fromEntries(langs.filter((l) => l !== 'en').map((l) => [l, true])),
    schedule: { from, until: null, zone: PARIS },
    category: n.category,
    image,
    linkUrl: n.link?.url ?? null,
    featuredDays: n.featured ? 30 : 0,
  })
  const json = q(JSON.stringify(data))
  const at = Date.parse(from)
  sql.push(
    `INSERT OR IGNORE INTO publications (id, kind, status, data, published, published_at, published_by, version, created_by, created_at, updated_by, updated_at) VALUES (${q(id)}, 'news', 'ready', ${json}, ${json}, ${at}, ${q(by)}, 1, ${q(by)}, ${now}, ${q(by)}, ${now});`,
    `INSERT OR IGNORE INTO publication_versions (publication_id, version, status, data, action, by, at) VALUES (${q(id)}, 1, 'ready', ${json}, 'import', ${q(by)}, ${now});`,
    `INSERT INTO activity (at, profile_id, action, target, detail) SELECT ${now}, ${q(by)}, 'publication.import', ${q(id)}, ${q(JSON.stringify({ kind: 'news', title: n.title.en }))} WHERE NOT EXISTS (SELECT 1 FROM activity WHERE action = 'publication.import' AND target = ${q(id)});`,
  )
  console.log(`news ${n.id} → ${id}${image ? ` (picture ${(image.size / 1024).toFixed(0)} KB, ${image.width}×${image.height})` : ''}`)
}

// Launcher settings: the Discord id, the support link if any, the mod policy (kept as it is)
const settings = PublicSettingsSchema.parse({ ...(feed.discordAppId ? { discordAppId: feed.discordAppId } : {}), ...(feed.support ? { support: feed.support } : {}), ...(feed.modPolicy ? { modPolicy: feed.modPolicy } : {}) })
const value = q(JSON.stringify(settings))
sql.push(
  `INSERT INTO settings (key, value, updated_by, updated_at) VALUES ('public', ${value}, ${q(by)}, ${now}) ON CONFLICT(key) DO UPDATE SET value = json_patch(settings.value, ${value}), updated_by = ${q(by)}, updated_at = ${now};`,
  `INSERT INTO settings_versions (key, value, action, by, at) SELECT 'public', value, 'settings.import', ${q(by)}, ${now} FROM settings WHERE key = 'public';`,
)
console.log(`launcher settings: Discord id ${settings.discordAppId ?? '—'}, mod policy ${settings.modPolicy?.rules.length ?? 0} rules`)

const file = join(mkdtempSync(join(tmpdir(), 'herald-import-')), 'import.sql')
writeFileSync(file, sql.join('\n') + '\n')
execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['wrangler', 'd1', 'execute', DB, '--remote', '--config', CONFIG, '--file', file, '--yes'], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'], shell: process.platform === 'win32' })

// Every picture read back and checked byte for byte
for (const p of pictures) {
  const out = execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['wrangler', 'd1', 'execute', DB, '--remote', '--config', CONFIG, '--json', '--command', `"SELECT hex(bytes) AS h FROM images WHERE id = '${p.id}'"`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: process.platform === 'win32' })
  const hex = (JSON.parse(out)[0].results[0]?.h ?? '') as string
  const ok = sha('sha512', Buffer.from(hex, 'hex')) === p.sha512
  console.log(`picture ${p.id.slice(0, 12)}…: ${ok ? 'stored exactly' : 'DIFFERENT'}`)
  if (!ok) process.exitCode = 1
}
console.log('Imported (nothing published yet).')
