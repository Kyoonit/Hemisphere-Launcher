import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Check, CloudOff, Download, Layers, LoaderCircle, Lock, LockOpen, Package, RefreshCw, RotateCcw, Trash2, TriangleAlert, Undo2, type LucideIcon } from 'lucide-react'
import type { ModHistoryItem } from '@shared/modSets'

const ICONS: Record<ModHistoryItem['kind'], LucideIcon> = {
  version: Package,
  update: RefreshCw,
  install: Download,
  remove: Trash2,
  lock: Lock,
  unlock: LockOpen,
  backToHemisphere: RotateCcw,
  setSwitch: Layers,
  setImport: Layers,
}

/** Mods > History: everyday mod changes, newest first, grouped by day, with Undo while it's still possible. */
export default function ModHistory({ onBack }: { onBack(): void }) {
  const { t, i18n } = useTranslation()
  const [items, setItems] = useState<ModHistoryItem[] | null | undefined>(undefined)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const reload = () => window.hemisphere.modHistory.list().then(setItems)
  useEffect(() => {
    void reload()
  }, [])

  const groups = useMemo(() => {
    const out: { key: string; label: string; items: ModHistoryItem[] }[] = []
    const day = (ms: number) => new Date(ms).toDateString()
    const today = day(Date.now())
    const yesterday = day(Date.now() - 86_400_000)
    for (const e of items ?? []) {
      const key = day(e.at)
      let g = out.find((x) => x.key === key)
      if (!g) {
        const d = new Date(e.at)
        const label =
          key === today
            ? t('shots.today')
            : key === yesterday
              ? t('shots.yesterday')
              : d.toLocaleDateString(i18n.language, { weekday: 'long', day: 'numeric', month: 'long', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) })
        g = { key, label, items: [] }
        out.push(g)
      }
      g.items.push(e)
    }
    return out
  }, [items, i18n.language, t])

  const undo = async (e: ModHistoryItem) => {
    setMessage(null)
    setBusy(e.id)
    const r = await window.hemisphere.modHistory.undo(e.id)
    setBusy(null)
    setMessage(r.ok ? { ok: true, text: t('history.undone', { name: e.name }) } : { ok: false, text: t(`history.errors.${r.reason}`) })
    void reload()
  }

  return (
    <div className="h-full overflow-auto px-8 py-6">
      <button onClick={onBack} className="mb-3 flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-gray-400 transition-colors hover:bg-gray-700 hover:text-white">
        <ArrowLeft size={14} /> {t('browse.back')}
      </button>
      <p className="text-xs font-bold tracking-[0.08em] text-green-400 uppercase">{t('history.subtitle')}</p>
      <h1 className="text-[30px] font-bold text-white uppercase">{t('history.title')}</h1>
      <p className="mt-1 mb-4 max-w-[70ch] text-[13px] text-gray-400">{t('history.hint')}</p>

      {message && (
        <p role="status" className={`animate-fade mb-4 flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] ${message.ok ? 'bg-green-900/40 text-green-200' : 'bg-amber-900/35 text-amber-200'}`}>
          {message.ok ? <Check size={14} /> : <TriangleAlert size={14} />} {message.text}
        </p>
      )}

      {items === undefined ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-[52px] rounded-lg" />
          ))}
        </div>
      ) : items === null ? (
        <p className="flex items-center gap-2 text-gray-400">
          <CloudOff size={18} /> {t('mods.unavailable')}
        </p>
      ) : items.length === 0 ? (
        <p className="rounded-lg bg-gray-900/55 px-4 py-6 text-center text-[13px] text-gray-400">{t('history.empty')}</p>
      ) : (
        groups.map((g) => (
          <section key={g.key} className="mb-5">
            <h2 className="mb-2 text-xs font-bold tracking-[0.08em] text-gray-400 uppercase">{g.label}</h2>
            <ul className="overflow-hidden rounded-lg bg-gray-900/55">
              {g.items.map((e) => {
                const Icon = ICONS[e.kind] ?? Package
                return (
                  <li key={e.id} className="flex items-center gap-3 border-b border-white/5 px-4 py-2.5 last:border-b-0">
                    <span className="grid h-8 w-8 flex-none place-items-center rounded-full bg-gray-800 text-green-400">
                      <Icon size={15} />
                    </span>
                    <span className="min-w-0 flex-1 text-[13.5px] text-gray-200">
                      {describe(e, t)}
                      {e.type && e.type !== 'mod' && <span className="ml-2 rounded-full bg-gray-700/80 px-2 py-px text-[11px] font-semibold text-gray-300">{t(`history.types.${e.type}`)}</span>}
                    </span>
                    <span className="flex-none text-xs text-gray-500 tabular-nums">{new Date(e.at).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })}</span>
                    {e.undo && (
                      <button
                        onClick={() => undo(e)}
                        disabled={!!busy}
                        className="flex flex-none items-center gap-1.5 rounded-lg bg-gray-700/85 px-3 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-gray-600 disabled:opacity-50"
                      >
                        {busy === e.id ? <LoaderCircle size={14} className="animate-spin" /> : <Undo2 size={14} />} {t('history.undo')}
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  )
}

function describe(e: ModHistoryItem, t: (k: string, o?: Record<string, unknown>) => string): React.ReactNode {
  const v = (x: string | null) => x ?? '?'
  return t(`history.kinds.${e.kind}`, { name: e.name, from: v(e.from), to: v(e.to) })
}
