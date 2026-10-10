/**
 * Team → Activity and Trash (S11). The full shared journal (every action, kept forever): by person and by area, older
 * pages on demand; a line about a publication opens it. The trash: deleted publications and removed Home background
 * periods, each restorable.
 */
import { useEffect, useState } from 'react'
import type { ActivityEntry, ActivityPage } from '@herald/api'
import { removedPeriods, type BackgroundPeriod, type Backgrounds } from '@shared/heraldBackgrounds'
import type { SettingVersion } from '../components/SettingHistory'
import { ACTIVITY_AREAS, KIND_LABEL, type ActivityArea } from '@shared/heraldPublications'
import { useStore } from '../store'
import { titleOf, usePubs } from '../pubs'
import { Avatar } from '../components/ui'
import { describe } from '../activity'
import { formatDay, formatTime, formatWhen } from '../time'

const AREA_LABEL: Record<ActivityArea, string> = { publications: 'Publications', server: 'Server', pack: 'Mod pack', settings: 'Launcher settings and backgrounds', team: 'Team and sign-ins', catalogue: 'Catalogue' }
const PUBLICATION = /^[nebw]-[a-z0-9]{12}$/

export function Journal({ onOpen }: { onOpen(id: string): void }) {
  const { sync, zone } = useStore()
  const [who, setWho] = useState('')
  const [area, setArea] = useState<ActivityArea | ''>('')
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null)
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const load = async (before?: number) => {
    setBusy(true)
    const q = new URLSearchParams({ ...(before ? { before: String(before) } : {}), ...(who ? { who } : {}), ...(area ? { area } : {}) })
    const res = await window.herald.api<ActivityPage>('GET', `/activity${q.size ? `?${q}` : ''}`)
    setBusy(false)
    if (!res.ok) return
    setEntries((e) => (before ? [...(e ?? []), ...res.data.entries] : res.data.entries))
    setMore(res.data.more)
  }
  // Again when the filters change, and when something new happens (newest page only)
  const newest = sync?.activity[0]?.id
  useEffect(() => void load(), [who, area, newest]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        <select className="field w-auto!" value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">Everyone</option>
          {(sync?.people ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select className="field w-auto!" value={area} onChange={(e) => setArea(e.target.value as ActivityArea | '')}>
          <option value="">Everything</option>
          {(Object.keys(ACTIVITY_AREAS) as ActivityArea[]).map((a) => (
            <option key={a} value={a}>
              {AREA_LABEL[a]}
            </option>
          ))}
        </select>
        <span className="self-center text-xs text-gray-500">Kept for good, nothing is ever erased.</span>
      </div>
      <div className="card p-2">
        {entries?.length === 0 && <p className="px-2 py-3 text-sm text-gray-400">Nothing here.</p>}
        {(entries ?? []).map((a) => {
          const open = a.target && PUBLICATION.test(a.target)
          return (
            <button key={a.id} className={`flex w-full items-center gap-2.5 border-t border-gray-700/50 px-2 py-2 text-left text-sm first:border-0 ${open ? 'hover:bg-gray-700/50' : 'cursor-default'}`} onClick={() => open && onOpen(a.target!)}>
              <Avatar name={a.who ?? '?'} size={24} />
              <span className="min-w-0">
                <b className="text-white">{a.who ?? 'Herald'}</b> {describe(a)}
              </span>
              <span className="ml-auto shrink-0 text-xs text-gray-400">
                {formatDay(a.at, zone)} {formatTime(a.at, zone)}
              </span>
            </button>
          )
        })}
        {more && (
          <button className="btn btn-ghost mt-2 w-full justify-center" disabled={busy} onClick={() => void load(entries?.[entries.length - 1]?.id)}>
            {busy ? 'Loading…' : 'Older'}
          </button>
        )}
      </div>
    </div>
  )
}

export function Trash({ onOpen }: { onOpen(id: string): void }) {
  const { state, act } = usePubs()
  const { can, zone } = useStore()
  const [history, setHistory] = useState<SettingVersion<Backgrounds>[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const canBackgrounds = can('backgrounds.write')
  useEffect(() => {
    if (canBackgrounds) void window.herald.api<{ versions: SettingVersion<Backgrounds>[] }>('GET', '/settings/history/backgrounds').then((r) => r.ok && setHistory(r.data.versions))
  }, [canBackgrounds, state?.backgroundsVersion])
  if (!state) return <div className="text-gray-400">Loading…</div>
  const deleted = state.publications.filter((p) => p.deletedAt).sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0))
  const periods = history ? removedPeriods(state.backgrounds, history) : []
  const restorePeriod = async (p: BackgroundPeriod) => {
    setError(null)
    const res = await act('POST', '/backgrounds', { version: state.backgroundsVersion, backgrounds: { periods: [...state.backgrounds.periods, p] } })
    if (!res.ok) setError(res.error)
  }
  return (
    <div className="flex flex-col gap-4">
      {error && <p className="rounded-lg border border-red-400/30 bg-red-600/10 px-3 py-2 text-sm text-red-300">{error}</p>}
      <div className="card p-2">
        <div className="eyebrow px-2 pt-1 pb-2">Publications</div>
        {deleted.length === 0 && <p className="px-2 pb-2 text-sm text-gray-400">No deleted publication.</p>}
        {deleted.map((p) => (
          <div key={p.id} className="flex items-center gap-3 border-t border-gray-700/50 px-2 py-2 text-sm first:border-0">
            <span className="w-16 shrink-0 text-[10.5px] font-bold tracking-wider text-gray-400 uppercase">{KIND_LABEL[p.kind]}</span>
            <button className="min-w-0 truncate text-left font-semibold text-white hover:underline" onClick={() => onOpen(p.id)}>
              {titleOf(p.data)}
            </button>
            <span className="ml-auto shrink-0 text-xs text-gray-400">deleted {formatWhen(p.deletedAt!, zone)}</span>
            <button className="btn btn-sm" disabled={!can('publications.restore')} onClick={() => void act('POST', `/publications/${p.id}/restore`, { version: p.version })}>
              Restore
            </button>
          </div>
        ))}
      </div>
      {canBackgrounds && (
        <div className="card p-2">
          <div className="eyebrow px-2 pt-1 pb-2">Home background periods</div>
          {periods.length === 0 && <p className="px-2 pb-2 text-sm text-gray-400">No removed period.</p>}
          {periods.map(({ period, removedAt, by }) => (
            <div key={period.id} className="flex items-center gap-3 border-t border-gray-700/50 px-2 py-2 text-sm first:border-0">
              <b className="text-white">{period.name}</b>
              <span className="text-gray-400">
                {period.from ?? '?'} → {period.until ?? '?'} · {period.pictures.length} picture{period.pictures.length === 1 ? '' : 's'}
              </span>
              <span className="ml-auto shrink-0 text-xs text-gray-400">
                removed {formatWhen(removedAt, zone)}
                {by ? ` by ${by}` : ''}
              </span>
              <button className="btn btn-sm" onClick={() => void restorePeriod(period)}>
                Restore
              </button>
            </div>
          ))}
          <p className="px-2 pt-1 text-xs text-gray-500">Restoring publishes the backgrounds at once (a period already over is refused: change its dates in Backgrounds).</p>
        </div>
      )}
    </div>
  )
}
