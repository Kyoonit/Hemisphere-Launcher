import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, Layers, LoaderCircle, Settings2 } from 'lucide-react'
import type { ModSetsState } from '@shared/modSets'
import { presetDetails } from '../presets'

/** An action that couldn't reach the launcher's core: shown as an error, never silently ignored. */
const failed = { ok: false, reason: 'failed' } as const

/**
 * Home, under PLAY: the active mod set, with a small menu to switch in one click. The menu is drawn over everything
 * (nothing on the page can cover it), sized to the room left in the window, "Manage sets…" always visible.
 */
export default function SetSwitcher({ onManage }: { onManage(): void }) {
  const { t } = useTranslation()
  const [state, setState] = useState<ModSetsState | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [place, setPlace] = useState<React.CSSProperties>({})
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const reload = () => window.hemisphere.modSets.list().then(setState)
  useEffect(() => {
    void reload()
  }, [])

  // below the button when there's room, else above it; never past the window's edges
  useLayoutEffect(() => {
    if (!open || !button.current) return
    const position = () => {
      const r = button.current!.getBoundingClientRect()
      const below = window.innerHeight - r.bottom - 12
      const above = r.top - 60
      const left = Math.min(Math.max(r.left + r.width / 2, 120), window.innerWidth - 120)
      setPlace(
        below >= 150 || below >= above
          ? { top: r.bottom + 4, left, maxHeight: below }
          : { bottom: window.innerHeight - r.top + 4, left, maxHeight: above },
      )
    }
    position()
    window.addEventListener('resize', position)
    return () => window.removeEventListener('resize', position)
  }, [open])

  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => !button.current?.contains(e.target as Node) && !menu.current?.contains(e.target as Node) && setOpen(false)
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', down)
      document.removeEventListener('keydown', key)
    }
  }, [open])

  const active = state?.sets.find((s) => s.id === state.active)
  if (!state || !active) return null

  const switchTo = async (id: string) => {
    if (id === state.active) return setOpen(false)
    setError(null)
    setBusy(id)
    const r = await window.hemisphere.modSets.switchTo(id, t('sets.myMods')).catch(() => failed)
    setBusy(null)
    await reload()
    if (r.ok) setOpen(false)
    else setError(t(`sets.errors.${r.reason}`))
  }

  return (
    <>
      <button
        ref={button}
        onClick={() => {
          setError(null)
          setOpen((o) => !o)
        }}
        aria-expanded={open}
        aria-haspopup="menu"
        title={t('sets.quickHint')}
        className="inline-flex max-w-[200px] items-center gap-1 rounded-md px-1.5 py-0.5 text-[12.5px] font-medium text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
      >
        <Layers size={12} className="flex-none text-green-400" />
        <span className="truncate">{active.name}</span>
        <ChevronDown size={12} className={`flex-none transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open &&
        createPortal(
          <div
            ref={menu}
            role="menu"
            style={place}
            className="animate-fade fixed z-[60] flex w-[220px] -translate-x-1/2 flex-col rounded-lg bg-gray-900/95 p-1 text-left shadow-2xl ring-1 ring-gray-700 backdrop-blur"
          >
            <ul className="min-h-0 overflow-auto">
              {state.sets.map((s) => {
                const isActive = s.id === state.active
                return (
                  <li key={s.id}>
                    <button
                      role="menuitemradio"
                      aria-checked={isActive}
                      onClick={() => switchTo(s.id)}
                      disabled={!!busy}
                      title={presetDetails(s, t)}
                      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors disabled:cursor-wait ${isActive ? 'bg-green-900/30 text-white' : 'text-gray-200 hover:bg-gray-800'}`}
                    >
                      <span className="grid w-3.5 flex-none place-items-center">
                        {busy === s.id ? <LoaderCircle size={13} className="animate-spin text-gray-300" /> : isActive && <Check size={13} strokeWidth={3} className="text-green-400" />}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
                      <span className="flex-none text-[11px] text-gray-500 tabular-nums">{t('sets.onCount', { count: s.enabled })}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
            {error && <p className="px-2 py-1 text-[11.5px] text-amber-300">{error}</p>}
            <button
              onClick={() => {
                setOpen(false)
                onManage()
              }}
              className="mt-0.5 flex flex-none items-center gap-2 rounded-md border-t border-white/5 px-2 py-1.5 text-[12.5px] font-medium text-gray-400 hover:bg-gray-800 hover:text-white"
            >
              <Settings2 size={13} /> {t('sets.manage')}
            </button>
          </div>,
          document.body,
        )}
    </>
  )
}
