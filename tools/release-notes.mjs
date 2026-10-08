// Runs before `npm run release`: every launcher release must come with its notes (en + fr), from
// src/shared/launcherChangelog.json (one entry per day, each change tagged with the version of the push that brought it).
// - The release brings every change newer than the latest GitHub release, up to package.json's version.
// - Nothing new, a change from a version above package.json, or a change missing its English/French text: no release.
// - Writes dist/release-notes.md, used as the GitHub release text.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const file = 'src/shared/launcherChangelog.json'
const AREAS = ['play', 'home', 'content', 'screenshots', 'community', 'settings', 'performance', 'launcher']
const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
const log = JSON.parse(readFileSync(file, 'utf8'))
const fail = (msg) => {
  console.error(`\n✗ release-notes: ${msg}\n`)
  process.exit(1)
}
const cmp = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number))
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]
  return 0
}

for (const day of log) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day.date)) fail(`bad date "${day.date}"`)
  for (const c of day.changes) {
    if (!/^\d+\.\d+\.\d+$/.test(c.version)) fail(`${day.date}: bad version "${c.version}"`)
    if (cmp(c.version, version) > 0) fail(`${day.date}: a change is marked ${c.version}, above package.json (${version})`)
    if (!AREAS.includes(c.area)) fail(`${day.date}: unknown area "${c.area}"`)
    if (!c.en?.trim() || !c.fr?.trim()) fail(`${day.date}: a change is missing its English or French text`)
  }
}

// the latest published release (none yet: everything is new)
const res = await fetch('https://api.github.com/repos/Kyoonit/Hemisphere-Launcher/releases/latest', { headers: { 'User-Agent': 'hemisphere-release-notes' } }).catch(() => null)
if (!res || (res.status !== 200 && res.status !== 404)) fail('could not reach GitHub to find the latest release')
const last = res.status === 404 ? '0.0.0' : String((await res.json()).tag_name).replace(/^v/, '')
if (cmp(version, last) <= 0) fail(`package.json says ${version}, but ${last} is already released`)

const days = log
  .map((d) => ({ date: d.date, changes: d.changes.filter((c) => cmp(c.version, last) > 0).sort((a, b) => cmp(b.version, a.version)) }))
  .filter((d) => d.changes.length)
if (!days.length) fail(`nothing new since ${last}: add the changes to ${file}`)

const section = (lang) => days.map((d) => `### ${d.date}\n\n${d.changes.map((c) => `- ${c[lang]}`).join('\n')}`).join('\n\n')
mkdirSync('dist', { recursive: true })
writeFileSync('dist/release-notes.md', `## What's new since ${last}\n\n${section('en')}\n\n## Nouveautés depuis ${last}\n\n${section('fr')}\n`)
console.log(`release-notes: ${version} ✓ (${days.reduce((n, d) => n + d.changes.length, 0)} changes since ${last})`)
