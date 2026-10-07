import type { Localized } from './manifest'

/** What the interface needs to know about the Hemisphere client (no URLs or hashes). */
export interface ModSummary {
  id: string
  name: string
  description: Localized
  category: 'performance' | 'voice' | 'visual' | 'comfort' | 'library'
  recommended: boolean
  defaultEnabled: boolean
  version: string
  size: number
  requires: string[]
}

export interface ClientSummary {
  clientVersion: string
  minecraft: string
  loader: string
  /** network = freshly verified; cache = last verified copy (offline or server problem) */
  source: 'network' | 'cache'
  mods: ModSummary[]
}
