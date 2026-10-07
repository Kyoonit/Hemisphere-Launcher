// Hemisphere whitelist API — one file, no dependencies. Runs next to the Minecraft server.
//
//   GET /v1/whitelist/<uuid>   ->  { "whitelisted": true | false }
//   GET /health                ->  { "ok": true }
//
// Read-only: it only reads the server's whitelist.json. See README.md for setup (Node 18+, Cloudflare Tunnel).
//
// Environment:
//   WHITELIST_PATH  path to the Minecraft server's whitelist.json   (required)
//   PORT            default 8787
//   HOST            default 127.0.0.1 (the tunnel connects locally; nothing is exposed directly)
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'

const WHITELIST_PATH = process.env.WHITELIST_PATH
const PORT = Number(process.env.PORT ?? 8787)
const HOST = process.env.HOST ?? '127.0.0.1'
const RATE_LIMIT = 60 // requests per minute per client IP

if (!WHITELIST_PATH) {
  console.error('Set WHITELIST_PATH to the Minecraft server whitelist.json')
  process.exit(1)
}

// --- whitelist.json, re-read only when the file changes --------------------------------------------------
let cache = { mtimeMs: -1, uuids: new Set() }
async function whitelist() {
  const s = await stat(WHITELIST_PATH)
  if (s.mtimeMs !== cache.mtimeMs) {
    const entries = JSON.parse(await readFile(WHITELIST_PATH, 'utf8'))
    cache = { mtimeMs: s.mtimeMs, uuids: new Set(entries.map((e) => String(e.uuid).replace(/-/g, '').toLowerCase())) }
  }
  return cache.uuids
}

// --- tiny per-IP rate limiter ----------------------------------------------------------------------------
const hits = new Map()
function allowed(ip) {
  const minute = Math.floor(Date.now() / 60_000)
  const h = hits.get(ip)
  if (!h || h.minute !== minute) {
    hits.set(ip, { minute, count: 1 })
    if (hits.size > 10_000) hits.clear()
    return true
  }
  return ++h.count <= RATE_LIMIT
}

// --- HTTP ------------------------------------------------------------------------------------------------
const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  res.end(JSON.stringify(body))
}

const server = createServer(async (req, res) => {
  // Behind Cloudflare Tunnel the real client IP is in CF-Connecting-IP.
  const ip = req.headers['cf-connecting-ip'] ?? req.socket.remoteAddress ?? '?'
  if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' })
  if (!allowed(ip)) return send(res, 429, { error: 'too many requests' })

  const url = new URL(req.url ?? '/', 'http://localhost')
  if (url.pathname === '/health') return send(res, 200, { ok: true })

  const m = /^\/v1\/whitelist\/([0-9a-fA-F-]{32,36})$/.exec(url.pathname)
  if (!m) return send(res, 404, { error: 'not found' })
  const uuid = m[1].replace(/-/g, '').toLowerCase()
  if (!/^[0-9a-f]{32}$/.test(uuid)) return send(res, 400, { error: 'invalid uuid' })

  try {
    return send(res, 200, { whitelisted: (await whitelist()).has(uuid) })
  } catch (err) {
    console.error('whitelist read failed:', err.message)
    return send(res, 503, { error: 'whitelist unavailable' })
  }
})

server.listen(PORT, HOST, () => console.log(`Hemisphere whitelist API on http://${HOST}:${PORT} (reading ${WHITELIST_PATH})`))
