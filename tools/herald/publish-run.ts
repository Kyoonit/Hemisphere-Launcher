// The Herald publish program (see publisher.ts). Environment:
//   HERALD_URL        the Herald server            PUBLISHER_TOKEN   shared secret with the server
//   SIGNING_KEY       content signing key, PKCS#8 DER base64 (a TEST key outside production)
//   HERALD_REPO_DIR   repository checkout to commit in (default: current folder)
//   HERALD_NO_GIT=1   write the files but do not commit/push (local tests); reports commit "local"
// The content repository is PUBLIC, and so are its Actions logs: this program prints nothing about what it publishes
// (the reason of a refusal goes to the Herald server only), and its commits all say "Herald publish".
import { execFileSync } from 'node:child_process'
import { createHash, createPrivateKey, createPublicKey, verify } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { buildRelease, checkOnModrinth, errorText, PackError, type PublishJob } from './publisher.ts'
import { modrinthGetter, type MrVersion } from '../../src/shared/heraldPack.ts'
import { CONTENT_BASE, ClientManifestSchema, ContentIndexSchema } from '../../src/shared/manifest.ts'

const env = (name: string) => {
  const v = process.env[name]
  if (!v) throw new Error(`${name} is not set`)
  return v
}
const server = env('HERALD_URL').replace(/\/$/, '')
const call = async (path: string, body: unknown) => {
  const res = await fetch(server + path, { method: 'POST', signal: AbortSignal.timeout(30_000), headers: { authorization: `Bearer ${env('PUBLISHER_TOKEN')}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`Herald server ${path}: HTTP ${res.status}`)
  return (await res.json()) as Record<string, any>
}
const fetchFile = async (path: string) => {
  const res = await fetch(`${server}/internal/file/${path}`, { signal: AbortSignal.timeout(60_000), headers: { authorization: `Bearer ${env('PUBLISHER_TOKEN')}` } })
  if (!res.ok) throw new Error(`Herald server: a file: HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

/** Every file under a folder (paths relative to `root`) */
function walk(root: string, dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? walk(root, full) : [relative(root, full).replace(/\\/g, '/')]
  })
}

async function main() {
  const { job, contentDir } = (await call('/internal/next', {})) as { job: PublishJob | null; contentDir: string }
  if (!job) return console.log('Nothing to publish.')
  try {
    const key = createPrivateKey({ key: Buffer.from(env('SIGNING_KEY'), 'base64'), format: 'der', type: 'pkcs8' })
    const repo = process.env.HERALD_REPO_DIR ?? process.cwd()
    // Files of the job: already in the repository as listed → kept; otherwise fetched from the server (checked below)
    for (const f of job.files ?? []) {
      if (f.b64 || !/^v2\/(vaults|images)\/[a-z0-9-]{1,80}\.(bin|webp)$/.test(f.path)) continue
      const local = join(repo, contentDir, f.path)
      if (existsSync(local) && createHash('sha512').update(readFileSync(local)).digest('hex') === f.sha512) {
        f.keep = true
        continue
      }
      f.b64 = (await fetchFile(f.path)).toString('base64')
    }
    if (job.pack) {
      // Mod pack: every mod checked against Modrinth again, config files (sealed) fetched from the server
      const manifest = ClientManifestSchema.parse(job.pack.manifest)
      const get = modrinthGetter('Kyoonit/Hemisphere-Launcher (Herald publisher)')
      const ids = manifest.mods.flatMap((m) => (m.source ? [m.source.modrinth.versionId] : []))
      const versions: MrVersion[] = []
      for (let i = 0; i < ids.length; i += 50) versions.push(...(await get<MrVersion[]>(`/versions?ids=${encodeURIComponent(JSON.stringify(ids.slice(i, i + 50)))}`)))
      checkOnModrinth(manifest, versions)
      job.pack.fileBytes = {}
      for (const f of manifest.files) {
        try {
          job.pack.fileBytes[f.sha512] = (await fetchFile(`pack/${f.sha512.slice(0, 64)}.bin`)).toString('base64')
        } catch {
          throw new PackError(`mod pack: file ${f.path} could not be fetched`)
        }
      }
    }
    // No pack here yet (a new content repository): the pack in force is read where it was published before (the
    // launcher repository, in clear, its signature checked with this key), so that only its SEALED copy is written here
    const legacy = new Map<string, Buffer>()
    if (job.schema === 2 && !existsSync(join(repo, contentDir, 'index.bin')) && !existsSync(join(repo, contentDir, 'index.json'))) {
      try {
        const get = async (p: string) => Buffer.from(await (await fetch(CONTENT_BASE + p, { signal: AbortSignal.timeout(30_000) })).arrayBuffer())
        const text = await get('index.json')
        const sig = await get('index.json.sig')
        if (verify(null, text, createPublicKey(key), Buffer.from(sig.toString('utf8').trim(), 'base64'))) {
          const index = ContentIndexSchema.parse(JSON.parse(text.toString('utf8')))
          legacy.set(`${contentDir}/index.json`, text).set(`${contentDir}/index.json.sig`, sig)
          for (const ref of [index.latest, index.previous].filter((r) => r !== null)) legacy.set(`${contentDir}/${ref.manifest}`, await get(ref.manifest))
        }
      } catch {
        // nothing to bring over
      }
    }
    const read = (path: string) => (existsSync(join(repo, path)) ? readFileSync(join(repo, path)) : (legacy.get(path) ?? null))
    const release = await buildRelease(job, contentDir, key, new Date(), read)
    for (const f of release.writes) {
      mkdirSync(dirname(join(repo, f.path)), { recursive: true })
      writeFileSync(join(repo, f.path), f.bytes)
    }
    // Sealed content only: any other file left in the content folder (from before) goes
    const removed = job.schema === 2 ? walk(repo, join(repo, contentDir)).filter((p) => !p.endsWith('.bin')) : []
    let commit = 'local'
    if (process.env.HERALD_NO_GIT !== '1') {
      const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
      git('config', 'user.name', 'Herald Publisher')
      git('config', 'user.email', 'herald-publisher@users.noreply.github.com')
      if (removed.length) git('rm', '-q', '--', ...removed)
      git('add', '--', ...release.writes.map((f) => f.path))
      git('commit', '-q', '-m', 'Herald publish')
      for (let attempt = 1; ; attempt++) {
        try {
          git('push', '-q', 'origin', 'HEAD')
          break
        } catch (err) {
          if (attempt >= 3) throw err
        }
      }
      commit = git('rev-parse', 'HEAD')
    } else for (const p of removed) execFileSync(process.platform === 'win32' ? 'cmd' : 'rm', process.platform === 'win32' ? ['/c', 'del', join(repo, p)] : ['-f', join(repo, p)])
    await call('/internal/done', { id: job.id, commit, packSealed: release.packSealed })
    console.log('Published.')
  } catch (err) {
    console.error('Refused: the reason is shown in Herald.')
    await call('/internal/failed', { id: job.id, error: errorText(err), ...(err instanceof PackError ? { part: 'pack' } : {}) })
    process.exitCode = 1
  }
}

await main()
