import { app } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'

/**
 * Mod icons straight from Modrinth, so they stay current without republishing the client.
 * One bulk request for all projects, cached on disk and refreshed once a day (or when the mod list changes).
 */

const REFRESH_MS = 24 * 60 * 60 * 1000
const cachePath = () => join(app.getPath('userData'), 'mod-icons.json')

const ProjectsSchema = z.array(z.object({ id: z.string(), icon_url: z.string().nullable() }))
const CacheSchema = z.object({ fetchedAt: z.number(), icons: z.record(z.string(), z.string()) })

/** Only images from Modrinth's own CDN are shown. */
const isModrinthImage = (url: string) => {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && u.hostname === 'cdn.modrinth.com'
  } catch {
    return false
  }
}

async function readCache(): Promise<z.infer<typeof CacheSchema> | null> {
  try {
    const parsed = CacheSchema.safeParse(JSON.parse(await readFile(cachePath(), 'utf8')))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** projectId -> icon URL. Never throws: on any problem, returns what's cached (possibly nothing). */
export async function getModIcons(projectIds: string[]): Promise<Record<string, string>> {
  const cached = await readCache()
  const fresh = cached && Date.now() - cached.fetchedAt < REFRESH_MS && projectIds.every((id) => id in cached.icons)
  if (fresh) return cached.icons

  try {
    const url = `https://api.modrinth.com/v2/projects?ids=${encodeURIComponent(JSON.stringify(projectIds))}`
    const res = await fetch(url, {
      headers: { 'User-Agent': `Kyoonit/Hemisphere-Launcher/${app.getVersion()}` },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const icons: Record<string, string> = {}
    for (const p of ProjectsSchema.parse(await res.json())) {
      if (p.icon_url && isModrinthImage(p.icon_url)) icons[p.id] = p.icon_url
      else icons[p.id] = '' // known to have no icon: don't ask again until the next refresh
    }
    await writeFile(cachePath(), JSON.stringify({ fetchedAt: Date.now(), icons }))
    return icons
  } catch (err) {
    console.warn('[icons] using cached mod icons:', err instanceof Error ? err.message : err)
    return cached?.icons ?? {}
  }
}
