// npm run herald:release     publishes a new Herald version to the PRIVATE repository Kyoonit/herald-releases;
//                            installed Herald apps download it through the Herald server (signed-in staff only).
// Versions: 1.0, 1.1… (herald/app/package.json holds 1.0.0, 1.1.0…). This script:
//   1. picks the version: the next minor after the latest release (1.0.0 for the first one, or the pending one if a
//      previous attempt stopped before publishing), sets herald/app/package.json, commits and pushes that;
//   2. builds the installer (herald/app/dist/Herald-Setup-<version>.exe) and its latest.yml;
//   3. creates the release and uploads the installer and latest.yml (retried), then checks them online.
// Needs GH_TOKEN: a fine-grained token with Contents: read and write on Kyoonit/herald-releases.
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const REPO = 'Kyoonit/herald-releases'
const APP = 'herald/app'
const API = 'https://api.github.com'
const UPLOADS = 'https://uploads.github.com'
const token = process.env.GH_TOKEN

class Stop extends Error {}
const fail = (msg) => {
  console.error(`\n✗ herald release: ${msg}\n`)
  throw new Stop(msg)
}
const cmp = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number))
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0)
  return 0
}
const short = (v) => v.replace(/\.0$/, '')
const run = (cmd) => execSync(cmd, { stdio: 'inherit' })
/** GitHub request, tried again when the connection drops (GitHub closes idle connections during the build). */
const api = async (path, init = {}, attempts = 4) => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetch(path.startsWith('http') ? path : `${API}/repos/${REPO}${path}`, {
        ...init,
        headers: { 'User-Agent': 'herald-release', Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, ...init.headers },
      })
    } catch (err) {
      if (attempt >= attempts) throw err
      console.log(`  (connection to GitHub dropped: ${err?.cause?.code ?? err?.message}, trying again)`)
      await new Promise((r) => setTimeout(r, 2000 * attempt))
    }
  }
}

function latestYml(version, exe) {
  const buf = readFileSync(`${APP}/dist/${exe}`)
  const sha512 = createHash('sha512').update(buf).digest('base64')
  return `version: ${version}\nfiles:\n  - url: ${exe}\n    sha512: ${sha512}\n    size: ${buf.length}\npath: ${exe}\nsha512: ${sha512}\nreleaseDate: '${new Date().toISOString()}'\n`
}

async function upload(release, name, data, contentType) {
  for (const old of release.assets.filter((a) => a.name === name)) await api(`/releases/assets/${old.id}`, { method: 'DELETE' })
  for (let attempt = 1; attempt <= 3; attempt++) {
    process.stdout.write(`  ${name} (${Math.round(data.length / 1e6) || '<1'} MB)… `)
    const res = await api(`${UPLOADS}/repos/${REPO}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { 'Content-Type': contentType }, body: data }, 1).catch((err) => ({ ok: false, status: String(err?.cause?.code ?? err) }))
    if (res.ok) return console.log('uploaded')
    console.log(`failed (${res.status})${attempt < 3 ? ', trying again' : ''}`)
    const again = await (await api(`/releases/${release.id}`)).json()
    for (const a of again.assets.filter((a) => a.name === name)) await api(`/releases/assets/${a.id}`, { method: 'DELETE' })
    await new Promise((r) => setTimeout(r, 3000 * attempt))
  }
  fail(`couldn't upload ${name}: check the connection and run npm run herald:release again`)
}

async function main() {
  if (!token) fail('GH_TOKEN is missing: $env:GH_TOKEN = "<token>" first')
  // A release always talks to the production server: a test address left in this terminal would ship to the staff
  if (process.env.MAIN_VITE_HERALD_SERVER) fail('MAIN_VITE_HERALD_SERVER is set (a test build address): close this terminal or remove it, then run npm run herald:release again')
  const latestRes = await api('/releases/latest')
  if (!latestRes.ok && latestRes.status !== 404) fail(`GitHub answered ${latestRes.status} (${latestRes.status === 401 ? 'the token is wrong or expired' : latestRes.status === 403 ? 'the token lacks Contents: read and write on herald-releases' : 'try again later'})`)
  const last = latestRes.ok ? String((await latestRes.json()).tag_name).replace(/^v/, '') : null
  const pkgPath = `${APP}/package.json`
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  let version = last === null ? (cmp(pkg.version, '1.0.0') >= 0 ? pkg.version : '1.0.0') : cmp(pkg.version, last) > 0 ? pkg.version : `${last.split('.')[0]}.${Number(last.split('.')[1]) + 1}.0`
  if (version !== pkg.version) {
    pkg.version = version
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
    run(`git add ${pkgPath}`)
    run(`git commit -m "Herald release v${version}"`)
    run('git push')
  }
  console.log(`\nherald release: building Herald ${short(version)} (v${version})\n`)
  run('npm run herald:dist')
  const exe = `Herald-Setup-${version}.exe`
  if (!existsSync(`${APP}/dist/${exe}`)) fail(`${APP}/dist/${exe} is missing`)
  writeFileSync(`${APP}/dist/latest.yml`, latestYml(version, exe))

  let res = await api(`/releases/tags/v${version}`)
  let release = res.ok ? await res.json() : null
  if (!release) {
    res = await api('/releases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tag_name: `v${version}`, name: `Herald ${short(version)}`, body: `Herald ${short(version)}: staff publishing tool of Hemisphere SMP.`, draft: false, prerelease: false }) })
    if (res.status === 422) {
      const again = await api(`/releases/tags/v${version}`)
      if (again.ok) release = await again.json()
    }
    if (!release && !res.ok) fail(`GitHub refused to create the release (HTTP ${res.status}: ${(await res.text()).slice(0, 200)})`)
    release ??= await res.json()
  }
  console.log(`\nherald release: uploading to ${release.html_url}`)
  await upload(release, exe, readFileSync(`${APP}/dist/${exe}`), 'application/octet-stream')
  await upload(release, 'latest.yml', readFileSync(`${APP}/dist/latest.yml`), 'text/yaml')

  const check = await (await api(`/releases/tags/v${version}`)).json()
  const online = Object.fromEntries((check.assets ?? []).map((a) => [a.name, a]))
  if (online[exe]?.size !== readFileSync(`${APP}/dist/${exe}`).length || !online['latest.yml']) fail('the files online do not match: run npm run herald:release again')
  console.log(`\n✓ Herald ${short(version)} is out. Installed Herald apps update within 30 minutes (orange "Update" button).\n`)
}

main().catch((err) => {
  if (!(err instanceof Stop)) console.error(err)
  process.exitCode = 1
})
