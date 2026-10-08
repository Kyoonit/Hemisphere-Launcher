// Runs before `npm run release`: every launcher release must come with its notes (en + fr), from
// src/shared/launcherChangelog.json (one entry per day, newest first).
// - The days marked "next" get the package.json version: they're what this release brings.
// - No "next" day (and none already marked with this version), or a change missing its English/French text: no release.
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

for (const day of log) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day.date)) fail(`bad date "${day.date}"`)
  for (const c of day.changes ?? []) {
    if (!AREAS.includes(c.area)) fail(`${day.date}: unknown area "${c.area}"`)
    if (!c.en?.trim() || !c.fr?.trim()) fail(`${day.date}: a change is missing its English or French text`)
  }
}
const next = log.filter((d) => d.version === 'next' && d.changes.length)
if (next.length) {
  for (const d of next) d.version = version
  writeFileSync(file, JSON.stringify(log, null, 2) + '\n')
  console.log(`release-notes: ${next.length} day(s) now marked ${version}. Commit ${file} after the release.`)
}
const days = log.filter((d) => d.version === version)
if (!days.length) fail(`nothing new for ${version}: add today's changes to ${file} (version "next").`)

const section = (lang) => days.map((d) => `### ${d.date}\n\n${d.changes.map((c) => `- ${c[lang]}`).join('\n')}`).join('\n\n')
mkdirSync('dist', { recursive: true })
writeFileSync('dist/release-notes.md', `## What's new\n\n${section('en')}\n\n## Nouveautés\n\n${section('fr')}\n`)
console.log(`release-notes: ${version} ✓ (${days.length} day(s), ${days.reduce((n, d) => n + d.changes.length, 0)} changes)`)
