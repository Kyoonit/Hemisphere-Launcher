import { connect } from 'node:net'
import { app } from 'electron'
import { z } from 'zod'
import { SERVER, type ServerStatus } from '@shared/server'

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
  const [api, latencyMs] = await Promise.all([fetchMcsrvstat(), measureLatency()])
  return {
    // The status service decides; if it's down, a successful TCP connection still means "online".
    online: api ? api.online : latencyMs !== null ? true : null,
    playersOnline: api?.players?.online ?? null,
    playersMax: api?.players?.max ?? null,
    version: api?.version ?? null,
    players: api?.players?.list ?? [],
    latencyMs,
    fetchedAt: Date.now(),
  }
}

/** Polls the status every minute and pushes each result to `onUpdate`. */
export function startStatusPolling(onUpdate: (status: ServerStatus) => void): () => void {
  const tick = () => void getServerStatus().then(onUpdate)
  tick()
  const timer = setInterval(tick, REFRESH_MS)
  return () => clearInterval(timer)
}
