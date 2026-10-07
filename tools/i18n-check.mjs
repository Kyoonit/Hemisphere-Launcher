// Compares every locales/*.json file against locales/en.json (the source of truth).
// Usage: npm run i18n:check
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = join(import.meta.dirname, '..', 'locales')
const flatten = (obj, prefix = '') =>
  Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  )
// Plural forms (key_one, key_other, key_many…) differ per language: compare them by their base key.
const PLURAL = /_(zero|one|two|few|many|other)$/
const load = (file) => new Set(flatten(JSON.parse(readFileSync(join(dir, file), 'utf8'))).map((k) => k.replace(PLURAL, '')))

const source = load('en.json')
let problems = 0
for (const file of readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'en.json')) {
  const keys = load(file)
  const missing = [...source].filter((k) => !keys.has(k))
  const extra = [...keys].filter((k) => !source.has(k))
  problems += missing.length + extra.length
  console.log(`${file}: ${keys.size}/${source.size} keys` + (missing.length || extra.length ? '' : ' ✓'))
  missing.forEach((k) => console.log(`  missing  ${k}`))
  extra.forEach((k) => console.log(`  unused   ${k}`))
}
process.exitCode = problems ? 1 : 0
