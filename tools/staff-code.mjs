// A new staff code for the Developer tab. Prints the code (share it with staff only) and the "staffCode" entry to
// paste into content-src/feed.json; publish with npm run content:feed. The code itself is never stored anywhere.
//   npm run staff-code             a random code
//   npm run staff-code -- MY-CODE  your own (at least 12 characters)
import { randomBytes, scryptSync } from 'node:crypto'

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // no 0/O/1/I/L
const part = () => [...randomBytes(4)].map((b) => ALPHABET[b % ALPHABET.length]).join('')
const given = process.argv[2]?.trim().toUpperCase()
if (given && given.length < 12) {
  console.error('The code needs at least 12 characters.')
  process.exit(1)
}
const code = given || `HEMI-${part()}-${part()}-${part()}`
const salt = randomBytes(16).toString('hex')
const hash = scryptSync(code, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex')

console.log(`\nStaff code (share it with staff only):\n\n    ${code}\n`)
console.log('Paste this into content-src/feed.json, then npm run content:feed:\n')
console.log(`  "staffCode": ${JSON.stringify({ salt, hash })}\n`)
console.log('Launchers then accept this code (the previous one stops working). Already unlocked PCs stay unlocked.\n')
