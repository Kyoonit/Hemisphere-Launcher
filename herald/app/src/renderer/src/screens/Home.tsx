import { ROLE_LABEL } from '@shared/heraldRoles'
import { useStore } from '../store'
import { Avatar } from '../components/ui'
import { describe } from '../activity'
import { ago, formatLong, formatTime, formatWhen } from '../time'
import { pendingChanges, shown, shownFrom, SHOWN, titleOf, usePubs } from '../pubs'
import { nextOccurrence } from '../eventTimes'
import { KIND_LABEL, languageName, languagesOut } from '@shared/heraldPublications'
import type { PackState, Publication } from '@herald/api'
import { useEffect, useState } from 'react'
import { newerReleases } from '@shared/heraldPack'

/** What needs someone, for everyone in Herald (no alert outside Herald) */
export function attention(pubs: Publication[], now: number, zone: string): { pub: Publication; why: string }[] {
  const out: { pub: Publication; why: string }[] = []
  for (const p of pubs) {
    if (p.deletedAt) continue
    const from = shownFrom(p.kind, p.data) ?? (p.kind === 'event' && p.data.event ? Date.parse(p.data.event.start) : null)
    if (p.status === 'review') out.push({ pub: p, why: 'waits for a review' })
    else if (p.status === 'ready' && !p.published) out.push({ pub: p, why: 'is Ready: it can be published' })
    else if (p.status === 'ready' && pendingChanges(p)) out.push({ pub: p, why: 'has changes Ready to publish' })
    else if (p.status === 'draft' && from && from > now && from - now < 2 * 86_400_000) out.push({ pub: p, why: `should appear ${formatWhen(from, zone)} but is still a draft` })
    else if (p.status === 'draft' && now - p.updatedAt > 7 * 86_400_000) out.push({ pub: p, why: `draft untouched for ${Math.floor((now - p.updatedAt) / 86_400_000)} days` })
    const todo = Object.keys(p.data.texts).filter((l) => l !== 'en' && !languagesOut(p.kind, p.data).includes(l))
    if (todo.length && p.status !== 'ready') out.push({ pub: p, why: `translation to do: ${todo.map(languageName).join(', ')}` })
  }
  return out
}

export default function Home({ onOpen, onPack }: { onOpen(id: string): void; onPack(): void }) {
  const { me, sync, zone } = useStore()
  const packLines = usePackAttention()
  const { state } = usePubs()
  const now = sync?.now ?? Date.now()
  const online = (sync?.people ?? []).filter((p) => p.online)
  return (
    <div className="animate-fade">
      <div className="eyebrow">
        {formatLong(now, zone)} · {formatTime(now, zone)} your time
      </div>
      <h1 className="mb-5 text-[26px] font-extrabold text-white">
        Hi <span className="text-green-400">{me.name}</span>
      </h1>
      <div className="grid grid-cols-[1.25fr_1fr] gap-4">
        <div className="card">
          <div className="eyebrow mb-3">Needs attention</div>
          {packLines.map((why) => (
            <button key={why} className="flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-left text-sm hover:bg-gray-700" onClick={onPack}>
              <span className="w-16 shrink-0 text-[10.5px] font-bold tracking-wider text-gray-400 uppercase">Mod pack</span>
              <span className="min-w-0 truncate text-gray-200">{why}</span>
            </button>
          ))}
          {state && !packLines.length && attention(state.publications, now, zone).length === 0 && <p className="text-sm text-gray-400">Nothing waits for anyone.</p>}
          {state &&
            attention(state.publications, now, zone).slice(0, 8).map(({ pub, why }) => (
              <button key={pub.id + why} className="flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-left text-sm hover:bg-gray-700" onClick={() => onOpen(pub.id)}>
                <span className="w-16 shrink-0 text-[10.5px] font-bold tracking-wider text-gray-400 uppercase">{KIND_LABEL[pub.kind]}</span>
                <span className="min-w-0 truncate">
                  <b className="text-white">{titleOf(pub.data)}</b> <span className="text-gray-400">{why}</span>
                </span>
              </button>
            ))}
        </div>
        <div className="card">
          <div className="eyebrow mb-3">In Herald now · {online.length}</div>
          {online.map((p) => (
            <div key={p.id} className="flex items-center gap-2.5 py-1.5 text-sm">
              <Avatar name={p.name} size={26} />
              <b className="text-white">{p.name}</b>
              <span className="text-gray-400">{ROLE_LABEL[p.role]}</span>
              <span className="ml-auto size-2 rounded-full bg-green-400 shadow-[0_0_0_3px_rgba(74,222,128,.15)]" />
            </div>
          ))}
        </div>
      </div>
      {state && (
        <div className="card mt-4">
          <div className="eyebrow mb-2">Coming up</div>
          {(() => {
            // publications appearing later, and the events starting in the next two weeks
            const soon: { at: number; pub: Publication; what: 'appears' | 'starts' }[] = []
            for (const p of state.publications) {
              if (p.deletedAt || !p.published) continue
              if (shown(p, now) === 'scheduled') soon.push({ at: shownFrom(p.kind, p.published)!, pub: p, what: 'appears' })
              const next = p.kind === 'event' ? nextOccurrence(p.id, p.published, now) : null
              if (next && next.start > now && next.start - now < 14 * 86_400_000) soon.push({ at: next.start, pub: p, what: 'starts' })
            }
            soon.sort((a, b) => a.at - b.at)
            if (!soon.length) return <p className="text-sm text-gray-400">Nothing scheduled.</p>
            return soon.slice(0, 8).map(({ at, pub: p, what }) => (
              <button key={p.id + what} className="flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-left text-sm hover:bg-gray-700" onClick={() => onOpen(p.id)}>
                <span className="w-36 shrink-0 text-xs font-semibold text-green-300">{formatWhen(at, zone)}</span>
                <span className="w-16 shrink-0 text-[10.5px] font-bold tracking-wider text-gray-400 uppercase">{KIND_LABEL[p.kind]}</span>
                <b className="truncate text-white">{titleOf(p.published!)}</b>
                <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-semibold ${what === 'starts' ? SHOWN.online.tone : SHOWN.scheduled.tone}`}>{what === 'starts' ? 'Event starts' : 'Appears'}</span>
              </button>
            ))
          })()}
        </div>
      )}
      <div className="card mt-4">
        <div className="eyebrow mb-2">Latest activity</div>
        {(sync?.activity ?? []).slice(0, 8).map((a) => (
          <div key={a.id} className="flex items-center gap-2.5 border-t border-gray-700/50 py-2 text-sm first:border-0">
            <Avatar name={a.who ?? '?'} size={22} />
            <span>
              <b className="text-white">{a.who ?? 'Someone'}</b> {describe(a)}
            </span>
            <span className="ml-auto text-xs text-gray-400">{ago(a.at, now)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Checked at most every 30 minutes: Mojang's releases and the pack online */
let mcCache: { at: number; minecraft: string | null; newer: string | null } | null = null

/** Mod pack lines for "Needs attention": a change to approve (not mine), a refused publication, a new Minecraft. */
function usePackAttention(): string[] {
  const { can, me, sync } = useStore()
  const allowed = can('pack.propose') || can('pack.approve')
  const [pack, setPack] = useState<PackState | null>(null)
  const [mc, setMc] = useState(mcCache)
  useEffect(() => {
    if (!allowed) return
    void window.herald.api<PackState>('GET', '/pack').then((r) => r.ok && setPack(r.data))
  }, [allowed, sync?.contentStamp])
  useEffect(() => {
    if (!allowed || !pack || (mcCache && Date.now() - mcCache.at < 30 * 60_000)) return
    void Promise.all([window.herald.pack.online(pack.contentBase), window.herald.pack.minecraft()]).then(([online, list]) => {
      const minecraft = online?.manifest.minecraft ?? null
      mcCache = { at: Date.now(), minecraft, newer: minecraft && list ? (newerReleases(list.releases, minecraft)[0]?.id ?? null) : null }
      setMc(mcCache)
    })
  }, [allowed, pack])
  if (!allowed || !pack) return []
  const open = pack.proposals.find((p) => p.status === 'proposed' || p.status === 'failed' || p.status === 'approved')
  return [
    ...(open?.status === 'proposed' && can('pack.approve') && open.proposedBy !== me.id ? [`${open.clientVersion} waits for your approval (${open.proposedByName ?? '?'})`] : []),
    ...(open?.status === 'failed' ? [`${open.clientVersion}: publishing was refused`] : []),
    ...(mc?.newer && !open ? [`Minecraft ${mc.newer} is out: the pack is still on ${mc.minecraft}`] : []),
  ]
}
