// Runs before `npm run release`: every launcher release must come with its "What's new" (en + fr).
// - The "next" entry of src/shared/launcherChangelog.json becomes the package.json version (with today's date).
// - A version without notes, or English/French lists that don't match, stops the release.
// - Writes dist/release-notes.md, used as the GitHub release text.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const file = 'src/shared/launcherChangelog.json'
const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
const log = JSON.parse(readFileSync(file, 'utf8'))
const fail = (msg) => {
  console.error(`\n✗ release-notes: ${msg}\n`)
  process.exit(1)
}

let entry = log.find((r) => r.version === version)
const next = log.find((r) => r.version === 'next')
if (!entry && next) {
  next.version = version
  next.date = new Date().toISOString().slice(0, 10)
  entry = next
  writeFileSync(file, JSON.stringify(log, null, 2) + '\n')
  console.log(`release-notes: "next" is now ${version}. Commit ${file} after the release.`)
} else if (entry && next && next.en.length) {
  fail(`${version} already has notes, and "next" has more: raise "version" in package.json first.`)
}
if (!entry) fail(`no "What's new" for ${version}: add a "next" entry to ${file}.`)
if (!entry.en.length || entry.en.length !== entry.fr.length) fail(`${version}: needs the same number of English and French lines (${entry.en.length} / ${entry.fr.length}).`)
if (log.filter((r) => r.version === version).length > 1) fail(`${version} appears twice in ${file}.`)

mkdirSync('dist', { recursive: true })
writeFileSync(
  'dist/release-notes.md',
  `## What's new\n\n${entry.en.map((l) => `- ${l}`).join('\n')}\n\n## Nouveautés\n\n${entry.fr.map((l) => `- ${l}`).join('\n')}\n`,
)
console.log(`release-notes: ${version} ✓ (${entry.en.length} lines)`)
