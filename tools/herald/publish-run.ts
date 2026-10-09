// The Herald publish program (see publisher.ts). Environment:
//   HERALD_URL        the Herald server            PUBLISHER_TOKEN   shared secret with the server
//   SIGNING_KEY       content signing key, PKCS#8 DER base64 (a TEST key outside production)
//   HERALD_REPO_DIR   repository checkout to commit in (default: current folder)
//   HERALD_NO_GIT=1   write the files but do not commit/push (local tests); reports commit "local"
import { execFileSync } from 'node:child_process'
import { createPrivateKey } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { buildRelease, errorText, type PublishJob } from './publisher.ts'

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
    const files = buildRelease(job, contentDir, key)
    const repo = process.env.HERALD_REPO_DIR ?? process.cwd()
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
      git('commit', '-q', '-m', `Herald: publish sequence ${job.sequence}`)
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
    await call('/internal/failed', { id: job.id, error: errorText(err) })
    process.exitCode = 1
  }
}

await main()
