import { randomUUID } from 'node:crypto'
import { connect, type Socket } from 'node:net'

/**
 * "Playing on Hemisphere SMP" in the player's Discord status: Discord's local rich-presence connection (a named pipe
 * to the Discord app on this PC; nothing goes over the internet from here, no Discord account access). Only sets and
 * clears an activity. If Discord isn't running, nothing happens.
 */
export interface Activity {
  details: string
  state?: string
  startedAt?: number
  largeImage?: string
  largeText?: string
  buttons?: { label: string; url: string }[]
}

const OP_HANDSHAKE = 0
const OP_FRAME = 1

function frame(op: number, payload: unknown): Buffer {
  const json = Buffer.from(JSON.stringify(payload), 'utf8')
  const head = Buffer.alloc(8)
  head.writeInt32LE(op, 0)
  head.writeInt32LE(json.length, 4)
  return Buffer.concat([head, json])
}

/** Why the status couldn't be shown: Discord isn't running, or the id isn't a Discord application's. */
export type PresenceError = 'noDiscord' | 'invalidId' | 'failed'

export class DiscordPresence {
  private socket: Socket | null = null
  private ready: Promise<boolean> | null = null
  lastError: PresenceError | null = null

  constructor(private readonly clientId: string) {}

  /** Connects to the Discord app (pipes discord-ipc-0…9). false = Discord isn't running. */
  private open(): Promise<boolean> {
    if (this.ready) return this.ready
    this.ready = (async () => {
      let reached = false
      for (let i = 0; i < 10; i++) {
        const socket = await new Promise<Socket | null>((resolve) => {
          const s = connect(`\\\\?\\pipe\\discord-ipc-${i}`)
          const fail = () => resolve(null)
          s.once('connect', () => {
            s.off('error', fail)
            resolve(s)
          })
          s.once('error', fail)
        })
        if (!socket) continue
        reached = true
        // the first whole frame Discord sends back: READY (op 1), or an error/close (op 2, e.g. 4000 Invalid Client ID)
        const answer = await new Promise<string>((resolve) => {
          let buf = Buffer.alloc(0)
          const timer = setTimeout(() => resolve('timeout'), 5000)
          const onData = (data: Buffer) => {
            buf = Buffer.concat([buf, data])
            if (buf.length < 8 || buf.length < 8 + buf.readInt32LE(4)) return
            clearTimeout(timer)
            socket.off('data', onData)
            const body = buf.toString('utf8', 8, 8 + buf.readInt32LE(4))
            resolve(buf.readInt32LE(0) === OP_FRAME && body.includes('"READY"') ? 'ready' : /Invalid Client ID|"code":\s*4000/i.test(body) ? 'invalidId' : 'failed')
          }
          socket.on('data', onData)
          socket.once('close', () => resolve(buf.length ? 'failed' : 'invalidId'))
          socket.write(frame(OP_HANDSHAKE, { v: 1, client_id: this.clientId }))
        })
        if (answer !== 'ready') {
          socket.destroy()
          this.lastError = answer === 'invalidId' ? 'invalidId' : 'failed'
          if (answer === 'invalidId') break // the same answer from every Discord pipe
          continue
        }
        this.lastError = null
        socket.on('error', () => this.reset())
        socket.on('close', () => this.reset())
        socket.on('data', () => {}) // replies are not needed
        this.socket = socket
        return true
      }
      if (!reached) this.lastError = 'noDiscord'
      this.ready = null
      return false
    })()
    return this.ready
  }

  private reset(): void {
    this.socket?.destroy()
    this.socket = null
    this.ready = null
  }

  /** Shows the activity (null clears it). */
  async set(activity: Activity | null): Promise<boolean> {
    if (!(await this.open()) || !this.socket) return false
    const args = activity
      ? {
          pid: process.pid,
          activity: {
            details: activity.details.slice(0, 128),
            ...(activity.state ? { state: activity.state.slice(0, 128) } : {}),
            ...(activity.startedAt ? { timestamps: { start: Math.floor(activity.startedAt / 1000) } } : {}),
            ...(activity.largeImage ? { assets: { large_image: activity.largeImage, large_text: activity.largeText ?? '' } } : {}),
            ...(activity.buttons?.length ? { buttons: activity.buttons.slice(0, 2) } : {}),
            instance: false,
          },
        }
      : { pid: process.pid }
    this.socket.write(frame(OP_FRAME, { cmd: 'SET_ACTIVITY', args, nonce: randomUUID() }))
    return true
  }

  close(): void {
    this.reset()
  }
}
