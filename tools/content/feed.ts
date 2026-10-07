// Publishes news, maintenance and restart time from content-src/feed.json (signed).
//   npm run content:feed            then commit + push content/ — launchers pick it up within ~10 minutes
// Images: a hemispheresurvival.club URL, or a file in content-src/news-images/ referenced as "news-images/<file>".
import { createPrivateKey, sign } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CONTENT_BASE } from '../../src/shared/manifest.ts'
import { FeedSchema, type Feed } from '../../src/shared/feed.ts'
import { defaultKeyPath } from './keyPath.ts'

const ROOT = join(import.meta.dirname, '..', '..')
const OUT = join(ROOT, 'content')
const src = JSON.parse(readFileSync(join(ROOT, 'content-src', 'feed.json'), 'utf8'))

// Local images: copy into content/news/images and point at the published copy.
for (const item of src.news ?? []) {
  if (typeof item.image === 'string' && item.image.startsWith('news-images/')) {
    const name = item.image.slice('news-images/'.length)
    if (!/^[\w.-]+\.(png|jpe?g|webp|avif)$/i.test(name)) throw new Error(`bad image name: ${item.image}`)
    const from = join(ROOT, 'content-src', 'news-images', name)
    if (!existsSync(from)) throw new Error(`content-src/${item.image} does not exist`)
    mkdirSync(join(OUT, 'news', 'images'), { recursive: true })
    copyFileSync(from, join(OUT, 'news', 'images', name))
    item.image = `${CONTENT_BASE}news/images/${name}`
  }
}

const feedPath = join(OUT, 'feed.json')
const previous = existsSync(feedPath) ? (JSON.parse(readFileSync(feedPath, 'utf8')) as Feed) : null
const { $comment: _ignored, ...body } = src
const feed: Feed = FeedSchema.parse({
  schema: 1,
  sequence: (previous?.sequence ?? 0) + 1,
  updatedAt: new Date().toISOString(),
  ...body,
  news: [...(body.news ?? [])].sort((a, b) => b.date.localeCompare(a.date)), // newest first
})

const keyPath = process.env.HEMI_SIGNING_KEY ?? defaultKeyPath()
if (!existsSync(keyPath)) {
  console.error(`No signing key at ${keyPath}. Run "npm run content:keygen" once (or set HEMI_SIGNING_KEY).`)
  process.exit(1)
}
const bytes = Buffer.from(JSON.stringify(feed, null, 2) + '\n')
writeFileSync(feedPath, bytes)
writeFileSync(`${feedPath}.sig`, sign(null, bytes, createPrivateKey(readFileSync(keyPath))).toString('base64') + '\n')

console.log(`Feed published (sequence ${feed.sequence}): ${feed.news.length} news, maintenance ${feed.maintenance.active ? 'ON' : 'off'}, restart ${feed.restart ? `${feed.restart.time} ${feed.restart.timeZone}` : 'none'}.`)
console.log('Next: commit and push content/ — launchers pick it up within ~10 minutes.')
