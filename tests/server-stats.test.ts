import { describe, expect, it } from 'vitest'
import { blueMapPlayers, buildStatsView, emptyPresence, isBot, localTime, readStatusAnswer, statusRequest, statsZone, stepPresence, type SeenPlayer, type StatsRows } from '../src/shared/serverStats'

const M = 60_000
const T0 = 1_760_000_000_000 - (1_760_000_000_000 % M)

/** A status answer framed like the server sends it (length, packet id 0, the JSON as a string) */
function answer(doc: unknown): Uint8Array {
  const json = [...new TextEncoder().encode(JSON.stringify(doc))]
  const varint = (n: number) => {
    const out: number[] = []
    do {
      let b = n & 0x7f
      n >>>= 7
      if (n) b |= 0x80
      out.push(b)
    } while (n)
    return out
  }
  const body = [0x00, ...varint(json.length), ...json]
  return new Uint8Array([...varint(body.length), ...body])
}

describe('server list ping', () => {
  it('asks for the status with protocol -1, the host and the port', () => {
    const req = [...statusRequest('play.example.net', 25565)]
    const hostBytes = [...new TextEncoder().encode('play.example.net')]
    // handshake: length, id 0, varint(-1) = ff ff ff ff 0f, host, port 0x63dd, next state 1; then the request: 1, 0
    expect(req.slice(1, 7)).toEqual([0x00, 0xff, 0xff, 0xff, 0xff, 0x0f])
    expect(req.slice(8, 8 + hostBytes.length)).toEqual(hostBytes)
    expect(req.slice(-5)).toEqual([0x63, 0xdd, 0x01, 0x01, 0x00])
    expect(req[0]).toBe(req.length - 3)
  })

  it('reads the answer once complete, with a clean sample', () => {
    const full = answer({
      version: { name: 'Paper 1.21.8', protocol: 772 },
      players: { online: 14, max: 60, sample: [{ id: 'b2a9d70f-80a3-335e-bd53-5d41805079bb', name: 'Kyo' }, { id: 'nope', name: 'Bad' }, { id: '00000000-0000-4000-8000-000000000000', name: '§aAnnounce line' }] },
      description: { text: 'Hemisphere' },
    })
    expect(readStatusAnswer(full.subarray(0, full.length - 5))).toBeNull()
    expect(readStatusAnswer(full)).toEqual({ version: 'Paper 1.21.8', online: 14, max: 60, sample: [{ uuid: 'b2a9d70f80a3335ebd535d41805079bb', name: 'Kyo' }] })
    // a long answer (a big icon) still arrives in pieces
    const big = answer({ version: { name: 'x' }, players: { online: 0, max: 1 }, favicon: 'a'.repeat(40_000) })
    expect(readStatusAnswer(big.subarray(0, 100))).toBeNull()
    expect(readStatusAnswer(big)?.online).toBe(0)
  })
})

describe('BlueMap players', () => {
  const p = (uuid: string, name: string, foreign: boolean) => ({ uuid, name, foreign, position: { x: 0, y: 0, z: 0 } })
  const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  const C = 'cccccccc-cccc-3ccc-8ccc-cccccccccccc'

  it('lists everyone with the dimension they are in', () => {
    const seen = blueMapPlayers({
      overworld: { players: [p(A, 'Kyo', false), p(B, 'Alex', true), p(C, 'Loader_bot', true)] },
      nether: { players: [p(A, 'Kyo', true), p(B, 'Alex', false), p(C, 'Loader_bot', true)] },
      end: null,
    })
    expect(seen).toEqual([
      { uuid: A.replace(/-/g, ''), name: 'Kyo', dimension: 'overworld' },
      { uuid: B.replace(/-/g, ''), name: 'Alex', dimension: 'nether' },
      { uuid: C.replace(/-/g, ''), name: 'Loader_bot', dimension: null },
    ])
    expect(isBot(seen![2].uuid)).toBe(true)
    expect(isBot(seen![0].uuid)).toBe(false)
  })

  it('knows nothing without the overworld list, and skips broken entries', () => {
    expect(blueMapPlayers({ overworld: null, nether: { players: [] } })).toBeNull()
    expect(blueMapPlayers({ overworld: { players: [{ uuid: 'x', name: 'Kyo' }, { uuid: A, name: '<b>' }] } })).toEqual([])
  })
})

describe('sessions', () => {
  const kyo: SeenPlayer = { uuid: 'a'.repeat(32), name: 'Kyo', dimension: 'overworld' }
  const alex: SeenPlayer = { uuid: 'b'.repeat(32), name: 'Alex', dimension: 'nether' }

  it('opens a session on arrival and counts the minutes in each dimension', () => {
    let s = stepPresence(emptyPresence(), [kyo], true, T0)
    expect(s.started).toEqual([kyo])
    s = stepPresence(s.next, [kyo, alex], true, T0 + M)
    s = stepPresence(s.next, [{ ...kyo, dimension: 'end' }, alex], true, T0 + 2 * M)
    expect(s.next.players[kyo.uuid]).toMatchObject({ since: T0, seen: T0 + 2 * M, minutes: 3, overworld: 2, end: 1 })
    expect(s.next.players[alex.uuid]).toMatchObject({ since: T0 + M, minutes: 2, nether: 2 })
  })

  it('a minute already collected changes nothing', () => {
    const s = stepPresence(emptyPresence(), [kyo], true, T0)
    expect(stepPresence(s.next, [], true, T0)).toEqual({ next: s.next, ended: [], started: [] })
  })

  it('a short absence keeps the session; a longer one ends it where the player was last seen', () => {
    let s = stepPresence(emptyPresence(), [kyo], true, T0)
    s = stepPresence(s.next, [], true, T0 + 2 * M)
    expect(s.ended).toEqual([])
    s = stepPresence(s.next, [kyo], true, T0 + 3 * M)
    // the missed minutes count (up to the grace)
    expect(s.next.players[kyo.uuid]).toMatchObject({ since: T0, minutes: 4 })
    s = stepPresence(s.next, [], true, T0 + 6 * M)
    expect(s.ended).toEqual([{ uuid: kyo.uuid, name: 'Kyo', startedAt: T0, endedAt: T0 + 4 * M, minutes: 4, overworld: 4, nether: 0, end: 0 }])
    expect(s.next.players).toEqual({})
  })

  it('a partial list (the ping sample) ends nobody before the long limit', () => {
    let s = stepPresence(emptyPresence(), [kyo, alex], true, T0)
    s = stepPresence(s.next, [{ ...kyo, dimension: null }], false, T0 + 5 * M)
    expect(s.ended).toEqual([])
    expect(s.next.players[alex.uuid]).toBeDefined()
    s = stepPresence(s.next, [{ ...kyo, dimension: null }], false, T0 + 10 * M)
    expect(s.ended.map((e) => e.name)).toEqual(['Alex'])
  })
})

describe('statistics view', () => {
  const NOW = Date.UTC(2026, 9, 14, 12, 0) // Wednesday 14:00 in Paris (summer time)
  const H = 3_600_000
  const real = 'a'.repeat(12) + '4' + 'a'.repeat(19)
  const other = 'b'.repeat(12) + '4' + 'b'.repeat(19)
  const bot = 'c'.repeat(12) + '3' + 'c'.repeat(19)
  const rows = (): StatsRows => ({
    collectingSince: NOW - 3 * 86_400_000,
    last: { at: NOW - M, online: 1, players: 3, max_players: 420, latency_ms: 20, version: '26.3' },
    presence: { at: NOW - M, players: { [real]: { name: 'Kyo', since: NOW - 2 * H, seen: NOW - M, minutes: 120, overworld: 100, nether: 20, end: 0 }, [bot]: { name: 'Load_bot', since: NOW - 9 * H, seen: NOW - M, minutes: 540, overworld: 540, nether: 0, end: 0 } } },
    buckets: [
      { t: NOW - 2 * H, mx: 2, up: 15, n: 15 },
      { t: NOW - H, mx: 5, up: 15, n: 15 },
      { t: NOW - 30 * M, mx: 0, up: 0, n: 15 },
    ],
    hours: [{ h: NOW - 7 * 86_400_000, av: 4 }, { h: NOW, av: 2 }, { h: NOW - H, av: null }],
    sessions: [{ uuid: other, name: 'Alex', started_at: NOW - 5 * H, minutes: 45, overworld: 30, nether: 0, end_minutes: 15 }],
    newPlayers: 1,
    allPlayers: 2,
    allTime: [
      { uuid: other, name: 'Alex', minutes: 600, sessions: 9 },
      { uuid: real, name: 'Kyo', minutes: 500, sessions: 4 },
    ],
    catalogue: [{ itemId: 'c-aaaaaaaaaa', name: 'Crown', players: 2 }],
  })

  it('counts the players and their time, without the bots', () => {
    const v = buildStatsView('day', NOW, rows())
    expect(v.online.map((p) => p.name)).toEqual(['Kyo'])
    expect(v.unique).toBe(2)
    expect(v.top).toEqual([
      { uuid: real, name: 'Kyo', minutes: 120, sessions: 1 },
      { uuid: other, name: 'Alex', minutes: 45, sessions: 1 },
    ])
    expect(v.sessions).toEqual({ count: 2, minutes: 165, averageMinutes: 83 })
    expect(v.dimensions).toEqual({ overworld: 130, nether: 20, end: 15 })
    expect(v.last).toMatchObject({ online: true, players: 3, max: 420 })
  })

  it('draws every slice of the range, says when the server did not answer, and its best moment', () => {
    const v = buildStatsView('day', NOW, rows())
    expect(v.curve).toHaveLength(97)
    expect(v.curve.filter((p) => p.players !== null)).toHaveLength(3)
    expect(v.curve.find((p) => p.at === NOW - 30 * M)).toEqual({ at: NOW - 30 * M, players: 0, up: 0 })
    expect(v.peak).toEqual({ players: 5, at: NOW - H })
    expect(v.uptime).toBeCloseTo(30 / 45)
  })

  it('places days and hours in the server time zone', () => {
    expect(localTime(NOW)).toEqual({ day: '2026-10-14', weekday: 2, hour: 14 })
    expect(localTime(Date.UTC(2026, 9, 14, 22, 30)).day).toBe('2026-10-15')
    const v = buildStatsView('week', NOW, rows())
    expect(v.days.at(-1)).toEqual({ day: '2026-10-14', players: 2, minutes: 165 })
    expect(v.days).toHaveLength(8)
    expect(v.heat[2][14]).toBe(3)
    expect(v.heat[2][13]).toBeNull()
  })

  it('counts days and hours in the viewer’s time zone', () => {
    // 14:00 in Paris is 08:00 in New York, 21:00 in Tokyo
    expect(localTime(NOW, 'America/New_York')).toEqual({ day: '2026-10-14', weekday: 2, hour: 8 })
    const v = buildStatsView('week', NOW, rows(), 'Asia/Tokyo')
    expect(v.zone).toBe('Asia/Tokyo')
    expect(v.heat[2][21]).toBe(3)
    expect(statsZone('Not/AZone')).toBe('Europe/Paris')
    expect(statsZone('America/Argentina/Buenos_Aires')).toBe('America/Argentina/Buenos_Aires')
  })

  it('ranks who played the most ever, with the sessions going on now', () => {
    expect(buildStatsView('day', NOW, rows()).topAllTime).toEqual([
      { uuid: real, name: 'Kyo', minutes: 620, sessions: 5 },
      { uuid: other, name: 'Alex', minutes: 600, sessions: 9 },
    ])
  })
})
