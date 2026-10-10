/** Hemisphere server facts and the shared server-status / playtime types. */
import type { Dimension } from './serverStats'

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
  /** where they are (BlueMap's list only) */
  dimension?: Dimension | null
}

export interface ServerStatus {
  /** null = unknown (status service unreachable and direct check failed) */
  online: boolean | null
  playersOnline: number | null
  playersMax: number | null
  version: string | null
  /** Everyone BlueMap shows (bots left out), else the sample sent by the server (max ~12): may be shorter than
   *  playersOnline (players hidden from the map, or not in the sample) */
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
