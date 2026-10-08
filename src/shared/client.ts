import type { Localized } from './manifest'
import type { UpdateDecision } from './update'

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
  /** Modrinth icon (cdn.modrinth.com), empty when unknown/offline */
  icon: string
}

export interface ClientSummary {
  clientVersion: string
  minecraft: string
  loader: string
  /** network = freshly verified; cache = last verified copy (offline or server problem) */
  source: 'network' | 'cache'
  mods: ModSummary[]
  /** What PLAY should offer (update / play previous) */
  update: UpdateDecision
  /** Client version currently installed (null = nothing installed yet) */
  installedVersion: string | null
  /** "What's new" in the latest client */
  changelog: Localized[]
}
