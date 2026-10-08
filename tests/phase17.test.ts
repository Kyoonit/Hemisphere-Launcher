// Phase 17: news badge counting, graphics chip detection, new settings fields, changelog in the manifest.
import { describe, expect, test, vi } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { markNewsSeen, newsBadgeLabel, unseenNewsCount } from '../src/shared/feed'
import { ClientManifestSchema } from '../src/shared/manifest'

const userData = mkdtempSync(join(tmpdir(), 'hemi-p17-'))
vi.mock('electron', () => ({ app: { getPath: () => userData, isPackaged: true, getGPUInfo: async () => ({}) } }))
const { isHybridGpu } = await import('../src/main/core/system/gpu')

const news = (...ids: string[]) => ids.map((id) => ({ id }))

describe('news badge', () => {
  test('counts only news not seen yet', () => {
    expect(unseenNewsCount(news('a', 'b', 'c'), [])).toBe(3)
    expect(unseenNewsCount(news('a', 'b', 'c'), ['a', 'c'])).toBe(1)
    expect(unseenNewsCount(news('a'), ['a', 'old-removed'])).toBe(0)
  })
  test.each([
    [0, null],
    [1, '1'],
    [9, '9'],
    [10, '9+'],
    [57, '9+'],
  ])('%i unseen -> %s', (n, label) => expect(newsBadgeLabel(n)).toBe(label))
  test('opening News marks everything seen, newest first, capped', () => {
    expect(markNewsSeen(news('c', 'b'), ['a', 'b'])).toEqual(['c', 'b', 'a'])
    expect(markNewsSeen(news('x'), Array.from({ length: 600 }, (_, i) => `n${i}`)).length).toBe(500)
    expect(unseenNewsCount(news('c', 'b'), markNewsSeen(news('c', 'b'), []))).toBe(0)
  })
})

describe('two graphics chips', () => {
  const intel = { vendorId: 0x8086, deviceId: 1 }
  const nvidia = { vendorId: 0x10de, deviceId: 2 }
  const basicRender = { vendorId: 0x1414, deviceId: 0x8c }
  test('built-in + gaming card is hybrid', () => expect(isHybridGpu([intel, nvidia])).toBe(true))
  test('a single card is not', () => expect(isHybridGpu([nvidia])).toBe(false))
  test("Microsoft's virtual adapter doesn't count", () => expect(isHybridGpu([nvidia, basicRender])).toBe(false))
})

describe('settings', () => {
  test('new fields load with defaults and survive bad values', async () => {
    writeFileSync(join(userData, 'settings.json'), JSON.stringify({ seenNews: ['ok-id', 'BAD ID'], seenChangelog: 'nope', backgroundUpdates: 'yes' }))
    const { getSettings } = await import('../src/main/core/settings/settings')
    const s = getSettings()
    expect(s.seenNews).toEqual([])
    expect(s.seenChangelog).toBeNull()
    expect(s.backgroundUpdates).toBe(true)
    expect(s.highPerformanceGpu).toBe(true)
  })
})

describe('client changelog', () => {
  const base = {
    schema: 1,
    clientVersion: '1.0.2',
    createdAt: new Date().toISOString(),
    minecraft: '26.3',
    loader: { type: 'fabric', version: '0.19.5' },
    mods: [],
    files: [],
  }
  test('is optional (older manifests stay valid)', () => expect(ClientManifestSchema.safeParse(base).success).toBe(true))
  test('accepts localized lines', () => {
    const r = ClientManifestSchema.safeParse({ ...base, changelog: [{ en: 'Faster start', fr: 'Démarrage plus rapide' }] })
    expect(r.success && r.data.changelog?.length).toBe(1)
  })
})
