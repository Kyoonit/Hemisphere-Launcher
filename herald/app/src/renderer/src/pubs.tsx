/** The publications, reloaded whenever the server says something changed (sync's contentStamp, every 15 s). */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { ApiResult, Publication, PublicationsState } from '@herald/api'
import { publicationEnd, type PublicationData } from '@shared/heraldPublications'
import { useStore } from './store'

interface Pubs {
  state: PublicationsState | null
  reload(): Promise<void>
  /** Calls a publication route, reloads the list after a change */
  act<T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<ApiResult<T>>
}

const Ctx = createContext<Pubs | null>(null)
export const usePubs = () => useContext(Ctx)!

export function PubsProvider({ children }: { children: ReactNode }) {
  const { sync } = useStore()
  const [state, setState] = useState<PublicationsState | null>(null)
  const reload = useCallback(async () => {
    const res = await window.herald.api<PublicationsState>('GET', '/publications')
    if (res.ok) setState(res.data)
  }, [])
  const stamp = sync?.contentStamp
  useEffect(() => {
    void reload()
  }, [stamp, reload])
  const act = useCallback(
    async <T,>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown) => {
      const res = await window.herald.api<T>(method, path, body)
      if (method !== 'GET') void reload()
      return res
    },
    [reload],
  )
  return <Ctx.Provider value={{ state, reload, act }}>{children}</Ctx.Provider>
}

// ------------------------------------------------------------------------------------------------ how it looks

export type Shown = 'deleted' | 'online' | 'scheduled' | 'ended' | 'draft' | 'review' | 'ready'
export const SHOWN: Record<Shown, { label: string; tone: string }> = {
  online: { label: 'Online', tone: 'bg-green-600/20 text-green-300' },
  scheduled: { label: 'Scheduled', tone: 'bg-violet-400/15 text-violet-400' },
  ended: { label: 'Ended', tone: 'bg-gray-700 text-gray-400' },
  draft: { label: 'Draft', tone: 'bg-gray-700 text-gray-300' },
  review: { label: 'In review', tone: 'bg-blue-400/15 text-blue-400' },
  ready: { label: 'Ready', tone: 'bg-amber-400/15 text-amber-400' },
  deleted: { label: 'Deleted', tone: 'bg-red-600/20 text-red-400' },
}

/** Where a publication stands for players (online, scheduled…) or, if not online, in its review */
export function shown(p: Publication, now = Date.now()): Shown {
  if (p.deletedAt) return 'deleted'
  if (p.published) {
    const end = publicationEnd(p.kind, p.published)
    const from = shownFrom(p.kind, p.published)
    if (end !== null && end <= now) return 'ended'
    if (from !== null && from > now) return 'scheduled'
    return 'online'
  }
  return p.status
}

/** The published version differs from the one being edited */
export const pendingChanges = (p: Publication) => p.published !== null && JSON.stringify(p.published) !== JSON.stringify(p.data)

/** When players first see it (null = as soon as it is published); an event shows at the latest when it starts */
export function shownFrom(kind: Publication['kind'], data: PublicationData): number | null {
  const from = data.schedule.from ? Date.parse(data.schedule.from) : null
  if (kind !== 'event' || !data.event) return from
  return from === null ? null : Math.min(from, Date.parse(data.event.start))
}

export const titleOf = (data: PublicationData) => data.texts.en?.title?.trim() || data.texts.en?.text?.trim() || 'Untitled'
