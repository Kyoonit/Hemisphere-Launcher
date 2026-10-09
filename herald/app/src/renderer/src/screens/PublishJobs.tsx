/** Where the last publication is on its way to the launchers (server → GitHub Actions → commit → pulse) */
import { useEffect, useRef, useState } from 'react'
import type { PublishJob } from '@herald/api'
import { usePubs } from '../pubs'
import { useStore } from '../store'
import { ago } from '../time'

const LABEL: Record<PublishJob['status'], string> = { queued: 'Waiting for GitHub…', publishing: 'Publishing…', done: 'Online', failed: 'Refused', superseded: 'Replaced by a newer one' }

export function PublishJobs() {
  const { state, act, reload } = usePubs()
  const { can } = useStore()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const last = state?.jobs.find((j) => j.status !== 'superseded') ?? null
  const working = last && (last.status === 'queued' || last.status === 'publishing')
  // While a job runs, look again every 3 s (it takes about 15 s)
  useEffect(() => {
    if (!working) return
    const timer = window.setInterval(() => void reload(), 3000)
    return () => window.clearInterval(timer)
  }, [working, reload])
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])
  if (!state || !last) return null
  const tone = last.status === 'failed' ? 'border-red-400/40 text-red-300' : working ? 'border-amber-400/40 text-amber-300' : 'border-green-400/30 text-green-300'
  return (
    <div ref={box} className="relative">
      <button className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold ${tone}`} onClick={() => setOpen(!open)}>
        {working && <span className="size-2 animate-pulse rounded-full bg-amber-400" />}
        {last.status === 'done' ? `Launchers: sequence ${state.live?.sequence ?? last.sequence}` : LABEL[last.status]}
      </button>
      {open && (
        <div className="absolute top-full right-0 z-30 mt-1 w-[380px] rounded-lg border border-gray-600 bg-gray-800 p-3 text-sm shadow-2xl">
          <p className="mb-2 text-gray-300">Each publication goes server → GitHub Actions (checked, signed) → launchers, within 2 minutes.</p>
          {state.jobs.map((j) => (
            <div key={j.id} className="border-t border-gray-700 py-1.5">
              <div className="flex gap-2">
                <b className={j.status === 'failed' ? 'text-red-300' : j.status === 'done' ? 'text-green-300' : 'text-gray-300'}>{LABEL[j.status]}</b>
                <span className="text-gray-400">{j.reason ?? ''}</span>
                <span className="ml-auto text-xs text-gray-400">
                  {j.who ?? 'Herald'} · {ago(j.created_at)}
                </span>
              </div>
              {j.error && <p className="mt-0.5 text-xs text-red-300 select-text">{j.error}</p>}
            </div>
          ))}
          {last.status === 'failed' && can('publications.publish') && (
            <button className="btn btn-sm btn-primary mt-2" onClick={() => void act('POST', '/publish')}>
              Publish again
            </button>
          )}
        </div>
      )}
    </div>
  )
}
