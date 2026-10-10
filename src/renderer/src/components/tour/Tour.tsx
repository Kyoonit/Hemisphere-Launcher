import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/**
 * A guided tour (launcher and Herald): one step at a time, the part it talks about lit up, the rest of the window
 * dimmed. Every popup shows where the tour is ("3 / 12"); a step can be passed, a whole part skipped, the tour quit at
 * any time (Esc). Steps name their element with a data-tour attribute; a step without one (or whose element is not
 * there) is shown in the middle. Texts come from the app (its own language): this component holds none.
 */
export interface TourStep {
  id: string
  /** its part ("Home", "Settings"…): "Skip this part" goes to the first step of the next one */
  part: string
  title: string
  body: string
  /** data-tour value of the element it is about */
  target?: string
  /** brings the element on screen first (opens a tab, a section…) */
  before?(): void
}

export interface TourLabels {
  next: string
  back: string
  finish: string
  skipPart: string
  quit: string
  /** "{{n}} / {{total}}" filled in */
  counter(n: number, total: number): string
}

const PAD = 8
const GAP = 14
const WIDTH = 360

type Box = { top: number; left: number; width: number; height: number }

/** Where the element is (null: none, the popup goes in the middle) */
function find(target: string | undefined): HTMLElement | null {
  if (!target) return null
  const el = document.querySelector<HTMLElement>(`[data-tour="${target}"]`)
  if (!el) return null
  const r = el.getBoundingClientRect()
  return r.width && r.height ? el : null
}

export function Tour({ steps, labels, onClose }: { steps: TourStep[]; labels: TourLabels; onClose(done: boolean): void }) {
  const [index, setIndex] = useState(0)
  const [box, setBox] = useState<Box | null>(null)
  const [ready, setReady] = useState(false)
  const pop = useRef<HTMLDivElement>(null)
  const [popSize, setPopSize] = useState({ width: WIDTH, height: 180 })
  const step = steps[index]
  const last = index === steps.length - 1

  // the step's screen first, then its element (it may take a moment to appear: a lazy screen, an animation)
  useEffect(() => {
    // the last step's light goes at once: the new one appears where its element is (no slide from the old place)
    setReady(false)
    setBox(null)
    step.before?.()
    let alive = true
    let frame = 0
    const started = performance.now()
    const look = () => {
      if (!alive) return
      const el = find(step.target)
      if (el || !step.target || performance.now() - started > 2500) {
        el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
        setReady(true)
        return
      }
      frame = requestAnimationFrame(look)
    }
    frame = requestAnimationFrame(look)
    return () => {
      alive = false
      cancelAnimationFrame(frame)
    }
  }, [index]) // eslint-disable-line react-hooks/exhaustive-deps

  // follows the element while the step is shown (window resized, page scrolled, element animated)
  useEffect(() => {
    if (!ready) return
    let frame = 0
    const follow = () => {
      const el = find(step.target)
      const r = el?.getBoundingClientRect()
      setBox((b) => {
        if (!r) return null
        const next = { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 }
        return b && Math.abs(b.top - next.top) < 0.5 && Math.abs(b.left - next.left) < 0.5 && Math.abs(b.width - next.width) < 0.5 && Math.abs(b.height - next.height) < 0.5 ? b : next
      })
      frame = requestAnimationFrame(follow)
    }
    follow()
    return () => cancelAnimationFrame(frame)
  }, [ready, index]) // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    const r = pop.current?.getBoundingClientRect()
    if (r && (Math.abs(r.width - popSize.width) > 1 || Math.abs(r.height - popSize.height) > 1)) setPopSize({ width: r.width, height: r.height })
  })

  const go = (i: number) => (i >= steps.length ? onClose(true) : setIndex(Math.max(0, i)))
  const nextPart = () => {
    const i = steps.findIndex((s, k) => k > index && s.part !== step.part)
    go(i < 0 ? steps.length : i)
  }

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose(false)
      else if (e.key === 'ArrowRight' || e.key === 'Enter') go(index + 1)
      else if (e.key === 'ArrowLeft') go(index - 1)
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }) // eslint-disable-line react-hooks/exhaustive-deps

  // the popup: beside the element (below, above, then a side), always inside the window
  const vw = window.innerWidth
  const vh = window.innerHeight
  let top = (vh - popSize.height) / 2
  let left = (vw - popSize.width) / 2
  if (box) {
    const below = box.top + box.height + GAP
    const above = box.top - GAP - popSize.height
    const right = box.left + box.width + GAP
    const leftSide = box.left - GAP - popSize.width
    if (below + popSize.height <= vh - 8) [top, left] = [below, box.left + box.width / 2 - popSize.width / 2]
    else if (above >= 8) [top, left] = [above, box.left + box.width / 2 - popSize.width / 2]
    else if (right + popSize.width <= vw - 8) [top, left] = [box.top + box.height / 2 - popSize.height / 2, right]
    else if (leftSide >= 8) [top, left] = [box.top + box.height / 2 - popSize.height / 2, leftSide]
    top = Math.min(Math.max(8, top), vh - popSize.height - 8)
    left = Math.min(Math.max(8, left), vw - popSize.width - 8)
  }
  const partSteps = steps.filter((s) => s.part === step.part).length
  const morePartsAfter = steps.slice(index + 1).some((s) => s.part !== step.part)

  return (
    <div className="fixed inset-0 z-[1000]" role="dialog" aria-modal="true" aria-label={step.title}>
      {/* the dim around the lit part: nothing behind can be clicked while the tour is open */}
      {/* one dim for the whole tour: a hole around the lit part, or (between steps, or a step without one) none */}
      <div
        className={`pointer-events-none absolute rounded-xl ${box && ready ? 'ring-2 ring-green-400/80' : ''}`}
        style={
          box && ready
            ? { top: box.top, left: box.left, width: box.width, height: box.height, boxShadow: '0 0 0 9999px rgba(3, 7, 18, 0.72), 0 0 24px rgba(74, 222, 128, 0.35)' }
            : { top: '50%', left: '50%', width: 0, height: 0, boxShadow: '0 0 0 9999px rgba(3, 7, 18, 0.72)' }
        }
      />
      <div className="absolute inset-0" onMouseDown={(e) => e.preventDefault()} />
      <div
        ref={pop}
        key={`popup-${step.id}`}
        className={`animate-fade absolute rounded-2xl border border-white/10 bg-gray-900/95 p-4 text-left shadow-2xl backdrop-blur-md ${ready ? '' : 'invisible'}`}
        style={{ top, left, width: Math.min(WIDTH, vw - 16) }}
      >
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-[11px] font-bold tracking-[0.08em] text-green-400 uppercase">{step.part}</span>
          <span className="rounded-full bg-gray-800 px-2 py-0.5 text-[11.5px] font-semibold text-gray-300 tabular-nums">{labels.counter(index + 1, steps.length)}</span>
        </div>
        <h3 className="text-[16px] font-bold text-white">{step.title}</h3>
        <p className="mt-1.5 text-[13px] leading-relaxed whitespace-pre-line text-gray-300">{step.body}</p>
        {/* where the tour is, as a bar */}
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-gray-800">
          <i className="block h-full rounded-full bg-green-500 transition-[width] duration-300" style={{ width: `${((index + 1) / steps.length) * 100}%` }} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <button onClick={() => onClose(false)} className="rounded-lg px-2.5 py-1.5 text-[12.5px] font-semibold text-gray-400 transition-colors hover:bg-gray-800 hover:text-white">
            {labels.quit}
          </button>
          {morePartsAfter && partSteps > 1 && (
            <button onClick={nextPart} className="rounded-lg px-2.5 py-1.5 text-[12.5px] font-semibold text-gray-400 transition-colors hover:bg-gray-800 hover:text-white">
              {labels.skipPart}
            </button>
          )}
          <div className="ml-auto flex gap-1.5">
            {index > 0 && (
              <button onClick={() => go(index - 1)} className="rounded-lg bg-gray-800 px-3 py-1.5 text-[13px] font-semibold text-gray-200 transition-colors hover:bg-gray-700">
                {labels.back}
              </button>
            )}
            <button onClick={() => go(index + 1)} className="rounded-lg bg-green-600 px-3.5 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-green-500">
              {last ? labels.finish : labels.next}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
