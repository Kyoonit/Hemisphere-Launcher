import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, FolderSearch, Info, Package, RefreshCw, TriangleAlert, Upload } from 'lucide-react'
import type { ImportOptions, ImportProgress, ImportReport, ImportSource, LauncherKind } from '@shared/importer'

const BADGE: Record<LauncherKind, { text: string; bg: string; fg?: string }> = {
  official: { text: 'MC', bg: '#3c8527' },
  modrinth: { text: 'M', bg: '#1bd96a', fg: '#111' },
  curseforge: { text: 'CF', bg: '#f16436' },
  prism: { text: 'P', bg: '#7c3aed' },
  atlauncher: { text: 'AT', bg: '#0e7490' },
  folder: { text: '', bg: '#374151' },
}

const ALL: (keyof ImportOptions)[] = ['settings', 'servers', 'resourcepacks', 'shaderpacks', 'config', 'mods']

export default function Import({ onClose }: { onClose(): void }) {
  const { t } = useTranslation()
  const [sources, setSources] = useState<ImportSource[] | null>(null)
  const [selected, setSelected] = useState<ImportSource | null>(null)
  const [opts, setOpts] = useState<ImportOptions>({ settings: true, servers: true, resourcepacks: true, shaderpacks: true, config: false, mods: true })
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [report, setReport] = useState<ImportReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)

  useEffect(() => {
    window.hemisphere.importer.detect().then((s) => {
      setSources(s)
      setSelected(s[0] ?? null)
    })
    return window.hemisphere.importer.onProgress(setProgress)
  }, [])

  const available = (src: ImportSource | null, k: keyof ImportOptions) => {
    if (!src) return false
    const h = src.has
    return { settings: h.settings, servers: h.servers, resourcepacks: h.resourcepacks > 0, shaderpacks: h.shaderpacks > 0, config: h.config, mods: h.mods > 0 }[k]
  }

  const choose = async () => {
    setError(null)
    const src = await window.hemisphere.importer.chooseFolder()
    if (src === 'nothing') setError(t('import.nothingThere'))
    else if (src) {
      setSources((s) => [src, ...(s ?? []).filter((x) => x.id !== src.id)])
      setSelected(src)
    }
  }

  const run = async () => {
    if (!selected) return
    setError(null)
    setRunning(true)
    const chosen = Object.fromEntries(ALL.map((k) => [k, opts[k] && available(selected, k)])) as unknown as ImportOptions
    const res = await window.hemisphere.importer.run(selected.id, chosen)
    setRunning(false)
    setProgress(null)
    if (res.ok) setReport(res.report)
    else setError(t(`import.errors.${res.reason}`))
  }

  return (
    <div className="grid h-full place-items-center overflow-auto p-6">
      <div className="glass animate-rise flex max-h-full w-[760px] flex-col overflow-hidden">
        <div className="overflow-auto px-8 pt-7 pb-4">
          <p className="text-xs font-bold tracking-[0.08em] text-green-400 uppercase">{t('import.label')}</p>
          <h1 className="mt-1 text-[26px] font-bold text-white">
            {t('import.titleA')} <span className="text-green-400">{t('import.titleB')}</span>
          </h1>
          <p className="mt-1.5 text-gray-400">{t('import.intro')}</p>

          {report ? (
            <Results report={report} />
          ) : running ? (
            <div className="my-8">
              <div className="mb-2 flex justify-between text-sm">
                <b className="text-white">{t(`import.steps.${progress?.step ?? 'files'}`)}</b>
                {progress?.ratio != null && <span className="text-gray-400 tabular-nums">{Math.round(progress.ratio * 100)}%</span>}
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-gray-700/90">
                {progress?.ratio == null ? (
                  <i className="block h-full w-1/3 animate-[indeterminate_1.2s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-green-600 to-green-400" />
                ) : (
                  <i className="block h-full rounded-full bg-gradient-to-r from-green-600 to-green-400 transition-[width] duration-300" style={{ width: `${progress.ratio * 100}%` }} />
                )}
              </div>
              {progress?.detail && <p className="mt-2 truncate text-xs text-gray-400">{progress.detail}</p>}
            </div>
          ) : (
            <>
              <div className="mt-4 flex flex-col gap-2" role="radiogroup" aria-label={t('import.sources')}>
                {sources === null ? (
                  <div className="skeleton h-[62px] rounded-lg" />
                ) : (
                  sources.map((s) => (
                    <SourceCard key={s.id} source={s} selected={selected?.id === s.id} onSelect={() => setSelected(s)} />
                  ))
                )}
                <button
                  onClick={choose}
                  className="flex items-center gap-3 rounded-lg border border-dashed border-gray-600 px-3.5 py-3 text-left text-gray-300 transition-colors hover:border-gray-400 hover:text-white"
                >
                  <span className="grid h-9 w-9 flex-none place-items-center rounded-lg bg-gray-700">
                    <FolderSearch size={18} />
                  </span>
                  <span>
                    <b className="block font-semibold">{t('import.chooseFolder')}</b>
                    <span className="text-xs text-gray-400">{t('import.chooseFolderHint')}</span>
                  </span>
                </button>
                {sources?.length === 0 && <p className="text-[13px] text-gray-400">{t('import.noneFound')}</p>}
              </div>

              {selected && (
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {ALL.map((k) => {
                    const ok = available(selected, k)
                    const count = k === 'mods' ? selected.has.mods : k === 'resourcepacks' ? selected.has.resourcepacks : k === 'shaderpacks' ? selected.has.shaderpacks : null
                    return (
                      <label
                        key={k}
                        className={`flex items-center gap-3 rounded-lg bg-gray-900/60 px-3 py-2.5 ${ok ? 'cursor-pointer hover:bg-gray-900/80' : 'opacity-45'}`}
                      >
                        <input
                          type="checkbox"
                          disabled={!ok}
                          checked={ok && opts[k]}
                          onChange={(e) => setOpts({ ...opts, [k]: e.target.checked })}
                          className="h-4 w-4 accent-green-600"
                        />
                        <span className="min-w-0">
                          <b className="block text-[13.5px] font-semibold text-white">
                            {t(`import.items.${k}`)}
                            {count ? <span className="ml-1.5 font-normal text-gray-400">({count})</span> : null}
                          </b>
                          <span className="text-xs text-gray-400">{t(`import.itemHints.${k}`)}</span>
                        </span>
                      </label>
                    )
                  })}
                </div>
              )}
            </>
          )}
          {error && (
            <p className="mt-4 flex items-center gap-2 text-[13px] text-red-400">
              <TriangleAlert size={15} /> {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-white/5 bg-gray-900/40 px-8 py-4">
          <span className="flex items-center gap-1.5 text-xs text-gray-400">
            <Info size={13} /> {t('import.safe')}
          </span>
          <div className="flex gap-2">
            {report ? (
              <button onClick={onClose} className="rounded-lg bg-green-600 px-5 py-2.5 font-semibold text-white shadow-md transition-colors hover:bg-green-500">
                {t('import.done')}
              </button>
            ) : (
              <>
                <button onClick={onClose} disabled={running} className="rounded-lg px-4 py-2 text-sm font-semibold text-gray-300 transition-colors hover:bg-gray-700 hover:text-white disabled:opacity-40">
                  {t('auth.cancel')}
                </button>
                <button
                  onClick={run}
                  disabled={!selected || running || !ALL.some((k) => opts[k] && available(selected, k))}
                  className="flex items-center gap-2 rounded-lg bg-green-600 px-5 py-2.5 font-semibold text-white shadow-md transition-colors hover:bg-green-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Upload size={17} /> {t('import.start')}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function SourceCard({ source, selected, onSelect }: { source: ImportSource; selected: boolean; onSelect(): void }) {
  const { t } = useTranslation()
  const b = BADGE[source.launcher]
  const bits = [source.minecraft ? `Minecraft ${source.minecraft}` : null, source.has.mods ? t('import.modCount', { count: source.has.mods }) : null].filter(Boolean)
  return (
    <button
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`flex items-center gap-3 rounded-lg border px-3.5 py-3 text-left transition-colors ${
        selected ? 'border-green-500 bg-green-600/10' : 'border-transparent bg-gray-900/60 hover:border-gray-600'
      }`}
    >
      <span className={`h-[18px] w-[18px] flex-none rounded-full border-2 ${selected ? 'border-[5px] border-green-500' : 'border-gray-600'}`} />
      <span className="grid h-9 w-9 flex-none place-items-center rounded-lg text-[13px] font-extrabold text-white" style={{ background: b.bg, color: b.fg }}>
        {b.text || <FolderSearch size={16} />}
      </span>
      <span className="min-w-0 flex-1">
        <b className="block truncate font-semibold text-white">
          {t(`import.launchers.${source.launcher}`)}
          {source.launcher !== 'official' && source.launcher !== 'folder' && <span className="font-normal text-gray-300"> · {source.name}</span>}
          {source.launcher === 'folder' && <span className="font-normal text-gray-300"> · {source.name}</span>}
        </b>
        <span className="block truncate text-xs text-gray-400" title={source.path}>
          {bits.join(' · ') || source.path}
        </span>
      </span>
    </button>
  )
}

function Results({ report }: { report: ImportReport }) {
  const { t } = useTranslation()
  const lines: { tone: 'ok' | 'warn' | 'info'; text: string }[] = []
  if (report.settings) lines.push({ tone: 'ok', text: t('import.result.settings') })
  if (report.servers) lines.push({ tone: 'ok', text: t('import.result.servers') })
  if (report.resourcepacks) lines.push({ tone: 'ok', text: t('import.result.resourcepacks', { count: report.resourcepacks }) })
  if (report.shaderpacks) lines.push({ tone: 'ok', text: t('import.result.shaderpacks', { count: report.shaderpacks }) })
  if (report.configFiles) lines.push({ tone: 'ok', text: t('import.result.config', { count: report.configFiles }) })
  if (report.modsAdded.length) lines.push({ tone: 'ok', text: t('import.result.modsAdded', { names: report.modsAdded.join(', ') }) })
  if (report.modsIncluded.length) lines.push({ tone: 'info', text: t('import.result.modsIncluded', { names: report.modsIncluded.join(', ') }) })
  if (report.modsUnavailable.length) lines.push({ tone: 'warn', text: t('import.result.modsUnavailable', { names: report.modsUnavailable.join(', ') }) })
  if (report.modsUnknown.length) lines.push({ tone: 'warn', text: t('import.result.modsUnknown', { names: report.modsUnknown.join(', ') }) })
  if (!lines.length) lines.push({ tone: 'info', text: t('import.result.nothing') })

  return (
    <div className="animate-fade my-5 flex flex-col gap-1">
      {lines.map((l, i) => (
        <div key={i} className="flex items-start gap-3 px-1 py-1.5 text-[14px] text-gray-200">
          <span
            className={`mt-px grid h-[22px] w-[22px] flex-none place-items-center rounded-full ${
              l.tone === 'ok' ? 'bg-green-600/25 text-green-400' : l.tone === 'warn' ? 'bg-amber-600/25 text-amber-400' : 'bg-gray-700 text-gray-300'
            }`}
          >
            {l.tone === 'ok' ? <Check size={13} strokeWidth={3} /> : l.tone === 'warn' ? <TriangleAlert size={12} /> : l.tone === 'info' ? <Package size={12} /> : <RefreshCw size={12} />}
          </span>
          <span className="min-w-0">{l.text}</span>
        </div>
      ))}
    </div>
  )
}
