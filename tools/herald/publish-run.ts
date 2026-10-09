// The Herald publish program (see publisher.ts). Environment:
//   HERALD_URL        the Herald server            PUBLISHER_TOKEN   shared secret with the server
//   SIGNING_KEY       content signing key, PKCS#8 DER base64 (a TEST key outside production)
//   HERALD_REPO_DIR   repository checkout to commit in (default: current folder)
//   HERALD_NO_GIT=1   write the files but do not commit/push (local tests); reports commit "local"
import { execFileSync } from 'node:child_process'
import { createPrivateKey } from 'node:crypto'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { buildRelease, checkOnModrinth, errorText, PackError, type PublishJob } from './publisher.ts'
import { modrinthGetter, type MrVersion } from '../../src/shared/heraldPack.ts'
import { ClientManifestSchema } from '../../src/shared/manifest.ts'

const env = (name: string) => {
  const v = process.env[name]
  if (!v) throw new Error(`${name} is not set`)
  return v
}
const server = env('HERALD_URL').replace(/\/$/, '')
const call = async (path: string, body: unknown) => {
  const res = await fetch(server + path, { method: 'POST', signal: AbortSignal.timeout(30_000), headers: { authorization: `Bearer ${env('PUBLISHER_TOKEN')}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`Herald server ${path}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`)
  return (await res.json()) as Record<string, any>
}

async function main() {
  const { job, contentDir } = (await call('/internal/next', {})) as { job: PublishJob | null; contentDir: string }
  if (!job) return console.log('Nothing to publish (already published by an earlier run).')
  console.log(`Publishing ${job.id} as sequence ${job.sequence}`)
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
      const res = await fetch(`${server}/internal/file/${f.path}`, { signal: AbortSignal.timeout(60_000), headers: { authorization: `Bearer ${env('PUBLISHER_TOKEN')}` } })
      if (!res.ok) throw new Error(`Herald server: file ${f.path}: HTTP ${res.status}`)
      f.b64 = Buffer.from(await res.arrayBuffer()).toString('base64')
    }
    if (job.pack) {
      // Mod pack: every mod checked against Modrinth again, config files fetched from the server
      const manifest = ClientManifestSchema.parse(job.pack.manifest)
      const get = modrinthGetter('Kyoonit/Hemisphere-Launcher (Herald publisher)')
      const ids = manifest.mods.flatMap((m) => (m.source ? [m.source.modrinth.versionId] : []))
      const versions: MrVersion[] = []
      for (let i = 0; i < ids.length; i += 50) versions.push(...(await get<MrVersion[]>(`/versions?ids=${encodeURIComponent(JSON.stringify(ids.slice(i, i + 50)))}`)))
      checkOnModrinth(manifest, versions)
      job.pack.fileBytes = {}
      for (const f of manifest.files) {
        const res = await fetch(`${server}/internal/file/pack/${f.sha512.slice(0, 64)}.bin`, { signal: AbortSignal.timeout(60_000), headers: { authorization: `Bearer ${env('PUBLISHER_TOKEN')}` } })
        if (!res.ok) throw new PackError(`mod pack: file ${f.path}: HTTP ${res.status}`)
        job.pack.fileBytes[f.sha512] = Buffer.from(await res.arrayBuffer()).toString('base64')
      }
    }
    const read = (path: string) => (existsSync(join(repo, path)) ? readFileSync(join(repo, path)) : null)
    const files = buildRelease(job, contentDir, key, new Date(), read)
    for (const f of files) {
      mkdirSync(dirname(join(repo, f.path)), { recursive: true })
      writeFileSync(join(repo, f.path), f.bytes)
    }
    let commit = 'local'
    if (process.env.HERALD_NO_GIT !== '1') {
      const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
      git('config', 'user.name', 'Herald Publisher')
      git('config', 'user.email', 'herald-publisher@users.noreply.github.com')
      git('add', ...files.map((f) => f.path))
      git('commit', '-q', '-m', `Herald: publish sequence ${job.sequence}${files.some((f) => f.path.endsWith('/index.json')) ? ` (mod pack ${ClientManifestSchema.parse(job.pack!.manifest).clientVersion})` : ''}`)
      for (let attempt = 1; ; attempt++) {
        try {
          git('push', '-q', 'origin', 'HEAD')
          break
        } catch (err) {
          if (attempt >= 3) throw err
        }
      }
      commit = git('rev-parse', 'HEAD')
    }
    await call('/internal/done', { id: job.id, commit })
    console.log(`Published sequence ${job.sequence} in ${commit}`)
  } catch (err) {
    console.error(`Refused: ${errorText(err)}`)
    await call('/internal/failed', { id: job.id, error: errorText(err), ...(err instanceof PackError ? { part: 'pack' } : {}) })
    process.exitCode = 1
  }
}

await main()
