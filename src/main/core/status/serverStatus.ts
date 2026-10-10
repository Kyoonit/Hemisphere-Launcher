import { connect } from 'node:net'
import { app } from 'electron'
import { z } from 'zod'
import { SERVER, type OnlinePlayer, type ServerStatus } from '@shared/server'
import { blueMapPlayers, blueMapPlayersUrl, DIMENSIONS, isBot, plainUuid } from '@shared/serverStats'

const REFRESH_MS = 60_000
const TIMEOUT_MS = 8_000

/** Response shape of https://api.mcsrvstat.us/3/<host> (only the fields we use). */
const McsrvstatSchema = z.object({
  online: z.boolean(),
  version: z.string().optional(),
  players: z
    .object({
      online: z.number().int().nonnegative(),
      max: z.number().int().nonnegative(),
      list: z.array(z.object({ name: z.string().max(16), uuid: z.string().uuid() })).optional(),
    })
    .optional(),
})

async function fetchMcsrvstat(): Promise<z.infer<typeof McsrvstatSchema> | null> {
  try {
    const res = await fetch(`https://api.mcsrvstat.us/3/${SERVER.host}`, {
      headers: { 'User-Agent': `HemisphereLauncher/${app.getVersion()}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) return null
    const parsed = McsrvstatSchema.safeParse(await res.json())
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** Everyone online and their dimension, from the server's BlueMap (null: the map did not answer) */
async function fetchBlueMap(): Promise<OnlinePlayer[] | null> {
  const lists = await Promise.all(
    DIMENSIONS.map(async (d) => {
      try {
        const res = await fetch(blueMapPlayersUrl(d), { headers: { 'User-Agent': `HemisphereLauncher/${app.getVersion()}` }, signal: AbortSignal.timeout(TIMEOUT_MS) })
        return [d, res.ok ? await res.json() : null] as const
      } catch {
        return [d, null] as const
      }
    }),
  )
  return blueMapPlayers(Object.fromEntries(lists))?.filter((p) => !isBot(p.uuid)) ?? null
}

/** TCP connect time from this PC to the server: a cheap, honest latency figure. */
function measureLatency(): Promise<number | null> {
  return new Promise((resolve) => {
    const start = performance.now()
    const socket = connect({ host: SERVER.host, port: SERVER.port, timeout: 4_000 })
    const done = (value: number | null) => {
      socket.destroy()
      resolve(value)
    }
    socket.once('connect', () => done(Math.round(performance.now() - start)))
    socket.once('timeout', () => done(null))
    socket.once('error', () => done(null))
  })
}

export async function getServerStatus(): Promise<ServerStatus> {
  const [api, latencyMs, mapped] = await Promise.all([fetchMcsrvstat(), measureLatency(), fetchBlueMap()])
  return {
    // The status service decides; if it's down, a successful TCP connection still means "online".
    online: api ? api.online : latencyMs !== null ? true : null,
    playersOnline: api?.players?.online ?? null,
    playersMax: api?.players?.max ?? null,
    version: api?.version ?? null,
    // BlueMap lists everyone (not only the server's sample of names); bots (offline-mode ids) are left out
    players: mapped ?? (api?.players?.list ?? []).filter((p) => !isBot(plainUuid(p.uuid) ?? '')),
    latencyMs,
    fetchedAt: Date.now(),
  }
}

/** While nobody looks at the launcher (and no notification needs the status): every 5 minutes only. */
const IDLE_MS = 5 * 60_000
let pollNow: () => void = () => {}
/** A fresh status right away (the launcher window opens again). */
export const refreshStatusNow = () => pollNow()

/** Polls the status every minute (every 5 when `idle()`) and pushes each result to `onUpdate`. */
export function startStatusPolling(onUpdate: (status: ServerStatus) => void, idle: () => boolean = () => false): () => void {
  let last = 0
  const poll = () => {
    last = Date.now()
    void getServerStatus().then(onUpdate)
  }
  pollNow = poll
  poll()
  const timer = setInterval(() => {
    if (idle() && Date.now() - last < IDLE_MS - 1000) return
    poll()
  }, REFRESH_MS)
  return () => clearInterval(timer)
}
