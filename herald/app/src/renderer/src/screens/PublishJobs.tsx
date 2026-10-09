/**
 * Where the last change is, live: Herald server → GitHub Actions (checks and signs) → GitHub → players' launchers.
 * Opens by itself when a new change starts; the button shows the step and the time so far.
 */
import { useEffect, useRef, useState } from 'react'
import type { PublishJob } from '@herald/api'
import { usePubs } from '../pubs'
import { useStore } from '../store'

/** Launchers ask the Herald server every 2 minutes (the pulse), then read the new content at once */
const PULSE_MS = 120_000

/** 0 queued on the Herald server · 1 GitHub Actions · 2 on GitHub, launchers on their way · 4 everywhere */
type Step = 0 | 1 | 2 | 4
const STAGES = [
  { title: 'Herald server', what: 'Saved, waiting for GitHub to start' },
  { title: 'GitHub Actions', what: 'Checking and signing' },
  { title: 'GitHub', what: 'Published' },
  { title: 'Launchers', what: 'Every open launcher has it' },
]

const secs = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')}`
}

/** The step a job is at, at `now` */
function stepOf(j: PublishJob, now: number): Step {
  if (j.status === 'queued') return 0
  if (j.status === 'publishing') return 1
  if (j.status === 'done') return now < j.updated_at + PULSE_MS ? 2 : 4
  return 1
}

export function PublishJobs() {
  const { state, act, reload } = usePubs()
  const { can } = useStore()
  const [open, setOpen] = useState(false)
  const [now, setNow] = useState(Date.now())
  const box = useRef<HTMLDivElement>(null)
  const last = state?.jobs.find((j) => j.status !== 'superseded') ?? null
  const working = last && (last.status === 'queued' || last.status === 'publishing')
  const step = last ? stepOf(last, now) : 4

  // A new change: open the panel to follow it
  const seen = useRef<string | null>(null)
  useEffect(() => {
    if (!last) return
    if (seen.current !== null && seen.current !== last.id) setOpen(true)
    seen.current = last.id
  }, [last])
  // While it travels: ask the server every 2 s, tick every second until launchers have it
  useEffect(() => {
    if (!working) return
    const t = window.setInterval(() => void reload(), 2000)
    return () => window.clearInterval(t)
  }, [working, reload])
  useEffect(() => {
    if (step === 4 && !working) return
    const t = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(t)
  }, [step, working])
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])
  if (!state || !last) return null

  const failed = last.status === 'failed'
  const label = failed ? 'Refused by the check' : step === 0 ? `Waiting for GitHub… ${secs(now - last.created_at)}` : step === 1 ? `Checking and signing… ${secs(now - last.created_at)}` : step === 2 ? `Reaching launchers… ${secs(last.updated_at + PULSE_MS - now)}` : 'Launchers up to date'
  const tone = failed ? 'border-red-400/40 text-red-300' : step < 2 ? 'border-amber-400/40 text-amber-300' : step === 2 ? 'border-sky-400/40 text-sky-300' : 'border-green-400/30 text-green-300'

  // Usual time from Herald to GitHub, from the last finished changes
  const finished = state.jobs.filter((j) => j.status === 'done')
  const toGithub = finished.length ? finished.reduce((n, j) => n + (j.updated_at - j.created_at), 0) / finished.length : 15_000

  return (
    <div ref={box} className="relative">
      <button className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold tabular-nums ${tone}`} onClick={() => setOpen(!open)}>
        {step < 4 && !failed && <span className="size-2 animate-pulse rounded-full bg-current" />}
        {label}
      </button>
      {open && (
        <div className="absolute top-full right-0 z-30 mt-1 w-[640px] rounded-xl border border-gray-600 bg-gray-800 p-4 text-sm shadow-2xl">
          <div className="mb-3 flex items-baseline gap-2">
            <b className="text-white">Last change</b>
            <span className="text-gray-400">
              {last.reason ?? ''} · {last.who ?? 'Herald'}
            </span>
            <span className="ml-auto text-xs text-gray-400 tabular-nums">{step < 4 && !failed ? `${secs(now - last.created_at)} so far` : `complete in ${secs((last.status === 'done' ? last.updated_at + PULSE_MS : last.updated_at) - last.created_at)} at most`}</span>
          </div>
          <Pipeline job={last} step={step} now={now} />
          {failed && (
            <div className="mt-3 rounded-lg border border-red-400/30 bg-red-600/10 px-3 py-2 text-xs text-red-300 select-text">
              GitHub refused it before signing (nothing reached players): {last.error}
              {can('publications.publish') && (
                <button className="btn btn-sm btn-primary ml-2" onClick={() => void act('POST', '/publish')}>
                  Publish again
                </button>
              )}
            </div>
          )}
          <p className="mt-3 text-xs text-gray-400">
            Usually about {secs(toGithub)} from Herald to GitHub, then up to 2 min for the launchers (they check every 2 minutes; 1 min on average): a whole change takes {secs(toGithub + 60_000)} on average, {secs(toGithub + PULSE_MS)} at most. A closed launcher gets it when it starts.
          </p>
        </div>
      )}
    </div>
  )
}

/** The four places, the information moving between them */
function Pipeline({ job, step, now }: { job: PublishJob; step: Step; now: number }) {
  const failed = job.status === 'failed'
  const done = (i: number) => (failed ? i === 0 : step > i || step === 4 || (i === 2 && step === 2))
  const active = (i: number) => !failed && step < 4 && step === i
  const started = job.started_at ?? (job.status === 'done' ? job.updated_at : null)
  // Time spent in each place
  const spent = [
    (started ?? now) - job.created_at,
    started ? (job.status === 'done' || failed ? job.updated_at : now) - started : null,
    job.status === 'done' ? Math.min(now, job.updated_at + PULSE_MS) - job.updated_at : null,
  ]
  const detail = [
    'queued',
    failed ? 'refused' : 'validated with the launcher’s rules, signed',
    job.commit_sha ? `commit ${job.commit_sha.slice(0, 7)} · sequence ${job.sequence}` : job.sequence ? `sequence ${job.sequence}` : '',
    step === 2 ? `at the latest in ${secs(job.updated_at + PULSE_MS - now)}` : step === 4 ? 'within 2 min of GitHub' : '',
  ]
  return (
    <div className="flex items-stretch">
      {STAGES.map((s, i) => (
        <div key={s.title} className="flex flex-1 items-stretch">
          <div className={`flex w-[118px] shrink-0 flex-col items-center rounded-lg px-2 py-2.5 text-center ${active(i) ? 'bg-gray-700 ring-1 ring-sky-400/50' : 'bg-gray-900/60'}`}>
            <span className={`mb-1.5 grid size-8 place-items-center rounded-full text-sm font-bold ${failed && i === 1 ? 'bg-red-600 text-white' : done(i) ? 'bg-green-600 text-white' : active(i) ? 'bg-sky-500 text-white' : 'bg-gray-700 text-gray-400'}`}>
              {failed && i === 1 ? '✕' : done(i) ? '✓' : i + 1}
            </span>
            <b className="text-[12.5px] text-white">{s.title}</b>
            <span className="text-[11px] leading-tight text-gray-400">{s.what}</span>
            <span className="mt-1 text-[10.5px] leading-tight text-gray-500">{detail[i]}</span>
            {i < 3 && spent[i] !== null && (done(i) || active(i)) && <span className="mt-1 text-[11px] font-semibold text-gray-300 tabular-nums">{secs(spent[i]!)}</span>}
          </div>
          {i < 3 && (
            <div className="relative mx-1 flex-1 self-center">
              <div className={`h-1 rounded-full ${done(i + 1) ? 'bg-green-600' : 'bg-gray-700'}`} />
              {/* the information travelling to the next place */}
              {(active(i) || (i === 2 && step === 2)) && <span className="travel absolute top-1/2 size-2.5 -translate-y-1/2 rounded-full bg-sky-300 shadow-[0_0_10px_var(--color-sky-300)]" />}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
