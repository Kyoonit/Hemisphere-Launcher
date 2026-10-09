/** News, banners and welcome messages: the list (filters, trash), "New", and the editor of the one opened. */
import { useEffect, useRef, useState } from 'react'
import type { Publication } from '@herald/api'
import { KIND_LABEL, languagesOut, type PublicationKind } from '@shared/heraldPublications'
import type { Permission } from '@shared/heraldRoles'
import { usePubs, shown, SHOWN, pendingChanges, titleOf, type Shown } from '../pubs'
import { useStore } from '../store'
import { Avatar } from '../components/ui'
import { ago, formatWhen } from '../time'
import Editor from './Editor'

const WRITE: Record<PublicationKind, Permission> = { news: 'news.write', banner: 'banner.write', welcome: 'welcome.write' }
type KindFilter = 'all' | PublicationKind
type StateFilter = 'all' | 'work' | 'online' | 'scheduled' | 'ended' | 'deleted'
const STATE_FILTERS: { id: StateFilter; label: string; match(s: Shown): boolean }[] = [
  { id: 'all', label: 'All', match: (s) => s !== 'deleted' },
  { id: 'work', label: 'Being prepared', match: (s) => s === 'draft' || s === 'review' || s === 'ready' },
  { id: 'online', label: 'Online', match: (s) => s === 'online' },
  { id: 'scheduled', label: 'Scheduled', match: (s) => s === 'scheduled' },
  { id: 'ended', label: 'Ended', match: (s) => s === 'ended' },
  { id: 'deleted', label: 'Trash', match: (s) => s === 'deleted' },
]

export default function Publications({ open, onOpen }: { open: string | null; onOpen(id: string | null): void }) {
  const { state, act } = usePubs()
  const { can, zone, sync } = useStore()
  const people = sync?.people ?? []
  const [kind, setKind] = useState<KindFilter>('all')
  const [filter, setFilter] = useState<StateFilter>('all')
  const [menu, setMenu] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const menuBox = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menu) return
    const onDown = (e: MouseEvent) => !menuBox.current?.contains(e.target as Node) && setMenu(false)
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [menu])

  if (open) return <Editor key={open} id={open} onClose={() => onOpen(null)} />
  if (!state) return <div className="text-gray-400">Loading…</div>

  const now = state.now
  const name = (id: string | null) => people.find((p) => p.id === id)?.name ?? '?'
  const rows = state.publications.filter((p) => (kind === 'all' || p.kind === kind) && STATE_FILTERS.find((f) => f.id === filter)!.match(shown(p, now)))
  const creatable = (['news', 'banner', 'welcome'] as const).filter((k) => can(WRITE[k]))
  const create = async (k: PublicationKind) => {
    setMenu(false)
    const res = await act<Publication>('POST', '/publications', { kind: k, zone })
    if (res.ok) onOpen(res.data.id)
    else setError(res.error)
  }

  return (
    <div className="animate-fade">
      <div className="mb-4 flex items-center gap-3">
        <div>
          <div className="eyebrow">What players read</div>
          <h1 className="text-[26px] font-extrabold text-white">Publications</h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {creatable.length > 0 && (
            <div ref={menuBox} className="relative">
              <button className="btn btn-primary" onClick={() => setMenu(!menu)}>
                + New ▾
              </button>
              {menu && (
                <div className="absolute top-full right-0 z-30 mt-1 w-56 rounded-lg border border-gray-600 bg-gray-800 py-1 shadow-2xl">
                  {creatable.map((k) => (
                    <button key={k} className="block w-full px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-700" onClick={() => void create(k)}>
                      {KIND_LABEL[k]}
                      <span className="block text-xs text-gray-400">{k === 'news' ? 'An article in News (and on Home)' : k === 'banner' ? 'One short line above the title on Home' : 'Replaces “Welcome back” on Home'}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {error && <p className="mb-3 text-sm text-red-300">{error}</p>}

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {(['all', 'news', 'banner', 'welcome'] as const).map((k) => (
          <button key={k} className={`rounded-lg px-3 py-1.5 text-[13px] font-medium ${kind === k ? 'bg-green-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`} onClick={() => setKind(k)}>
            {k === 'all' ? 'Everything' : k === 'welcome' ? 'Welcome messages' : `${KIND_LABEL[k]}${k === 'news' ? '' : 's'}`}
          </button>
        ))}
        <span className="mx-2 h-5 w-px bg-gray-700" />
        {STATE_FILTERS.map((f) => (
          <button key={f.id} className={`rounded-lg px-3 py-1.5 text-[13px] font-medium ${filter === f.id ? 'bg-gray-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'}`} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border border-white/5">
        {rows.length === 0 && <p className="bg-gray-800 px-4 py-6 text-center text-sm text-gray-400">{filter === 'deleted' ? 'The trash is empty.' : 'Nothing here yet.'}</p>}
        {rows.map((p) => {
          const s = shown(p, now)
          const sched = (p.published ?? p.data).schedule
          const others = Object.keys(p.data.texts).filter((l) => l !== 'en')
          const done = languagesOut(p.kind, p.data)
          return (
            <button key={p.id} className="flex w-full items-center gap-3 border-t border-white/5 bg-gray-800 px-4 py-3 text-left first:border-0 hover:bg-gray-700/60" onClick={() => onOpen(p.id)}>
              <span className="w-20 shrink-0 text-[11px] font-bold tracking-wider text-gray-400 uppercase">{KIND_LABEL[p.kind]}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-white">{titleOf(p.data)}</span>
                <span className="block truncate text-xs text-gray-400">
                  {sched.from ? `From ${formatWhen(Date.parse(sched.from), zone)}` : p.publishedAt ? `Since ${formatWhen(p.publishedAt, zone)}` : 'As soon as published'}
                  {sched.until ? ` · until ${formatWhen(Date.parse(sched.until), zone)}` : ''}
                  {others.length > 0 && ` · EN ✓ ${others.map((l) => `${l.toUpperCase()} ${done.includes(l) ? '✓' : '…'}`).join(' ')}`}
                </span>
              </span>
              {p.editing && <span className="text-xs text-amber-300">✎ {p.editing.name}</span>}
              {pendingChanges(p) && s !== 'deleted' && <span className="text-xs text-amber-400">changes not published</span>}
              <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${SHOWN[s].tone}`}>{SHOWN[s].label}</span>
              <span className="flex w-36 shrink-0 items-center justify-end gap-1.5 text-xs text-gray-400">
                <Avatar name={name(p.updatedBy)} size={18} /> {ago(p.updatedAt, now)}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
