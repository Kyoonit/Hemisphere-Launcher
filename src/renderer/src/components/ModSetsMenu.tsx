import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, ClipboardPaste, Copy, Layers, LoaderCircle, Pencil, Plus, Share2, Trash2, TriangleAlert, X } from 'lucide-react'
import { SET_NAME_MAX, type ModSetInfo, type ModSetsState } from '@shared/modSets'
import ConfirmDialog from './ConfirmDialog'
import { presetDetails } from '../presets'

/** An action that couldn't reach the launcher's core: shown as an error, never silently ignored. */
const failed = { ok: false, reason: 'failed' } as const

type Message = { ok: boolean; text: string; list?: string[] }

/**
 * Mods page: the "Sets" menu. Save the mods as they are as a set, switch, rename, share as a code, add a friend's set,
 * delete (with a confirmation naming the set).
 */
export default function ModSetsMenu({ className, onSwitched }: { className: string; onSwitched(): void }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<ModSetsState | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<Message | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<ModSetInfo | null>(null)
  const [adding, setAdding] = useState<'save' | 'code' | null>(null)
  const [text, setText] = useState('')
  const box = useRef<HTMLDivElement>(null)
  const reload = () => window.hemisphere.modSets.list().then(setState)
  useEffect(() => {
    void reload()
  }, [])

  // close on a click outside or Esc (unless a confirmation box is open)
  useEffect(() => {
    if (!open || deleting) return
    const down = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', down)
      document.removeEventListener('keydown', key)
    }
  }, [open, deleting])

  const active = state?.sets.find((s) => s.id === state.active) ?? null
  const reset = () => {
    setAdding(null)
    setRenaming(null)
    setText('')
  }

  const switchTo = async (s: ModSetInfo) => {
    setMessage(null)
    setBusy(s.id)
    const r = await window.hemisphere.modSets.switchTo(s.id, t('sets.myMods')).catch(() => failed)
    setBusy(null)
    if (r.ok) {
      const text = r.savedAs ? t('sets.switchedSaved', { name: s.name, saved: r.savedAs }) : t('sets.switched', { name: s.name })
      setMessage({ ok: !r.missing.length, text, list: r.missing.length ? [t('sets.missing', { names: r.missing.join(', ') })] : undefined })
      onSwitched()
    } else setMessage({ ok: false, text: t(`sets.errors.${r.reason}`) })
    void reload()
  }
  const save = async () => {
    const name = text.trim()
    if (!name) return
    setBusy('save')
    const r = await window.hemisphere.modSets.save(name).catch(() => null)
    setBusy(null)
    reset()
    setMessage(r ? { ok: true, text: t('sets.saved', { name: r.name }) } : { ok: false, text: t('sets.errors.failed') })
    void reload()
  }
  const rename = async (id: string) => {
    if (text.trim()) await window.hemisphere.modSets.rename(id, text).catch(() => false)
    reset()
    void reload()
  }
  const share = async (s: ModSetInfo) => {
    setMessage(null)
    const r = await window.hemisphere.modSets.share(s.id).catch(() => failed)
    if (r.ok) setMessage({ ok: true, text: t('sets.shared', { name: s.name }), list: r.left.length ? [t('sets.notShared', { names: r.left.join(', ') })] : undefined })
    else setMessage({ ok: false, text: t(`sets.errors.${r.reason}`) })
  }
  const importCode = async () => {
    if (!text.trim()) return
    setMessage(null)
    setBusy('code')
    const r = await window.hemisphere.modSets.importCode(text).catch(() => failed)
    setBusy(null)
    if (r.ok) {
      reset()
      const skipped = r.skipped.map((s) => t(`backups.skipped.${s.reason}`, { name: s.name }))
      setMessage({ ok: !skipped.length, text: t('sets.imported', { name: r.name, count: r.mods }), list: skipped.length ? skipped : undefined })
    } else setMessage({ ok: false, text: t(`sets.errors.${r.reason}`) })
    void reload()
  }
  const duplicate = async (s: ModSetInfo) => {
    setMessage(null)
    const copy = await window.hemisphere.modSets.duplicate(s.id).catch(() => null)
    await reload()
    if (!copy) return setMessage({ ok: false, text: t('sets.errors.failed') })
    setMessage({ ok: true, text: t('sets.duplicated', { name: s.name, copy: copy.name }) })
    // straight into renaming the copy
    setAdding(null)
    setRenaming(copy.id)
    setText(copy.name)
  }
  const remove = async (s: ModSetInfo) => {
    setDeleting(null)
    await window.hemisphere.modSets.remove(s.id).catch(() => false)
    setMessage({ ok: true, text: t('sets.deleted', { name: s.name }) })
    void reload()
  }

  const icon = 'grid h-8 w-8 flex-none place-items-center rounded-lg text-gray-400 transition-colors hover:bg-gray-700 hover:text-white'
  return (
    <div ref={box} className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className={`${className} ${open ? '!bg-gray-700 !text-white' : ''}`}>
        <Layers size={14} /> <span className="max-w-[160px] truncate">{active ? active.name : t('sets.button')}</span> <ChevronDown size={13} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="animate-fade absolute top-full right-0 z-30 mt-1.5 w-[380px] max-w-[calc(100vw-48px)] rounded-xl bg-gray-900 p-3 shadow-2xl ring-1 ring-gray-700">
          <b className="block px-1 text-sm text-white">{t('sets.title')}</b>
          <p className="mb-2 px-1 text-[12px] text-gray-400">{t('sets.hint')}</p>

          {message && (
            <div role="status" className={`mb-2 flex items-start gap-2 rounded-lg px-2.5 py-2 text-[12.5px] ${message.ok ? 'bg-green-900/40 text-green-200' : 'bg-amber-900/35 text-amber-200'}`}>
              {message.ok ? <Check size={14} className="mt-0.5 flex-none" /> : <TriangleAlert size={14} className="mt-0.5 flex-none" />}
              <div className="min-w-0 flex-1 break-words">
                {message.text}
                {message.list?.map((l) => (
                  <span key={l} className="block opacity-85">
                    {l}
                  </span>
                ))}
              </div>
              <button onClick={() => setMessage(null)} aria-label={t('shots.close')} className="flex-none opacity-70 hover:opacity-100">
                <X size={13} />
              </button>
            </div>
          )}

          {state && state.sets.length > 0 ? (
            <ul className="max-h-[260px] overflow-auto">
              {state.sets.map((s) => {
                const isActive = s.id === state.active
                return (
                  <li key={s.id} className={`flex items-center gap-1 rounded-lg px-1.5 py-1.5 ${isActive ? 'bg-green-900/25' : 'hover:bg-gray-800/70'}`}>
                    {renaming === s.id ? (
                      <input
                        autoFocus
                        value={text}
                        maxLength={SET_NAME_MAX}
                        onChange={(e) => setText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void rename(s.id)
                          if (e.key === 'Escape') {
                            e.stopPropagation()
                            reset()
                          }
                        }}
                        onBlur={() => void rename(s.id)}
                        aria-label={t('sets.rename')}
                        className="min-w-0 flex-1 rounded-md border border-gray-600 bg-gray-950 px-2 py-1 text-[13px] text-white"
                      />
                    ) : (
                      <button
                        onClick={() => !isActive && void switchTo(s)}
                        disabled={!!busy}
                        title={isActive ? t('sets.activeHint') : t('sets.switchTo', { name: s.name })}
                        className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-0.5 text-left ${isActive ? 'cursor-default' : ''}`}
                      >
                        <span className={`grid h-5 w-5 flex-none place-items-center rounded-full ${isActive ? 'bg-green-500 text-white' : 'ring-1 ring-gray-500'}`}>
                          {busy === s.id ? <LoaderCircle size={12} className="animate-spin text-gray-300" /> : isActive && <Check size={12} strokeWidth={3} />}
                        </span>
                        <span className="min-w-0">
                          <b className="block truncate text-[13.5px] font-semibold text-white">{s.name}</b>
                          <span className="block text-[11.5px] text-gray-400">
                            {presetDetails(s, t)}
                            {isActive && ` · ${t('sets.active')}`}
                          </span>
                        </span>
                      </button>
                    )}
                    <button onClick={() => duplicate(s)} title={t('sets.duplicate')} aria-label={t('sets.duplicate')} className={icon}>
                      <Copy size={14} />
                    </button>
                    <button onClick={() => share(s)} title={t('sets.share')} aria-label={t('sets.share')} className={icon}>
                      <Share2 size={14} />
                    </button>
                    <button
                      onClick={() => {
                        setAdding(null)
                        setRenaming(s.id)
                        setText(s.name)
                      }}
                      title={t('sets.rename')}
                      aria-label={t('sets.rename')}
                      className={icon}
                    >
                      <Pencil size={14} />
                    </button>
                    {state.sets.length > 1 && (
                      <button onClick={() => setDeleting(s)} title={t('sets.delete')} aria-label={t('sets.delete')} className={`${icon} hover:!text-red-400`}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="rounded-lg bg-gray-800/60 px-3 py-3 text-[12.5px] text-gray-400">{t('sets.empty')}</p>
          )}

          <div className="mt-2 border-t border-white/5 pt-2">
            {adding === 'save' ? (
              <div className="flex gap-1.5">
                <input
                  autoFocus
                  value={text}
                  maxLength={SET_NAME_MAX}
                  placeholder={t('sets.namePlaceholder')}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void save()
                    if (e.key === 'Escape') {
                      e.stopPropagation()
                      reset()
                    }
                  }}
                  aria-label={t('sets.namePlaceholder')}
                  className="min-w-0 flex-1 rounded-lg border border-gray-600 bg-gray-950 px-2.5 py-1.5 text-[13px] text-white"
                />
                <button onClick={save} disabled={!text.trim() || busy === 'save'} className="rounded-lg bg-green-600 px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-green-500 disabled:opacity-50">
                  {t('sets.saveButton')}
                </button>
              </div>
            ) : adding === 'code' ? (
              <div>
                <textarea
                  autoFocus
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.stopPropagation()
                      reset()
                    }
                  }}
                  rows={3}
                  placeholder="HSET1-…"
                  aria-label={t('sets.codePlaceholder')}
                  className="w-full resize-none rounded-lg border border-gray-600 bg-gray-950 px-2.5 py-1.5 font-mono text-[12px] text-white"
                />
                <div className="mt-1.5 flex justify-end gap-1.5">
                  <button onClick={reset} className="rounded-lg px-3 py-1.5 text-[13px] font-semibold text-gray-400 hover:bg-gray-700 hover:text-white">
                    {t('browse.cancel')}
                  </button>
                  <button onClick={importCode} disabled={!text.trim() || busy === 'code'} className="flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-green-500 disabled:opacity-50">
                    {busy === 'code' && <LoaderCircle size={13} className="animate-spin" />} {busy === 'code' ? t('sets.adding') : t('sets.addButton')}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-1">
                <button
                  onClick={() => {
                    reset()
                    setAdding('save')
                  }}
                  className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-semibold text-green-400 hover:bg-gray-800 hover:text-green-300"
                >
                  <Plus size={14} /> {t('sets.saveCurrent')}
                </button>
                <button
                  onClick={() => {
                    reset()
                    setAdding('code')
                  }}
                  className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-semibold text-gray-300 hover:bg-gray-800 hover:text-white"
                >
                  <ClipboardPaste size={14} /> {t('sets.addFriend')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {deleting && (
        <ConfirmDialog title={t('sets.deleteTitle')} confirmLabel={t('sets.deleteConfirm')} onConfirm={() => remove(deleting)} onCancel={() => setDeleting(null)}>
          <p className="rounded-lg bg-gray-800/80 px-3 py-2.5">
            <b className="block text-white">“{deleting.name}”</b>
            <span className="text-[12.5px] text-gray-400">{presetDetails(deleting, t)}</span>
          </p>
          <p className="mt-3">{t('sets.deleteBody')}</p>
        </ConfirmDialog>
      )}
    </div>
  )
}
