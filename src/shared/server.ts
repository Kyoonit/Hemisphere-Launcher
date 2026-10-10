/** Hemisphere server facts and the shared server-status / playtime types. */

export const SERVER = {
  host: 'play.hemispheresurvival.club',
  port: 25565,
} as const

/** The server's BlueMap (plain http) and the map of each dimension (BlueMap's own names) */
export const BLUEMAP = {
  url: 'http://play.hemispheresurvival.club:9090',
  maps: { overworld: 'hemisphere_survival', nether: 'hemisphere_survival_the_nether', end: 'hemisphere_survival_the_end' },
} as const

/** Daily restart. Will move to the remote launcher config in Phase 12. */
export const RESTART_SCHEDULE = {
  time: '17:00',
  timeZone: 'Europe/Paris',
  durationMin: 5,
} as const

export interface OnlinePlayer {
  name: string
  uuid: string
}

export interface ServerStatus {
  /** null = unknown (status service unreachable and direct check failed) */
  online: boolean | null
  playersOnline: number | null
  playersMax: number | null
  version: string | null
  /** Sample sent by the server (max ~12), may be shorter than playersOnline */
  players: OnlinePlayer[]
  /** Round-trip from this PC to the server, null if unreachable */
  latencyMs: number | null
  fetchedAt: number
}

export interface PlaytimeSummary {
  totalMs: number
  lastSessionMs: number | null
  weekMs: number
  sessions: number
}
