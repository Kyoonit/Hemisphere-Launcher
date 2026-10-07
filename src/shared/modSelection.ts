/**
 * Which mods are enabled, from the manifest defaults + the player's choices. Pure functions (used by main and tests).
 *
 * Rules
 *  - A player's choice is stored per mod id and survives client updates; new mods start at their default.
 *  - Turning a mod ON also turns on the (non-library) mods it needs, e.g. Iris -> Sodium.
 *  - Turning a mod OFF also turns off the mods that need it, e.g. Sodium -> Iris, Sodium Extra.
 *  - Libraries are never chosen by players: they're enabled exactly when an enabled mod needs them.
 */

export interface SelectableMod {
  id: string
  category: string
  requires: string[]
  defaultEnabled: boolean
}

export type Choices = Record<string, boolean>

const isLibrary = (m: SelectableMod) => m.category === 'library'

/** Final set of enabled mod ids (including the libraries they need). */
export function resolveEnabled(mods: SelectableMod[], choices: Choices): Set<string> {
  const byId = new Map(mods.map((m) => [m.id, m]))
  const enabled = new Set(mods.filter((m) => !isLibrary(m) && (choices[m.id] ?? m.defaultEnabled)).map((m) => m.id))

  // A mod whose required (non-library) mod is off can't run: drop it (repeat until stable).
  for (let changed = true; changed; ) {
    changed = false
    for (const id of enabled) {
      const missing = byId.get(id)!.requires.some((r) => {
        const dep = byId.get(r)
        return !dep || (!isLibrary(dep) && !enabled.has(r))
      })
      if (missing) {
        enabled.delete(id)
        changed = true
      }
    }
  }

  // Libraries needed (transitively) by enabled mods.
  const queue = [...enabled]
  while (queue.length) {
    for (const r of byId.get(queue.pop()!)!.requires) {
      if (!enabled.has(r) && byId.has(r)) {
        enabled.add(r)
        queue.push(r)
      }
    }
  }
  return enabled
}

/**
 * Applies a player's toggle and its consequences. Returns the new choices and the other mods that changed
 * (so the UI can say "Iris was turned off because it needs Sodium").
 */
export function applyToggle(mods: SelectableMod[], choices: Choices, id: string, on: boolean): { choices: Choices; alsoChanged: string[] } {
  const byId = new Map(mods.map((m) => [m.id, m]))
  const target = byId.get(id)
  if (!target || isLibrary(target)) return { choices, alsoChanged: [] }

  const before = resolveEnabled(mods, choices)
  const next: Choices = { ...choices, [id]: on }

  if (on) {
    // enable required non-library mods, transitively
    const queue = [...target.requires]
    while (queue.length) {
      const dep = byId.get(queue.pop()!)
      if (!dep || isLibrary(dep) || next[dep.id] === true) continue
      next[dep.id] = true
      queue.push(...dep.requires)
    }
  } else {
    // disable mods that (transitively) need this one
    const off = new Set([id])
    for (let changed = true; changed; ) {
      changed = false
      for (const m of mods) {
        if (!isLibrary(m) && !off.has(m.id) && m.requires.some((r) => off.has(r))) {
          off.add(m.id)
          next[m.id] = false
          changed = true
        }
      }
    }
  }

  const after = resolveEnabled(mods, next)
  const alsoChanged = mods
    .filter((m) => !isLibrary(m) && m.id !== id && before.has(m.id) !== after.has(m.id))
    .map((m) => m.id)
  return { choices: next, alsoChanged }
}
