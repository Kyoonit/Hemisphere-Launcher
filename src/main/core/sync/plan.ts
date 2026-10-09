import { isSafeRelativePath, type ClientManifest } from '@shared/manifest'
import { resolveEnabled, type Choices } from '@shared/modSelection'

/** A file the instance should contain. */
export interface DesiredFile {
  path: string
  url: string
  sha512: string
  size: number
  /** managed = Hemisphere mod jar; enforced = config always reset; default = config copied once */
  policy: 'managed' | 'enforced' | 'default'
  label: string
  /** A config file stored sealed (Herald): url gives the sealed bytes, opened with this key */
  seal?: { key: string; sha512: string; size: number }
}

/** What the launcher remembers about the instance (instance/.hemisphere/state.json). */
export interface InstanceState {
  version: 1
  clientVersion: string | null
  /** Minecraft version of the installed client */
  minecraft: string | null
  /** player's mod choices, by mod id */
  choices: Choices
  /** files Hemisphere placed and still manages, with the metadata seen right after placing them */
  owned: Record<string, { sha512: string; size: number; mtimeMs: number }>
  /** "default" files already handed over to the player (path -> hash given) */
  seeded: Record<string, string>
  /** Hemisphere mods the player took over (own version, lock, removal): Hemisphere no longer places or updates them */
  detached: string[]
}

export const emptyState = (): InstanceState => ({ version: 1, clientVersion: null, minecraft: null, choices: {}, owned: {}, seeded: {}, detached: [] })

export interface LocalInfo {
  size: number
  mtimeMs: number
}

export interface SyncPlan {
  /** already correct (owned, unchanged since we placed it) */
  keep: DesiredFile[]
  /** present but unknown or changed: hash it to decide */
  check: DesiredFile[]
  /** missing: must be placed */
  place: DesiredFile[]
  /** "default" file the player already has: leave it, remember it as handed over */
  handOver: DesiredFile[]
  /** managed files that are no longer wanted */
  remove: string[]
}

export function desiredFiles(manifest: ClientManifest, choices: Choices, detached: readonly string[] = []): DesiredFile[] {
  const enabled = resolveEnabled(manifest.mods, choices)
  const playerOwned = new Set(detached)
  return [
    ...manifest.mods
      .filter((m) => enabled.has(m.id) && !playerOwned.has(m.id))
      .map((m): DesiredFile => ({ ...m.file, policy: 'managed', label: m.name })),
    ...manifest.files.map((f): DesiredFile => ({ path: f.path, url: f.url, sha512: f.sha512, size: f.size, policy: f.policy, label: f.path, ...(f.seal ? { seal: f.seal } : {}) })),
  ]
}

/** Decides what to do with each file. `local` = what's on disk now (by lower-case path). Pure function. */
export function planSync(desired: DesiredFile[], state: InstanceState, local: Map<string, LocalInfo>): SyncPlan {
  const plan: SyncPlan = { keep: [], check: [], place: [], handOver: [], remove: [] }
  const wanted = new Set<string>()

  for (const f of desired) {
    const key = f.path.toLowerCase()
    const onDisk = local.get(key)

    if (f.policy === 'default') {
      if (state.seeded[f.path] !== undefined) continue // already the player's file
      if (onDisk) plan.handOver.push(f) // player already has one: never overwrite it
      else plan.place.push(f)
      continue
    }

    wanted.add(key)
    const owned = state.owned[f.path]
    if (!onDisk) plan.place.push(f)
    else if (owned && owned.sha512 === f.sha512 && owned.size === onDisk.size && owned.mtimeMs === onDisk.mtimeMs) plan.keep.push(f)
    else plan.check.push(f)
  }

  for (const path of Object.keys(state.owned)) {
    if (!wanted.has(path.toLowerCase()) && isSafeRelativePath(path)) plan.remove.push(path)
  }
  return plan
}
