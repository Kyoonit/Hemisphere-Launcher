import { z } from 'zod'

/**
 * Asks the Hemisphere API whether a player is whitelisted (server/whitelist-api).
 * Returns null when the answer is unknown (service down, offline…): the launcher then doesn't block — the Minecraft
 * server stays the real authority.
 */

export const API_BASE = 'https://api.hemispheresurvival.club'
const Schema = z.object({ whitelisted: z.boolean() })
const positive = new Map<string, number>() // uuid -> time of last "yes" (approved players stay approved)
const CACHE_MS = 10 * 60_000

export async function checkWhitelist(uuid: string, base = API_BASE): Promise<boolean | null> {
  const seen = positive.get(uuid)
  if (seen && Date.now() - seen < CACHE_MS) return true
  try {
    const res = await fetch(`${base}/v1/whitelist/${uuid}`, { signal: AbortSignal.timeout(5_000), cache: 'no-store' })
    if (!res.ok) return null
    const parsed = Schema.safeParse(await res.json())
    if (!parsed.success) return null
    if (parsed.data.whitelisted) positive.set(uuid, Date.now())
    return parsed.data.whitelisted
  } catch {
    return null
  }
}
