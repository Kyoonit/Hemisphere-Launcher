import { ROLE_LABEL } from '@shared/heraldRoles'
import { useStore } from '../store'
import { Avatar } from '../components/ui'
import { describe } from '../activity'
import { ago, formatLong, formatTime } from '../time'

export default function Home() {
  const { me, sync, zone } = useStore()
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
          <p className="text-sm text-gray-400">Drafts waiting too long and publications due soon will show here (next phase: publications).</p>
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
