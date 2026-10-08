// Sync engine: mod selection rules, sync planning, verified downloads (retry, resume, corruption, host allowlist).
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyToggle, resolveEnabled, type SelectableMod } from '../src/shared/modSelection'
import { desiredFiles, emptyState, planSync, type DesiredFile } from '../src/main/core/sync/plan'
import { blobPath, downloadToStore } from '../src/main/core/sync/download'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir(), isPackaged: true } }))

const mods: SelectableMod[] = [
  { id: 'fabric-api', category: 'library', requires: [], defaultEnabled: true },
  { id: 'cloth-config', category: 'library', requires: [], defaultEnabled: true },
  { id: 'sodium', category: 'performance', requires: [], defaultEnabled: true },
  { id: 'moreculling', category: 'performance', requires: ['cloth-config'], defaultEnabled: true },
  { id: 'iris', category: 'visual', requires: ['sodium'], defaultEnabled: false },
  { id: 'sodium-extra', category: 'visual', requires: ['sodium', 'fabric-api'], defaultEnabled: false },
  { id: 'zoomify', category: 'comfort', requires: ['fabric-api'], defaultEnabled: true },
]

describe('mod selection', () => {
  test('defaults + only the libraries that are needed', () => {
    expect([...resolveEnabled(mods, {})].sort()).toEqual(['cloth-config', 'fabric-api', 'moreculling', 'sodium', 'zoomify'])
  })
  test('libraries disappear when nothing needs them', () => {
    const e = resolveEnabled(mods, { moreculling: false, zoomify: false })
    expect(e.has('cloth-config')).toBe(false)
    expect(e.has('fabric-api')).toBe(false)
  })
  test('turning Iris on also turns Sodium on', () => {
    const { choices, alsoChanged } = applyToggle(mods, { sodium: false }, 'iris', true)
    expect(resolveEnabled(mods, choices).has('sodium')).toBe(true)
    expect(alsoChanged).toEqual(['sodium'])
  })
  test('turning Sodium off also turns off Iris and Sodium Extra', () => {
    const { choices, alsoChanged } = applyToggle(mods, { iris: true, 'sodium-extra': true }, 'sodium', false)
    const e = resolveEnabled(mods, choices)
    expect(e.has('iris') || e.has('sodium-extra') || e.has('sodium')).toBe(false)
    expect(alsoChanged.sort()).toEqual(['iris', 'sodium-extra'])
  })
  test('players cannot toggle libraries', () => {
    expect(applyToggle(mods, {}, 'fabric-api', false).choices).toEqual({})
  })
  test('a stale choice cannot enable a mod whose requirement is off', () => {
    expect(resolveEnabled(mods, { iris: true, sodium: false }).has('iris')).toBe(false)
  })
})

const file = (path: string, sha = 'a', policy: DesiredFile['policy'] = 'managed'): DesiredFile => ({
  path,
  url: 'https://cdn.modrinth.com/x',
  sha512: sha.repeat(128).slice(0, 128),
  size: 10,
  policy,
  label: path,
})

describe('planSync', () => {
  test('fresh instance: everything is placed', () => {
    const p = planSync([file('mods/a.jar'), file('config/x.json', 'b', 'default')], emptyState(), new Map())
    expect(p.place.map((f) => f.path)).toEqual(['mods/a.jar', 'config/x.json'])
  })
  test('unchanged owned file is kept without re-hashing', () => {
    const s = { ...emptyState(), owned: { 'mods/a.jar': { sha512: 'a'.repeat(128), size: 10, mtimeMs: 5 } } }
    const p = planSync([file('mods/a.jar')], s, new Map([['mods/a.jar', { size: 10, mtimeMs: 5 }]]))
    expect(p.keep).toHaveLength(1)
    expect(p.check).toHaveLength(0)
  })
  test('modified or unknown file is checked', () => {
    const s = { ...emptyState(), owned: { 'mods/a.jar': { sha512: 'a'.repeat(128), size: 10, mtimeMs: 5 } } }
    const p = planSync([file('mods/a.jar'), file('mods/b.jar')], s, new Map([['mods/a.jar', { size: 10, mtimeMs: 99 }], ['mods/b.jar', { size: 3, mtimeMs: 1 }]]))
    expect(p.check.map((f) => f.path)).toEqual(['mods/a.jar', 'mods/b.jar'])
  })
  test('updated mod: new jar placed, old jar removed; player jars untouched', () => {
    const s = { ...emptyState(), owned: { 'mods/sodium-0.9.2.jar': { sha512: 'a'.repeat(128), size: 10, mtimeMs: 5 } } }
    const local = new Map([['mods/sodium-0.9.2.jar', { size: 10, mtimeMs: 5 }], ['mods/my-own-mod.jar', { size: 1, mtimeMs: 1 }]])
    const p = planSync([file('mods/sodium-0.9.3.jar', 'c')], s, local)
    expect(p.place.map((f) => f.path)).toEqual(['mods/sodium-0.9.3.jar'])
    expect(p.remove).toEqual(['mods/sodium-0.9.2.jar'])
  })
  test('"default" configs are never overwritten', () => {
    const existing = planSync([file('config/x.json', 'b', 'default')], emptyState(), new Map([['config/x.json', { size: 1, mtimeMs: 1 }]]))
    expect(existing.handOver).toHaveLength(1)
    expect(existing.place).toHaveLength(0)
    const seeded = planSync([file('config/x.json', 'b', 'default')], { ...emptyState(), seeded: { 'config/x.json': 'b' } }, new Map())
    expect(seeded.place).toHaveLength(0) // player deleted it on purpose: respected
  })
  test('"enforced" configs are restored when changed', () => {
    const s = { ...emptyState(), owned: { 'config/rules.json': { sha512: 'b'.repeat(128), size: 10, mtimeMs: 5 } } }
    const p = planSync([file('config/rules.json', 'b', 'enforced')], s, new Map([['config/rules.json', { size: 12, mtimeMs: 9 }]]))
    expect(p.check).toHaveLength(1)
  })
})

describe('downloadToStore', () => {
  const body = Buffer.from('x'.repeat(200_000))
  const sha = createHash('sha512').update(body).digest('hex')
  let server: Server
  let base = ''
  let mode: 'ok' | 'corrupt' | 'fail-once' | 'no-range' = 'ok'
  let requests: { range?: string }[] = []
  let store = ''

  beforeAll(async () => {
    server = createServer((req, res) => {
      requests.push({ range: req.headers.range })
      if (mode === 'fail-once' && requests.length === 1) return res.writeHead(503).end()
      const data = mode === 'corrupt' ? Buffer.from('y'.repeat(body.length)) : body
      const m = /bytes=(\d+)-/.exec(req.headers.range ?? '')
      if (m && mode !== 'no-range') {
        res.writeHead(206, { 'Content-Range': `bytes ${m[1]}-${data.length - 1}/${data.length}` })
        return res.end(data.subarray(Number(m[1])))
      }
      res.writeHead(200).end(data)
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  })
  afterAll(() => server.close())
  beforeEach(() => {
    requests = []
    mode = 'ok'
    store = mkdtempSync(join(tmpdir(), 'hemi-store-'))
  })

  const allowAll = { allowUrl: () => true }
  const f = () => ({ url: `${base}/mod.jar`, sha512: sha, size: body.length })

  test('downloads, verifies and stores by hash', async () => {
    let bytes = 0
    await downloadToStore(store, f(), (n) => (bytes += n), allowAll)
    expect(readFileSync(blobPath(store, sha)).equals(body)).toBe(true)
    expect(bytes).toBe(body.length)
  })
  test('already in the store: no request', async () => {
    await downloadToStore(store, f(), () => {}, allowAll)
    requests = []
    await downloadToStore(store, f(), () => {}, allowAll)
    expect(requests).toHaveLength(0)
  })
  test('resumes a partial download with an HTTP Range request', async () => {
    mkdirSync(join(store, '.partial'), { recursive: true })
    writeFileSync(join(store, '.partial', `${sha}.part`), body.subarray(0, 50_000))
    await downloadToStore(store, f(), () => {}, allowAll)
    expect(requests[0].range).toBe('bytes=50000-')
    expect(readFileSync(blobPath(store, sha)).equals(body)).toBe(true)
  })
  test('server without Range support: starts over and still succeeds', async () => {
    mode = 'no-range'
    mkdirSync(join(store, '.partial'), { recursive: true })
    writeFileSync(join(store, '.partial', `${sha}.part`), body.subarray(0, 50_000))
    await downloadToStore(store, f(), () => {}, allowAll)
    expect(readFileSync(blobPath(store, sha)).equals(body)).toBe(true)
  })
  test('retries after a server error', async () => {
    mode = 'fail-once'
    await downloadToStore(store, f(), () => {}, allowAll)
    expect(requests.length).toBe(2)
  })
  test('corrupted download is rejected and never enters the store', async () => {
    mode = 'corrupt'
    await expect(downloadToStore(store, f(), () => {}, { ...allowAll, attempts: 2 })).rejects.toThrow(/hash mismatch/)
    expect(existsSync(blobPath(store, sha))).toBe(false)
  })
  test('refuses hosts outside the allowlist without connecting', async () => {
    await expect(downloadToStore(store, f(), () => {})).rejects.toThrow(/not allowed/)
    expect(requests).toHaveLength(0)
    rmSync(store, { recursive: true, force: true })
  })
})

describe('mods the player took over', () => {
  const mod = (id: string) => ({
    id,
    name: id,
    description: { en: id },
    category: 'comfort' as const,
    recommended: false,
    defaultEnabled: true,
    requires: [],
    version: '1.0',
    file: { path: `mods/${id}.jar`, url: `https://x/${id}.jar`, sha512: 'a'.repeat(128), size: 1 },
  })
  const manifest = { schema: 1, clientVersion: '1.0.0', createdAt: '', minecraft: '26.3', loader: { type: 'fabric', version: '0.19.5' }, mods: [mod('jade'), mod('zoomify')], files: [] } as never
  test('are never placed by Hemisphere', () => {
    expect(desiredFiles(manifest, {}, ['jade']).map((f) => f.path)).toEqual(['mods/zoomify.jar'])
  })
  test('their file is not removed once Hemisphere stopped owning it', () => {
    const s = { ...emptyState(), detached: ['jade'] }
    const p = planSync(desiredFiles(manifest, {}, s.detached), s, new Map([['mods/jade.jar', { size: 5, mtimeMs: 1 }]]))
    expect(p.remove).toEqual([])
  })
})
