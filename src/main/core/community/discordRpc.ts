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

export class DiscordPresence {
  private socket: Socket | null = null
  private ready: Promise<boolean> | null = null

  constructor(private readonly clientId: string) {}

  /** Connects to the Discord app (pipes discord-ipc-0…9). false = Discord isn't running. */
  private open(): Promise<boolean> {
    if (this.ready) return this.ready
    this.ready = (async () => {
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
        const ok = await new Promise<boolean>((resolve) => {
          const timer = setTimeout(() => resolve(false), 5000)
          socket.once('data', (data: Buffer) => {
            clearTimeout(timer)
            // READY: op 1 with {"evt":"READY"}
            resolve(data.length >= 8 && data.readInt32LE(0) === OP_FRAME && data.toString('utf8', 8).includes('"READY"'))
          })
          socket.write(frame(OP_HANDSHAKE, { v: 1, client_id: this.clientId }))
        })
        if (!ok) {
          socket.destroy()
          continue
        }
        socket.on('error', () => this.reset())
        socket.on('close', () => this.reset())
        socket.on('data', () => {}) // replies are not needed
        this.socket = socket
        return true
      }
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
