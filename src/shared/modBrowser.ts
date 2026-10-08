/**
 * Mod browser (Phase 18): Modrinth search limited to Fabric + the server's Minecraft version, with the staff
 * mod policy (signed, inside the feed) applied to search results and to the player's own mods.
 */
import { z } from 'zod'
import { LocalizedSchema, type Localized } from './manifest.ts'

/** Modrinth project ids are 8 base62 characters. */
export const MODRINTH_ID = /^[A-Za-z0-9]{8}$/

export const ModPolicySchema = z.object({
  rules: z
    .array(
      z.object({
        /** Modrinth project id */
        project: z.string().regex(MODRINTH_ID),
        /** for staff reading the file */
        name: z.string().max(80),
        /** blocked = can't be installed from the launcher; askStaff = allowed after the player confirms */
        verdict: z.enum(['blocked', 'askStaff']),
        reason: LocalizedSchema,
      }),
    )
    .max(500),
})
export type ModPolicy = z.infer<typeof ModPolicySchema>

export type ModVerdict = 'allowed' | 'askStaff' | 'blocked'

/** What the policy says about a project (unknown projects are allowed). */
export function policyFor(policy: ModPolicy | null | undefined, projectId: string | null): { verdict: ModVerdict; reason?: Localized } {
  const rule = projectId ? policy?.rules.find((r) => r.project === projectId) : undefined
  return rule ? { verdict: rule.verdict, reason: rule.reason } : { verdict: 'allowed' }
}

export interface ModSearchHit {
  projectId: string
  slug: string
  title: string
  description: string
  author: string
  /** cdn.modrinth.com icon, or '' */
  icon: string
  downloads: number
  verdict: ModVerdict
  reason?: Localized
  /** inHemisphere = shipped by Hemisphere already; installed = the player has it */
  state: 'available' | 'inHemisphere' | 'installed'
}

export interface ModSearchResult {
  hits: ModSearchHit[]
  total: number
  offset: number
  /** Minecraft version the search was limited to */
  minecraft: string
}

/** A .jar the player added themselves (from the browser, an import or by hand). */
export interface PlayerModInfo {
  file: string
  size: number
  /** in mods/ (true) or parked in mods-disabled/ (false) */
  enabled: boolean
  /** null = not found on Modrinth (added by hand) */
  projectId: string | null
  title: string | null
  icon: string
  versionNumber: string | null
  verdict: ModVerdict
  reason?: Localized
  /** a newer version for the current Minecraft version (after "Check for updates") */
  update: { versionNumber: string } | null
  /** Hemisphere ships this mod too: the player's copy is a duplicate */
  inHemisphere: boolean
  /** switched off because no version exists yet for this Minecraft version */
  incompatibleWith: string | null
}

export type InstallResult =
  | { ok: true; installed: string[]; alreadyHad: string[] }
  | { ok: false; reason: 'blocked' | 'needsConfirm' | 'notCompatible' | 'inHemisphere' | 'busy' | 'network' }

export interface UpdateCheck {
  checked: number
  updates: number
}

export interface UpdateApplied {
  updated: string[]
  /** no version for this Minecraft version: switched off (kept in mods-disabled/) */
  disabled: string[]
}
