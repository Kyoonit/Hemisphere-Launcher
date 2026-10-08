/** A modest PC: the light interface turns on by itself (Settings > Launcher > Light interface: auto). */
export interface LowEndInfo {
  lowEnd: boolean
  ramGb: number
  threads: number
}

/** Developer tab > Performance: what the launcher costs right now. */
export interface PerfSnapshot {
  processes: { type: string; name: string; memoryMb: number; cpu: number }[]
  totalMb: number
  /** downloaded since the launcher started, per site */
  network: { host: string; requests: number; bytes: number }[]
  since: number
  windowOpen: boolean
}
