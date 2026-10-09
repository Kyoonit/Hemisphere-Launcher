/** Small shared pieces: avatars, modal, zone picker. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { offsetOf, formatTime, zoneGroups, zoneLabel } from '../time'

const AVATAR_COLORS = ['#fde68a', '#86efac', '#bfdbfe', '#c4b5fd', '#99f6e4', '#fdba74', '#fca5a5', '#a5f3fc', '#fbcfe8', '#d9f99d', '#bae6fd']
export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  const color = AVATAR_COLORS[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % AVATAR_COLORS.length]
  return (
    <span className="grid shrink-0 place-items-center rounded-md font-extrabold text-gray-900" style={{ width: size, height: size, background: color, fontSize: size * 0.4 }}>
      {name.slice(0, 2)}
    </span>
  )
}

export function Modal({ title, onClose, children }: { title: string; onClose?(): void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose?.()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  // In document.body: an animated parent would otherwise hold the overlay (and leave the title bar uncovered)
  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/55" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="w-[460px] animate-fade rounded-xl bg-gray-800 p-5 shadow-2xl">
        <h2 className="mb-3 text-lg font-bold text-white">{title}</h2>
        {children}
      </div>
    </div>,
    document.body,
  )
}

/** Searchable picker over every time zone (cities, countries, UTC, fixed offsets), with each one's offset and time. */
export function ZonePicker({ value, onPick, placeholder }: { value: string | null; onPick(zone: string): void; placeholder?: string }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const box = useRef<HTMLDivElement>(null)
  const groups = useMemo(() => zoneGroups(), [])
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])
  const q = query.trim().toLowerCase()
  const now = Date.now()
  return (
    <div ref={box} className="relative">
      <button type="button" className="btn btn-ghost w-full justify-between font-medium" onClick={() => (setOpen(!open), setQuery(''))}>
        <span>{value ? `◷ ${zoneLabel(value)} · ${offsetOf(value)}` : (placeholder ?? 'Choose a time zone')}</span>
        <span className="text-gray-400">▾</span>
      </button>
      {open && (
        <div className="absolute top-full right-0 left-0 z-40 mt-1 max-h-80 overflow-auto rounded-lg border border-gray-600 bg-gray-800 shadow-2xl">
          <div className="sticky top-0 z-10 bg-gray-800 p-2">
            <input autoFocus className="field" placeholder="Search a city, a country or UTC+…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          {groups.map(([group, zones]) => {
            const shown = zones.filter((z) => !q || zoneLabel(z).toLowerCase().includes(q) || offsetOf(z, now).toLowerCase().includes(q))
            if (!shown.length) return null
            return (
              <div key={group}>
                <div className="sticky top-12 bg-gray-800 px-3 pt-2 pb-1 text-[10.5px] font-bold tracking-widest text-gray-400 uppercase">
                  {group} · {shown.length}
                </div>
                {shown.map((z) => (
                  <button key={z} type="button" className="flex w-full px-3 py-1.5 text-left text-sm text-gray-300 hover:bg-gray-700 hover:text-white" onClick={() => (onPick(z), setOpen(false))}>
                    {zoneLabel(z)}
                    <span className="ml-auto text-xs text-gray-400 tabular-nums">
                      {offsetOf(z, now)} · {formatTime(now, z)}
                    </span>
                  </button>
                ))}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
