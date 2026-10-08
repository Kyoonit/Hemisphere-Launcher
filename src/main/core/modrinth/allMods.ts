import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { ClientManifest, ModEntry } from '@shared/manifest'
import { resolveEnabled } from '@shared/modSelection'
import { type ModItem, type ModPolicy, type ModVersionChoice, type SetVersionResult, type UpdateApplied, type UpdateCheck } from '@shared/modBrowser'
import { gamePaths } from '../game/target'
import { getModIcons } from '../remote/modIcons'
import { detachMod, readInstanceState, reattachMod } from '../sync/sync'
import { latestByHash, pickVersion, projectVersions, updateTarget } from './api'
import { createRestorePoint } from '../backup/restorePoints'
import {
  checkPlayerModUpdates,
  hemisphereMods,
  isLocked,
  listPlayerMods,
  modVersions,
  placeHemisphereFileAsPlayer,
  readPlayerRegistry,
  registryKey,
  removePlayerMod,
  setLocked,
  setModVersion,
  updatePlayerMods,
} from './playerMods'

/**
 * Every mod in one list, Hemisphere's and the player's, with the same actions for all of them.
 * A Hemisphere mod stays managed by Hemisphere (follows its tested updates) until the player changes its version, locks
 * it, updates it or removes it: then it's "taken over" (detached) and becomes the player's like any mod they added,
 * with "Back to Hemisphere's version" to undo. Libraries (Fabric API…) always stay managed: other mods need them.
 *
 * Keys: "h:<mod id>" for a managed Hemisphere mod, "p:<file name>" for a file the player owns.
 */
const owned = async () => Object.keys((await readInstanceState()).owned)
const editable = (m: ModEntry) => m.category !== 'library'

/** When a Hemisphere file arrived in the instance (creation time), 0 when not placed yet. */
function installedAt(path: string): number {
  try {
    const st = statSync(join(gamePaths().instance, ...path.split('/')))
    return st.birthtimeMs || st.mtimeMs
  } catch {
    return 0
  }
}

/** Newer Modrinth versions of managed Hemisphere mods, from the last "Check for updates" (mod id -> version). */
const managedUpdates = new Map<string, { versionId: string; versionNumber: string }>()

export async function listMods(manifest: ClientManifest, policy: ModPolicy | null | undefined): Promise<ModItem[]> {
  const state = await readInstanceState()
  const detached = new Set(state.detached)
  const enabled = resolveEnabled(manifest.mods, state.choices)
  const icons = await getModIcons(manifest.mods.flatMap((m) => (m.source ? [m.source.modrinth.projectId] : [])))
  const byProject = new Map(manifest.mods.flatMap((m) => (m.source ? [[m.source.modrinth.projectId, m] as const] : [])))
  const players = await listPlayerMods(Object.keys(state.owned), policy, hemisphereMods(manifest, detached), manifest.minecraft)

  const managed: ModItem[] = manifest.mods
    .filter((m) => editable(m) && !detached.has(m.id))
    .map((m) => ({
      key: `h:${m.id}`,
      name: m.name,
      icon: (m.source && icons[m.source.modrinth.projectId]) || '',
      description: m.description,
      versionNumber: m.version,
      size: m.file.size,
      enabled: enabled.has(m.id),
      managed: true,
      fromHemisphere: true,
      hemisphereVersion: null,
      recommended: m.recommended,
      category: m.category,
      projectId: m.source?.modrinth.projectId ?? null,
      locked: false,
      update: managedUpdates.get(m.id) ? { versionNumber: managedUpdates.get(m.id)!.versionNumber } : null,
      verdict: 'allowed',
      duplicate: false,
      incompatibleWith: null,
      file: null,
      addedAt: installedAt(m.file.path),
    }))
  const own: ModItem[] = players.map((p) => {
    const h = p.projectId ? byProject.get(p.projectId) : undefined
    const taken = !!h && detached.has(h.id)
    return {
      key: `p:${p.file}`,
      name: p.title ?? p.file,
      icon: p.icon || (taken && h?.source ? icons[h.source.modrinth.projectId] || '' : ''),
      description: taken ? h!.description : null,
      versionNumber: p.versionNumber,
      size: p.size,
      enabled: p.enabled,
      managed: false,
      fromHemisphere: taken,
      hemisphereVersion: taken ? h!.version : null,
      recommended: taken ? h!.recommended : false,
      category: taken ? h!.category : null,
      projectId: p.projectId,
      locked: p.pinned,
      update: p.update,
      verdict: taken ? 'allowed' : p.verdict,
      reason: taken ? undefined : p.reason,
      duplicate: p.inHemisphere,
      incompatibleWith: p.incompatibleWith,
      file: p.file,
      addedAt: p.addedAt,
    }
  })
  return [...managed, ...own]
}

const hemisphereMod = (manifest: ClientManifest, key: string) => {
  const m = key.startsWith('h:') ? manifest.mods.find((x) => x.id === key.slice(2)) : undefined
  return m && editable(m) ? m : undefined
}
const fileOf = (key: string) => (key.startsWith('p:') ? key.slice(2) : null)

/** Hands a managed Hemisphere mod to the player; returns its file name (now the player's). */
async function takeOver(manifest: ClientManifest, mod: ModEntry): Promise<string> {
  const { wasEnabled } = await detachMod(manifest, mod.id)
  managedUpdates.delete(mod.id)
  const name = mod.file.path.split('/').pop()!
  const inst = gamePaths().instance
  if (existsSync(join(inst, 'mods', name)) || existsSync(join(inst, 'mods-disabled', name))) return name
  // not placed yet (switched off, or switched on since the last PLAY): give the player Hemisphere's version
  return placeHemisphereFileAsPlayer(mod.file, wasEnabled)
}

export async function versionsFor(manifest: ClientManifest, key: string): Promise<ModVersionChoice[] | null> {
  const h = hemisphereMod(manifest, key)
  if (h) {
    if (!h.source) return null
    const versions = (await projectVersions(h.source.modrinth.projectId, manifest.minecraft)).sort((a, b) => b.date_published.localeCompare(a.date_published))
    const latest = pickVersion(versions)
    return versions.slice(0, 60).map((v) => ({
      id: v.id,
      versionNumber: v.version_number,
      name: v.name,
      type: v.version_type,
      published: v.date_published,
      current: v.id === h.source!.modrinth.versionId,
      latest: v.id === latest?.id,
      locked: false,
    }))
  }
  const file = fileOf(key)
  return file ? modVersions(file, await owned(), manifest.minecraft) : null
}

export async function setVersionFor(manifest: ClientManifest, key: string, versionId: string, lock: boolean, safetyPoint = true): Promise<SetVersionResult> {
  const h = hemisphereMod(manifest, key)
  if (safetyPoint && !(fileOf(key) && isLocked(fileOf(key)!, manifest.minecraft))) {
    const name = h?.name ?? readPlayerRegistry()[registryKey(fileOf(key) ?? '')]?.title ?? fileOf(key)?.replace(/.jar$/i, '') ?? key
    await createRestorePoint({ kind: 'version', mod: name }, { clientVersion: manifest.clientVersion, minecraft: manifest.minecraft })
  }
  const file = h ? await takeOver(manifest, h) : fileOf(key)
  if (!file) return { ok: false, reason: 'notFound' }
  return setModVersion(file, versionId, await owned(), manifest.minecraft, lock)
}

export async function setLockFor(manifest: ClientManifest, key: string, locked: boolean): Promise<boolean> {
  const h = hemisphereMod(manifest, key)
  if (h && !locked) return true // a managed mod isn't locked
  const file = h ? await takeOver(manifest, h) : fileOf(key)
  return file ? setLocked(file, locked, await owned(), manifest.minecraft) : false
}

export async function removeFor(manifest: ClientManifest, key: string): Promise<boolean> {
  const h = hemisphereMod(manifest, key)
  const file = h ? await takeOver(manifest, h) : fileOf(key)
  return file ? removePlayerMod(file, await owned()) : false
}

/** A taken-over Hemisphere mod goes back to Hemisphere's version and updates (the player's copy goes to the Recycle Bin). */
export async function backToHemisphere(manifest: ClientManifest, key: string): Promise<boolean> {
  const file = fileOf(key)
  if (file && isLocked(file, manifest.minecraft)) return false // unlock it first
  const state = await readInstanceState()
  const items = file ? await listMods(manifest, null) : []
  const item = items.find((i) => i.key === key)
  const mod = item?.projectId ? manifest.mods.find((m) => m.source?.modrinth.projectId === item.projectId && state.detached.includes(m.id)) : undefined
  if (!file || !mod) return false
  await removePlayerMod(file, Object.keys(state.owned))
  await reattachMod(mod.id)
  return true
}

/** Newer versions for every unlocked mod: the player's (and taken-over) mods and Hemisphere's managed ones. */
export async function checkAllUpdates(manifest: ClientManifest): Promise<UpdateCheck> {
  const state = await readInstanceState()
  const mine = await checkPlayerModUpdates(Object.keys(state.owned), manifest.minecraft)
  const managed = manifest.mods.filter((m) => editable(m) && !state.detached.includes(m.id) && m.source)
  const latest = await latestByHash(
    managed.map((m) => m.file.sha512),
    manifest.minecraft,
  )
  managedUpdates.clear()
  for (const m of managed) {
    const found = latest[m.file.sha512]
    const v = found ? await updateTarget(m.source!.modrinth.projectId, m.source!.modrinth.versionId, found, manifest.minecraft).catch(() => null) : null
    if (v) managedUpdates.set(m.id, { versionId: v.id, versionNumber: v.version_number })
  }
  return { checked: mine.checked + managed.length, updates: mine.updates + managedUpdates.size }
}

/** Updates every unlocked mod that has a newer version (Hemisphere mods are taken over to do it). */
export async function updateAll(manifest: ClientManifest): Promise<UpdateApplied> {
  const updated: string[] = []
  const restorePoint = await createRestorePoint({ kind: 'updateAll' }, { clientVersion: manifest.clientVersion, minecraft: manifest.minecraft })
  const state = await readInstanceState()
  const enabled = resolveEnabled(manifest.mods, state.choices)
  for (const [id, v] of [...managedUpdates]) {
    const mod = manifest.mods.find((m) => m.id === id)
    if (!mod || !enabled.has(id)) continue // switched off: nothing to update
    const r = await setVersionFor(manifest, `h:${id}`, v.versionId, false, false)
    if (r.ok) updated.push(mod.name)
  }
  const mine = await updatePlayerMods(await owned(), manifest.minecraft, false)
  return { updated: [...updated, ...mine.updated], disabled: mine.disabled, restorePoint }
}
