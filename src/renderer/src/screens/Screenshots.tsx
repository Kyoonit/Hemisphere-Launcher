import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Camera, Check, ChevronLeft, ChevronRight, ClipboardCopy, FolderOpen, Trash2, X } from 'lucide-react'
import { screenshotUrl, type Screenshot, type ScreenshotList } from '@shared/screenshots'

/** Minecraft screenshots (F2), newest first, grouped by day; viewer with copy / show in folder / delete. */
export default function Screenshots() {
  const { t, i18n } = useTranslation()
  const [list, setList] = useState<ScreenshotList | null>(null)
  const [open, setOpen] = useState<number | null>(null)
  const reload = useCallback(() => window.hemisphere.screenshots.list().then(setList), [])
  useEffect(() => {
    void reload()
    // new screenshots taken while the launcher was in the background show up when the player comes back
    window.addEventListener('focus', reload)
    return () => window.removeEventListener('focus', reload)
  }, [reload])

  const shots = list?.screenshots ?? []
  const groups = useMemo(() => groupByDay(shots, i18n.language, t), [shots, i18n.language, t])

  if (!list)
    return (
      <div className="h-full overflow-hidden px-8 py-6" aria-busy="true">
        <div className="skeleton mb-2 h-3 w-40 rounded" />
        <div className="skeleton mb-6 h-8 w-56 rounded" />
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="skeleton aspect-video rounded-lg" />
          ))}
        </div>
      </div>
    )

  return (
    <div className="relative h-full">
      <div className="h-full overflow-auto px-8 py-6">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-bold tracking-[0.08em] text-green-400 uppercase">{t('shots.subtitle')}</p>
            <h1 className="text-[30px] font-bold text-white uppercase">{t('nav.screenshots')}</h1>
          </div>
          <div className="flex items-center gap-3">
            {shots.length > 0 && (
              <span className="text-xs text-gray-400 tabular-nums">
                {t('shots.count', { count: shots.length })} · {formatBytes(list.totalBytes, i18n.language)}
              </span>
            )}
            <button
              onClick={() => window.hemisphere.system.openFolder('screenshots')}
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-semibold text-gray-300 transition-colors hover:bg-gray-700 hover:text-white"
            >
              <FolderOpen size={14} /> {t('mods.openFolder')}
            </button>
          </div>
        </div>

        {shots.length === 0 ? (
          <div className="grid place-items-center rounded-lg bg-gray-900/55 px-6 py-16 text-center">
            <span className="mb-3 grid h-14 w-14 place-items-center rounded-full bg-gray-800 text-gray-400">
              <Camera size={26} />
            </span>
            <b className="text-white">{t('shots.emptyTitle')}</b>
            <p className="mt-1 max-w-[46ch] text-[13px] text-gray-400">{t('shots.emptyBody')}</p>
          </div>
        ) : (
          groups.map((g) => (
            <section key={g.key} className="mb-6">
              <h2 className="mb-2 flex items-baseline gap-2 text-xs font-bold tracking-[0.08em] text-gray-400 uppercase">
                {g.label}
                <span className="font-semibold tracking-normal text-gray-500 normal-case">{t('shots.count', { count: g.items.length })}</span>
              </h2>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
                {g.items.map((s) => (
                  <button
                    key={s.name}
                    onClick={() => setOpen(shots.indexOf(s))}
                    aria-label={t('shots.open', { time: timeOf(s, i18n.language) })}
                    className="group relative aspect-video overflow-hidden rounded-lg bg-gray-800 ring-green-400/70 transition-transform duration-150 hover:scale-[1.02] focus-visible:ring-2"
                  >
                    <img src={screenshotUrl('thumb', s)} alt="" loading="lazy" draggable={false} className="h-full w-full object-cover" />
                    <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-2.5 pt-6 pb-1.5 text-left text-xs font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                      {timeOf(s, i18n.language)}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ))
        )}
      </div>

      {open !== null && shots[open] && (
        <Viewer
          shots={shots}
          index={open}
          onIndex={setOpen}
          onClose={() => setOpen(null)}
          onDeleted={async () => {
            const next = await window.hemisphere.screenshots.list()
            setList(next)
            if (!next.screenshots.length) setOpen(null)
            else setOpen(Math.min(open, next.screenshots.length - 1))
          }}
        />
      )}
    </div>
  )
}

function Viewer({ shots, index, onIndex, onClose, onDeleted }: { shots: Screenshot[]; index: number; onIndex(i: number): void; onClose(): void; onDeleted(): void }) {
  const { t, i18n } = useTranslation()
  const shot = shots[index]
  const [copied, setCopied] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const prev = () => index > 0 && onIndex(index - 1)
  const next = () => index < shots.length - 1 && onIndex(index + 1)

  useEffect(() => {
    setCopied(false)
    setConfirmDelete(false)
    setError(null)
  }, [shot.name])
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') prev()
      else if (e.key === 'ArrowRight') next()
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  })

  const copy = async () => {
    setError(null)
    if (await window.hemisphere.screenshots.copy(shot.name)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } else setError(t('shots.copyFailed'))
  }
  const remove = async () => {
    setConfirmDelete(false)
    if (await window.hemisphere.screenshots.remove(shot.name)) onDeleted()
    else setError(t('shots.deleteFailed'))
  }
  const action = 'flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-semibold transition-colors'

  return (
    <div role="dialog" aria-modal="true" aria-label={t('shots.viewer')} className="animate-fade absolute inset-0 z-30 flex flex-col bg-gray-950/95">
      <div className="flex flex-wrap items-center gap-2 px-5 py-3">
        <div className="mr-auto min-w-0">
          <b className="block truncate text-white">{dateTimeOf(shot, i18n.language)}</b>
          <span className="text-xs text-gray-400 tabular-nums">
            {index + 1} / {shots.length} · {formatBytes(shot.size, i18n.language)}
          </span>
        </div>
        <button onClick={copy} className={`${action} bg-green-600 text-white shadow-md hover:bg-green-500`}>
          {copied ? <Check size={15} /> : <ClipboardCopy size={15} />} {copied ? t('shots.copied') : t('shots.copy')}
        </button>
        <button onClick={() => window.hemisphere.screenshots.showInFolder(shot.name)} className={`${action} text-gray-300 hover:bg-gray-700 hover:text-white`}>
          <FolderOpen size={15} /> {t('shots.showInFolder')}
        </button>
        {confirmDelete ? (
          <span className="flex items-center gap-1.5">
            <button onClick={remove} className={`${action} bg-red-600 text-white hover:bg-red-500`}>
              <Trash2 size={15} /> {t('mods.removeConfirm')}
            </button>
            <button onClick={() => setConfirmDelete(false)} className={`${action} text-gray-400 hover:bg-gray-700 hover:text-white`}>
              {t('browse.cancel')}
            </button>
          </span>
        ) : (
          <button onClick={() => setConfirmDelete(true)} className={`${action} text-gray-300 hover:bg-gray-700 hover:text-red-400`}>
            <Trash2 size={15} /> {t('shots.delete')}
          </button>
        )}
        <button onClick={onClose} aria-label={t('shots.close')} title={t('shots.close')} className="ml-1 rounded-lg p-2 text-gray-300 transition-colors hover:bg-gray-700 hover:text-white">
          <X size={18} />
        </button>
      </div>
      {error && <p className="mx-5 mb-2 rounded-lg bg-red-900/40 px-3 py-2 text-[13px] text-red-200">{error}</p>}

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-14 pb-5">
        <img key={shot.name} src={screenshotUrl('full', shot)} alt={dateTimeOf(shot, i18n.language)} draggable={false} className="animate-fade max-h-full max-w-full rounded-md object-contain shadow-2xl" />
        <NavButton side="left" disabled={index === 0} onClick={prev} label={t('shots.previous')}>
          <ChevronLeft size={24} />
        </NavButton>
        <NavButton side="right" disabled={index === shots.length - 1} onClick={next} label={t('shots.next')}>
          <ChevronRight size={24} />
        </NavButton>
      </div>
    </div>
  )
}

function NavButton({ side, disabled, onClick, label, children }: { side: 'left' | 'right'; disabled: boolean; onClick(): void; label: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`absolute top-1/2 ${side === 'left' ? 'left-3' : 'right-3'} grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-gray-800/80 text-white transition-colors hover:bg-gray-700 disabled:pointer-events-none disabled:opacity-0`}
    >
      {children}
    </button>
  )
}

const timeOf = (s: Screenshot, lang: string) => new Date(s.takenAt).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })
const dateTimeOf = (s: Screenshot, lang: string) =>
  new Date(s.takenAt).toLocaleString(lang, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })

function formatBytes(bytes: number, lang: string): string {
  const units = lang.startsWith('fr') ? ['o', 'Ko', 'Mo', 'Go'] : ['B', 'KB', 'MB', 'GB']
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${new Intl.NumberFormat(lang, { maximumFractionDigits: v < 10 && i > 0 ? 1 : 0 }).format(v)} ${units[i]}`
}

/** Today / Yesterday / "Tuesday 6 October" (with the year when it isn't this year). */
function groupByDay(shots: Screenshot[], lang: string, t: (k: string) => string) {
  const dayKey = (ms: number) => {
    const d = new Date(ms)
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
  }
  const now = Date.now()
  const today = dayKey(now)
  const yesterday = dayKey(now - 86_400_000)
  const groups: { key: string; label: string; items: Screenshot[] }[] = []
  for (const s of shots) {
    const key = dayKey(s.takenAt)
    let g = groups.find((x) => x.key === key)
    if (!g) {
      const d = new Date(s.takenAt)
      const label =
        key === today
          ? t('shots.today')
          : key === yesterday
            ? t('shots.yesterday')
            : d.toLocaleDateString(lang, { weekday: 'long', day: 'numeric', month: 'long', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) })
      g = { key, label, items: [] }
      groups.push(g)
    }
    g.items.push(s)
  }
  return groups
}

