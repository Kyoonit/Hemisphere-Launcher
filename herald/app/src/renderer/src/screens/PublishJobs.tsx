/**
 * Where the last change is, live: Herald server → GitHub Actions (checks and signs) → GitHub → players' launchers.
 * A thin bar under the title bar, on every tab: what the last change was, where it is now, and the time so far. Every
 * change launchers receive (publications, maintenances, restarts…) goes through it. Nothing to open, nothing hidden.
 */
import { useEffect, useState } from 'react'
import type { PublishJob } from '@herald/api'
import { titleOf, usePubs } from '../pubs'
import { useStore } from '../store'

/** Launchers ask the Herald server every 2 minutes (the pulse), then read the new content at once */
const PULSE_MS = 120_000

/** 0 queued on the Herald server · 1 GitHub Actions · 2 on GitHub, launchers on their way · 4 everywhere */
type Step = 0 | 1 | 2 | 4
const STAGES = ['Herald server', 'GitHub Actions', 'GitHub', 'Launchers']

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

/** The last change in words: "Maintenance started", "Published “Season 3”"… */
function whatOf(reason: string | null, titles: Map<string, string>): string {
  const r = reason ?? ''
  const pub = r.match(/^(publish|unpublish|delete) ([nebw]-[a-z0-9]{12})$/)
  if (pub) return `${{ publish: 'Published', unpublish: 'Taken down', delete: 'Removed' }[pub[1]]} “${titles.get(pub[2]) ?? '…'}”`
  if (/^maintenance m-[a-z0-9]+ removed$/.test(r)) return 'Planned maintenance removed'
  if (/^maintenance m-/.test(r)) return 'Maintenance planned'
  return { 'maintenance now': 'Maintenance started', 'back online': 'Server back online', 'daily restart': 'Daily restart changed', 'publish again': 'Published again' }[r] ?? (r || 'Change')
}

const ago = (ms: number) => (ms < 60_000 ? 'just now' : ms < 3_600_000 ? `${Math.floor(ms / 60_000)} min ago` : ms < 86_400_000 ? `${Math.floor(ms / 3_600_000)} h ago` : `${Math.floor(ms / 86_400_000)} d ago`)

/** The bar: the last change, the pipeline, then the status pill on the right */
export function PublishJobs() {
  const { state, act, reload } = usePubs()
  const { can } = useStore()
  const [now, setNow] = useState(Date.now())
  const last = state?.jobs.find((j) => j.status !== 'superseded') ?? null
  const working = last && (last.status === 'queued' || last.status === 'publishing')
  const step = last ? stepOf(last, now) : 4

  // While it travels: ask the server every 2 s, tick until launchers have it
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
  // Minutes "ago" stay fresh when idle
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(t)
  }, [])
  if (!state || !last) return null

  const failed = last.status === 'failed'
  const label = failed ? 'Refused by the check' : step === 0 ? `Waiting for GitHub… ${secs(now - last.created_at)}` : step === 1 ? `Checking and signing… ${secs(now - last.created_at)}` : step === 2 ? `Reaching launchers… ${secs(last.updated_at + PULSE_MS - now)}` : 'Launchers up to date'
  const tone = failed ? 'border-red-400/40 text-red-300' : step < 2 ? 'border-amber-400/40 text-amber-300' : step === 2 ? 'border-sky-400/40 text-sky-300' : 'border-green-400/30 text-green-300'

  // Usual time from Herald to GitHub, from the last finished changes
  const finished = state.jobs.filter((j) => j.status === 'done')
  const toGithub = finished.length ? finished.reduce((n, j) => n + (j.updated_at - j.created_at), 0) / finished.length : 15_000
  const what = whatOf(last.reason, new Map(state.publications.map((p) => [p.id, titleOf(p.data)])))
  const about = `Usually about ${secs(toGithub)} from Herald to GitHub, then up to 2 min for the launchers (they check every 2 minutes): a whole change takes ${secs(toGithub + 60_000)} on average, ${secs(toGithub + PULSE_MS)} at most. A closed launcher gets it when it starts.`

  return (
    <div className="flex h-[46px] shrink-0 items-center gap-5 border-b border-gray-700/70 bg-gray-900/60 px-7" title={about}>
      <div className="w-[260px] min-w-0 shrink leading-tight">
        <div className="truncate text-[12.5px] font-semibold text-white">{what}</div>
        <div className="truncate text-[11px] text-gray-400">
          {last.who ?? 'Herald'} · {ago(now - last.created_at)}
        </div>
      </div>
      <Pipeline job={last} step={step} now={now} />
      {failed && can('publications.publish') && (
        <button className="btn btn-sm btn-primary shrink-0" title={last.error ?? ''} onClick={() => void act('POST', '/publish')}>
          Publish again
        </button>
      )}
      <span className={`flex shrink-0 items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold tabular-nums ${tone}`}>
        {step < 4 && !failed && <span className="size-2 animate-pulse rounded-full bg-current" />}
        {label}
      </span>
    </div>
  )
}

/** The four places in one line, the information moving between them */
function Pipeline({ job, step, now }: { job: PublishJob; step: Step; now: number }) {
  const failed = job.status === 'failed'
  const done = (i: number) => (failed ? i === 0 : step > i || step === 4 || (i === 2 && step === 2))
  const active = (i: number) => !failed && step < 4 && step === i
  const started = job.started_at ?? (job.status === 'done' ? job.updated_at : null)
  // Time spent in each place, or what is there
  const spent = [
    secs((started ?? now) - job.created_at),
    failed ? 'refused' : started ? secs((job.status === 'done' ? job.updated_at : now) - started) : '',
    job.commit_sha ? job.commit_sha.slice(0, 7) : '',
    step === 2 ? `≤ ${secs(job.updated_at + PULSE_MS - now)}` : step === 4 ? 'up to date' : '',
  ]
  return (
    <div className="flex min-w-0 flex-1 items-center">
      {STAGES.map((title, i) => (
        <div key={title} className={`flex min-w-0 items-center ${i < 3 ? 'flex-1' : ''}`}>
          <div className="flex shrink-0 items-center gap-1.5">
            <span className={`grid size-5 place-items-center rounded-full text-[10px] font-bold ${failed && i === 1 ? 'bg-red-600 text-white' : done(i) ? 'bg-green-600 text-white' : active(i) ? 'bg-sky-500 text-white ring-2 ring-sky-400/40' : 'bg-gray-700 text-gray-400'}`}>
              {failed && i === 1 ? '✕' : done(i) ? '✓' : i + 1}
            </span>
            <span className="leading-tight">
              <span className={`block text-[11.5px] font-semibold whitespace-nowrap ${active(i) ? 'text-white' : 'text-gray-300'}`}>{title}</span>
              <span className="block text-[10.5px] whitespace-nowrap text-gray-500 tabular-nums">{spent[i] || ' '}</span>
            </span>
          </div>
          {i < 3 && (
            <div className="relative mx-2 min-w-4 flex-1">
              <div className={`h-0.5 rounded-full ${done(i + 1) ? 'bg-green-600' : 'bg-gray-700'}`} />
              {/* the information travelling to the next place */}
              {(active(i) || (i === 2 && step === 2)) && <span className="travel absolute top-1/2 size-2 -translate-y-1/2 rounded-full bg-sky-300 shadow-[0_0_8px_var(--color-sky-300)]" />}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
