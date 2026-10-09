// Runs after `npm run release`: checks that the GitHub release really has what players and launchers need.
//   Hemisphere-Launcher-Setup-<version>.exe   the installer (same size as the one built here)
//   ...exe.blockmap                           lets launchers download only what changed
//   latest.yml                                how launchers find the update (its hash must be this installer's)
// An upload that stopped half-way (connection, closed window) is caught here instead of by players.
import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'

class Stop extends Error {}
const fail = (msg) => {
  console.error(`\n✗ release-check: ${msg}\n`)
  console.error('Fix: on GitHub, delete this release (and its tag), then run npm run release again with the window kept open.\n')
  throw new Stop(msg)
}

async function main() {
  const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
  const exe = `Hemisphere-Launcher-Setup-${version}.exe`
  const headers = { 'User-Agent': 'hemisphere-release-check', ...(process.env.GH_TOKEN ? { Authorization: `Bearer ${process.env.GH_TOKEN}` } : {}) }
  const res = await fetch(`https://api.github.com/repos/Kyoonit/Hemisphere-Launcher/releases/tags/v${version}`, { headers })
  if (!res.ok) fail(`release v${version} not found on GitHub (HTTP ${res.status})`)
  const release = await res.json()
  const asset = (name) => release.assets.find((a) => a.name === name && a.state === 'uploaded')

  const localSize = statSync(`dist/${exe}`).size
  const online = asset(exe)
  if (!online) fail(`${exe} is missing from the release`)
  if (online.size !== localSize) fail(`${exe} on GitHub is ${online.size} bytes, the one built here ${localSize}`)
  if (!asset(`${exe}.blockmap`)) fail(`${exe}.blockmap is missing from the release`)
  if (!asset('latest.yml')) fail('latest.yml is missing from the release: installed launchers would never see this update')

  const yml = await (await fetch(asset('latest.yml').browser_download_url, { headers: { 'User-Agent': 'hemisphere-release-check' } })).text()
  const sha = createHash('sha512').update(readFileSync(`dist/${exe}`)).digest('base64')
  if (!yml.includes(`version: ${version}`) || !yml.includes(sha)) fail('latest.yml on GitHub doesn’t match this installer (version or hash)')
  if (release.draft) fail('the release is still a draft: publish it on GitHub')

  console.log(`release-check: v${version} ✓ installer, blockmap and latest.yml are online and match (${Math.round(localSize / 1e6)} MB)`)
  console.log(`Players download it from: ${release.html_url}`)
}

// exit code without process.exit() (Node on Windows can crash when exiting during a network request)
main().catch((err) => {
  if (!(err instanceof Stop)) console.error(err)
  process.exitCode = 1
})
