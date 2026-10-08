import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, Layers, LoaderCircle, Settings2 } from 'lucide-react'
import type { ModSetsState } from '@shared/modSets'

/** Home, under PLAY: the active mod set, with a small menu to switch to another one in one click. */
export default function SetSwitcher({ onManage }: { onManage(): void }) {
  const { t } = useTranslation()
  const [state, setState] = useState<ModSetsState | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const box = useRef<HTMLSpanElement>(null)
  const reload = () => window.hemisphere.modSets.list().then(setState)
  useEffect(() => {
    void reload()
  }, [])
  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
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
    const r = await window.hemisphere.modSets.switchTo(id, t('sets.myMods'))
    setBusy(null)
    await reload()
    if (r.ok) setOpen(false)
    else setError(t(`sets.errors.${r.reason}`))
  }

  return (
    <span ref={box} className="relative inline-flex">
      <button
        onClick={() => {
          setError(null)
          setOpen((o) => !o)
        }}
        aria-expanded={open}
        aria-haspopup="menu"
        title={t('sets.quickHint')}
        className="inline-flex max-w-[200px] items-center gap-1 rounded-md px-1 font-semibold text-gray-300 transition-colors hover:bg-white/10 hover:text-white"
      >
        <Layers size={13} className="flex-none text-green-400" />
        <span className="truncate">{active.name}</span>
        <ChevronDown size={13} className={`flex-none transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div role="menu" className="animate-fade absolute top-full left-1/2 z-30 mt-2 w-[260px] -translate-x-1/2 rounded-xl bg-gray-900/95 p-1.5 text-left shadow-2xl ring-1 ring-gray-700 backdrop-blur">
          <p className="px-2.5 pt-1 pb-1.5 text-[11px] font-bold tracking-[0.08em] text-gray-400 uppercase">{t('sets.title')}</p>
          <ul className="max-h-[220px] overflow-auto">
            {state.sets.map((s) => {
              const isActive = s.id === state.active
              return (
                <li key={s.id}>
                  <button
                    role="menuitemradio"
                    aria-checked={isActive}
                    onClick={() => switchTo(s.id)}
                    disabled={!!busy}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors disabled:cursor-wait ${isActive ? 'bg-green-900/30' : 'hover:bg-gray-800'}`}
                  >
                    <span className={`grid h-5 w-5 flex-none place-items-center rounded-full ${isActive ? 'bg-green-500 text-white' : 'ring-1 ring-gray-500'}`}>
                      {busy === s.id ? <LoaderCircle size={12} className="animate-spin text-gray-300" /> : isActive && <Check size={12} strokeWidth={3} />}
                    </span>
                    <span className="min-w-0">
                      <b className="block truncate text-[13.5px] font-semibold text-white">{s.name}</b>
                      <span className="block text-[11.5px] text-gray-400">{t('sets.counts', { count: s.mods, on: s.enabled })}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
          {error && <p className="mx-2.5 my-1 text-[12px] text-amber-300">{error}</p>}
          <button
            onClick={() => {
              setOpen(false)
              onManage()
            }}
            className="mt-1 flex w-full items-center gap-2 rounded-lg border-t border-white/5 px-2.5 py-2 text-[13px] font-semibold text-gray-300 hover:bg-gray-800 hover:text-white"
          >
            <Settings2 size={14} /> {t('sets.manage')}
          </button>
        </div>
      )}
    </span>
  )
}
