// npm run release        publishes a new launcher version on GitHub (players' launchers update themselves)
// npm run release:fix    completes the current version's release (uploads what's missing, nothing is rebuilt)
//
// Versions only change here: 1.1, then 1.2… (package.json holds 1.1.0, 1.2.0…). Between releases, every change is
// recorded in src/shared/launcherChangelog.json with "version": "next"; this script:
//   1. picks the version: the next minor after the latest GitHub release (or the pending one, if a previous attempt
//      stopped before publishing), stamps the "next" changes with it, sets package.json, commits and pushes that;
//   2. builds the installer (dist/Hemisphere-Launcher-Setup-<version>.exe, its .blockmap) and writes latest.yml;
//   3. creates the GitHub release and uploads the 3 files one by one (retried), then checks them online.
// Needs GH_TOKEN (fine-grained token, Contents: read and write on this repository).
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'

const REPO = 'Kyoonit/Hemisphere-Launcher'
const CHANGELOG = 'src/shared/launcherChangelog.json'
const fix = process.argv.includes('--fix')
const token = process.env.GH_TOKEN

class Stop extends Error {}
const fail = (msg) => {
  console.error(`\n✗ release: ${msg}\n`)
  throw new Stop(msg)
}
const cmp = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number))
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0)
  return 0
}
const short = (v) => v.replace(/\.0$/, '') // 1.1.0 -> 1.1
const run = (cmd) => execSync(cmd, { stdio: 'inherit' })
const api = async (path, init = {}) => {
  const res = await fetch(path.startsWith('http') ? path : `https://api.github.com/repos/${REPO}${path}`, {
    ...init,
    headers: { 'User-Agent': 'hemisphere-release', Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, ...init.headers },
  })
  return res
}
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'))

/** latest.yml, as installed launchers (electron-updater) read it, computed from the installer itself. */
function latestYml(version, exe) {
  const buf = readFileSync(`dist/${exe}`)
  const sha512 = createHash('sha512').update(buf).digest('base64')
  return `version: ${version}\nfiles:\n  - url: ${exe}\n    sha512: ${sha512}\n    size: ${buf.length}\npath: ${exe}\nsha512: ${sha512}\nreleaseDate: '${new Date().toISOString()}'\n`
}

/** The release notes: a short introduction for the very first release, then what changed in this version. */
function notes(version, log, first) {
  const changes = log.flatMap((d) => d.changes.filter((c) => c.version === version))
  if (first || !changes.length)
    return `**Hemisphere Launcher ${short(version)}**: Hemisphere SMP's mods installed and kept up to date, news, events and the server status, in one place.\n\n**Hemisphere Launcher ${short(version)}** : les mods d’Hemisphere SMP installés et tenus à jour, les news, les événements et le statut du serveur, au même endroit.\n\nWindows 10 / 11 · download **Hemisphere-Launcher-Setup-${version}.exe** below.\n`
  return `## What's new in ${short(version)}\n\n${changes.map((c) => `- ${c.en}`).join('\n')}\n\n## Nouveautés de la ${short(version)}\n\n${changes.map((c) => `- ${c.fr}`).join('\n')}\n`
}

async function upload(release, name, data, contentType) {
  for (const old of release.assets.filter((a) => a.name === name)) {
    if (old.state === 'uploaded' && old.size === data.length) return console.log(`  ${name}: already online`)
    await api(`/releases/assets/${old.id}`, { method: 'DELETE' }) // a broken or different copy: replaced
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    process.stdout.write(`  ${name} (${Math.round(data.length / 1e6) || '<1'} MB)… `)
    const res = await api(`https://uploads.github.com/repos/${REPO}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'Content-Type': contentType, 'Content-Length': String(data.length) },
      body: data,
    }).catch((err) => ({ ok: false, status: String(err?.cause?.code ?? err) }))
    if (res.ok) return console.log('uploaded')
    console.log(`failed (${res.status})${attempt < 3 ? ', trying again' : ''}`)
    if (res.status === 422) {
      // a half-finished upload left an asset with that name: remove it and retry
      const again = await (await api(`/releases/${release.id}`)).json()
      for (const a of again.assets.filter((a) => a.name === name)) await api(`/releases/assets/${a.id}`, { method: 'DELETE' })
    }
    await new Promise((r) => setTimeout(r, 3000 * attempt))
  }
  fail(`couldn't upload ${name}: check the connection and run npm run release:fix`)
}

async function main() {
  if (!token) fail('GH_TOKEN is missing: $env:GH_TOKEN = "<token>" first (see docs/RELEASE.md)')
  const latestRes = await api('/releases/latest')
  const last = latestRes.ok ? String((await latestRes.json()).tag_name).replace(/^v/, '') : null
  const pkg = readJson('package.json')
  const log = readJson(CHANGELOG)

  let version = pkg.version
  if (!fix) {
    // a version newer than the last release that never got published (an attempt that stopped): finish that one
    const pending = last === null || cmp(pkg.version, last) > 0
    if (!pending) {
      const [major, minor] = last.split('.').map(Number)
      version = `${major}.${minor + 1}.0`
    }
    const next = log.flatMap((d) => d.changes).filter((c) => c.version === 'next')
    for (const c of next) c.version = version
    if (!pending && !next.length) fail(`nothing new since ${short(last)}: no change with "version": "next" in ${CHANGELOG}`)
    if (next.length || version !== pkg.version) {
      for (const d of log) for (const c of d.changes) if (c.version === 'next') c.version = version
      writeFileSync(CHANGELOG, JSON.stringify(log, null, 2) + '\n')
      pkg.version = version
      writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n')
      const lock = readJson('package-lock.json')
      lock.version = version
      if (lock.packages?.['']) lock.packages[''].version = version
      writeFileSync('package-lock.json', JSON.stringify(lock, null, 2) + '\n')
      run(`git add package.json package-lock.json ${CHANGELOG}`)
      run(`git commit -m "Release v${version}"`)
      run('git push')
    }
    console.log(`\nrelease: building Hemisphere Launcher ${short(version)} (v${version})\n`)
    run('npm run build')
    run('npx electron-builder --win --publish never')
  }

  const exe = `Hemisphere-Launcher-Setup-${version}.exe`
  if (!existsSync(`dist/${exe}`) || !existsSync(`dist/${exe}.blockmap`)) fail(`dist/${exe} (or its .blockmap) is missing: run npm run release`)
  writeFileSync('dist/latest.yml', latestYml(version, exe))

  // the release: created now, or the existing one for this version (completed)
  let res = await api(`/releases/tags/v${version}`)
  let release = res.ok ? await res.json() : null
  if (!release) {
    if (fix) fail(`no release v${version} on GitHub to complete: run npm run release`)
    res = await api('/releases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag_name: `v${version}`, target_commitish: 'main', name: `Hemisphere Launcher ${short(version)}`, body: notes(version, log, last === null), draft: false, prerelease: false }),
    })
    if (!res.ok) fail(`GitHub refused to create the release (HTTP ${res.status}: ${(await res.text()).slice(0, 200)})`)
    release = await res.json()
  }
  console.log(`\nrelease: uploading to ${release.html_url}`)
  await upload(release, exe, readFileSync(`dist/${exe}`), 'application/octet-stream')
  await upload(release, `${exe}.blockmap`, readFileSync(`dist/${exe}.blockmap`), 'application/octet-stream')
  await upload(release, 'latest.yml', readFileSync('dist/latest.yml'), 'text/yaml')
  console.log('')
  try {
    run('node tools/release-check.mjs')
  } catch {
    fail('the online check failed (see above): run npm run release:fix to complete the release')
  }
  console.log(`\n✓ Hemisphere Launcher ${short(version)} is out. Installed launchers update within 4 hours (or when closed).\n`)
}

main().catch((err) => {
  if (!(err instanceof Stop)) console.error(err)
  process.exitCode = 1
})
