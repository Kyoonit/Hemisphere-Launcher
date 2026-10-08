import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { MAX_HISTORY, type ModHistoryEntry } from '@shared/modSets'
import { gamePaths } from '../game/target'

/**
 * The mod history: everyday changes (versions, installs, removals, updates, locks, set switches), newest first,
 * the last 200. instance/.hemisphere/mod-history.json. Undoing goes through Modrinth again, so nothing is kept here
 * but names and version ids.
 */
const file = () => join(gamePaths().instance, '.hemisphere', 'mod-history.json')

export function readHistory(): ModHistoryEntry[] {
  try {
    const list = JSON.parse(readFileSync(file(), 'utf8')) as ModHistoryEntry[]
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

let queue: Promise<unknown> = Promise.resolve()

export type NewHistoryEntry = Pick<ModHistoryEntry, 'kind' | 'name'> & Partial<Omit<ModHistoryEntry, 'id' | 'at'>>

/** Adds changes to the history (never fails the change itself). */
export function record(...entries: NewHistoryEntry[]): Promise<void> {
  if (!entries.length) return Promise.resolve()
  const run = queue.then(async () => {
    const now = Date.now()
    const fresh = entries.map((e, i) => ({
      projectId: null,
      from: null,
      to: null,
      fromVersionId: null,
      toVersionId: null,
      ...e,
      id: `${(now + i).toString(36)}-${randomBytes(2).toString('hex')}`,
      at: now,
    })) as ModHistoryEntry[]
    const list = [...fresh.reverse(), ...readHistory()].slice(0, MAX_HISTORY)
    await mkdir(join(gamePaths().instance, '.hemisphere'), { recursive: true })
    const tmp = `${file()}.tmp`
    await writeFile(tmp, JSON.stringify(list))
    await rename(tmp, file())
  })
  queue = run.catch((err) => console.warn('[history] not saved:', err))
  return queue as Promise<void>
}
