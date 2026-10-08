import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp, ChevronDown, CloudOff, Download, Folder, FolderOpen, History, Info, Loader2, Lock, RefreshCw, Search, Sparkles, Trash2, TriangleAlert } from 'lucide-react'
import type { ModVersionChoice } from '@shared/modBrowser'
import type { PackItem, PackList, PackType } from '@shared/packs'
import { localize } from '@shared/manifest'
import Toggle from '../components/Toggle'
import { Badge, VersionRow, fileSize, tileColor } from './Mods'

type Filter = 'all' | 'disabled' | 'updates'
type Sort = 'name' | 'recent'

/**
 * The Resource packs and Shaders tabs of Content: the same tools as mods (find, versions, locks, updates, remove).
 * Resource packs: several on, in an order (the top one wins), written to Minecraft's settings. Shaders: one in use
 * (or none), written to Iris's settings.
 */
export default function Packs({ type, top, onBrowse }: { type: PackType; top: React.ReactNode; onBrowse(): void }) {
  const { t, i18n } = useTranslation()
  const [list, setList] = useState<PackList | null | undefined>(undefined)
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('name')
  const [query, setQuery] = useState('')
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  const [openPicker, setOpenPicker] = useState<string | null>(null)
  const reload = () => window.hemisphere.packs.list(type).then(setList)
  useEffect(() => {
    void reload()
  }, [type])

  const items = list?.items ?? []
  const view: Filter = (filter === 'updates' && !items.some((p) => p.update)) || (filter === 'disabled' && !items.some((p) => !p.active)) ? 'all' : filter
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items
      .filter((p) => (view === 'all' || (view === 'disabled' ? !p.active : !!p.update)) && (!q || p.name.toLowerCase().includes(q) || p.file.toLowerCase().includes(q)))
      .sort((a, b) => (sort === 'recent' ? b.addedAt - a.addedAt : 0) || a.name.localeCompare(b.name, i18n.language, { sensitivity: 'base' }))
  }, [items, view, sort, query, i18n.language])

  const busyNotice = () => setNotice({ ok: false, text: t('packs.busy') })
  const run = async (job: () => Promise<boolean>, text?: string) => {
    if (!(await job().catch(() => false))) return busyNotice()
    if (text) setNotice({ ok: true, text })
    await reload()
  }

  const toolButton = 'flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-semibold text-gray-300 transition-colors hover:bg-gray-700 hover:text-white'
  const chip = (active: boolean) =>
    `rounded-lg px-3 py-1 text-[13px] font-medium transition-colors ${active ? 'bg-green-600 text-white' : 'bg-gray-800/70 text-gray-300 hover:bg-gray-700 hover:text-white'}`

  if (list === undefined)
    return (
      <div className="h-full overflow-hidden px-8 pt-5" aria-busy="true">
        {top}
        <div className="skeleton mb-4 h-9 w-full rounded-lg" />
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="skeleton mb-2 h-[58px] rounded-lg" />
        ))}
      </div>
    )
  if (list === null)
    return (
      <div className="h-full px-8 pt-5">
        {top}
        <p className="mt-16 flex items-center justify-center gap-2 text-gray-400">
          <CloudOff size={18} /> {t('mods.unavailable')}
        </p>
      </div>
    )

  const resource = type === 'resourcepack'
  const activeCount = items.filter((p) => p.active).length
  const withUpdate = items.filter((p) => p.update).length
  const filters: [Filter, string][] = [
    ...(resource && items.length - activeCount ? [['disabled', `${t('mods.disabledFilter')} (${items.length - activeCount})`] as [Filter, string]] : []),
    ...(withUpdate ? [['updates', `${t('mods.updatesFilter')} (${withUpdate})`] as [Filter, string]] : []),
  ]
  const inUse = items.find((p) => p.active)
  // resource packs, All: the ones on first, in Minecraft's order (top wins); then the others
  const grouped = resource && view === 'all'
  const on = grouped ? shown.filter((p) => p.active).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)) : []
  const rest = grouped ? shown.filter((p) => !p.active) : shown

  const row = (p: PackItem) => (
    <PackRow
      key={p.file}
      type={type}
      pack={p}
      lang={i18n.language}
      showAdded={sort === 'recent'}
      position={grouped && p.active ? { index: on.indexOf(p), total: on.length } : null}
      picking={openPicker === p.file}
      onTogglePicker={() => setOpenPicker((f) => (f === p.file ? null : p.file))}
      onActive={(v) => run(() => window.hemisphere.packs.setActive(type, p.file, v))}
      onMove={(d) => run(() => window.hemisphere.packs.move(p.file, d))}
      onRemove={() => run(() => window.hemisphere.packs.remove(type, p.file), t('packs.removed', { name: p.name }))}
      onNotice={(text) => {
        setNotice({ ok: true, text })
        void reload()
      }}
    />
  )

  return (
    <div className="h-full overflow-auto">
      <div className="sticky top-0 z-10 border-b border-white/10 bg-gray-900 px-8 pt-5 pb-3 shadow-lg">
        {top}
        <div className="flex flex-wrap items-center gap-1.5">
          <label className="relative mr-1 w-[240px]">
            <Search size={15} className="absolute top-1/2 left-2.5 -translate-y-1/2 text-gray-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t(`packs.${type}.search`)}
              aria-label={t(`packs.${type}.search`)}
              className="w-full rounded-lg border border-gray-700 bg-gray-900 py-2 pr-3 pl-8 text-sm text-white"
            />
          </label>
          <button onClick={onBrowse} className="flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-2 text-[13px] font-semibold text-white shadow-md transition-colors hover:bg-green-500">
            <Download size={14} /> {t(`packs.${type}.find`)}
          </button>
          <PackUpdatesButton
            type={type}
            items={items}
            className={toolButton}
            onDone={(text) => {
              setNotice({ ok: true, text })
              void reload()
            }}
          />
          <button onClick={() => window.hemisphere.system.openFolder(resource ? 'resourcepacks' : 'shaderpacks')} className={toolButton}>
            <FolderOpen size={14} /> {t('mods.openFolder')}
          </button>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <button onClick={() => setFilter('all')} aria-pressed={view === 'all'} className={chip(view === 'all')}>
            {t('mods.groups.all')}
          </button>
          {filters.map(([f, label]) => (
            <button key={f} onClick={() => setFilter(view === f ? 'all' : f)} aria-pressed={view === f} className={chip(view === f)}>
              {label}
            </button>
          ))}
          <span aria-hidden="true" className="mx-2.5 h-5 w-px bg-white/20" />
          {(['name', 'recent'] as Sort[]).map((s) => (
            <button
              key={s}
              onClick={() => setSort(s)}
              aria-pressed={sort === s}
              className={`rounded-lg px-3 py-1 text-[13px] font-medium transition-colors ${sort === s ? 'bg-green-900/50 text-green-300 ring-1 ring-green-500/70' : 'bg-gray-800/70 text-gray-300 hover:bg-gray-700 hover:text-white'}`}
            >
              {s === 'name' ? t('mods.byName') : t('mods.lastAdded')}
            </button>
          ))}
          <span className="ml-2 self-center text-xs text-gray-400">
            {resource ? t('packs.activeTotal', { count: activeCount }) : inUse ? t('packs.shaderInUse', { name: inUse.name }) : t('packs.shadersOff')}
            {' · '}
            {t('packs.applyNext')}
          </span>
        </div>

        {notice && (
          <div
            role="status"
            className={`animate-fade mt-2.5 flex items-center gap-2 rounded-lg border-l-[3px] bg-gray-800/80 px-3.5 py-2 text-[13px] text-gray-200 ${notice.ok ? 'border-green-400' : 'border-amber-400'}`}
          >
            {notice.ok ? <Info size={15} className="text-green-400" /> : <TriangleAlert size={15} className="text-amber-400" />}
            {notice.text}
          </div>
        )}
      </div>

      <div className="px-8 pt-3 pb-6">
        {type === 'shader' && !list.irisReady && (
          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border-l-[3px] border-amber-400 bg-amber-900/30 px-3.5 py-2.5 text-[13px] text-amber-100">
            <Sparkles size={15} className="flex-none text-amber-300" />
            <span className="min-w-0 flex-1">{t('packs.needsIris')}</span>
            <button
              onClick={async () => {
                await window.hemisphere.client.setModEnabled('iris', true)
                setNotice({ ok: true, text: t('packs.irisOn') })
                void reload()
              }}
              className="flex-none rounded-md bg-amber-400 px-3 py-1 text-xs font-bold text-gray-900 hover:bg-amber-300"
            >
              {t('packs.turnOnIris')}
            </button>
          </div>
        )}

        {items.length === 0 ? (
          <div className="grid place-items-center rounded-lg bg-gray-900/55 px-6 py-12 text-center">
            <b className="text-white">{t(`packs.${type}.emptyTitle`)}</b>
            <p className="mt-1 max-w-[52ch] text-[13px] text-gray-400">{t(`packs.${type}.emptyBody`)}</p>
            <button onClick={onBrowse} className="mt-3 flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-2 text-[13px] font-semibold text-white hover:bg-green-500">
              <Download size={14} /> {t(`packs.${type}.find`)}
            </button>
          </div>
        ) : shown.length === 0 ? (
          <p className="py-4 text-gray-400">{t('mods.noMatch')}</p>
        ) : grouped ? (
          <>
            {on.length > 0 && (
              <>
                <h2 className="mb-1.5 text-xs font-bold tracking-[0.08em] text-gray-400 uppercase">{t('packs.onTitle')}</h2>
                <div className="mb-4 overflow-hidden rounded-lg bg-gray-900/55">{on.map(row)}</div>
              </>
            )}
            {rest.length > 0 && (
              <>
                <h2 className="mb-1.5 text-xs font-bold tracking-[0.08em] text-gray-400 uppercase">{t('packs.offTitle')}</h2>
                <div className="overflow-hidden rounded-lg bg-gray-900/55">{rest.map(row)}</div>
              </>
            )}
          </>
        ) : (
          <div className="overflow-hidden rounded-lg bg-gray-900/55">{shown.map(row)}</div>
        )}
        <p className="mt-2 text-xs text-gray-400">{t(`packs.${type}.hint`)}</p>
      </div>
    </div>
  )
}

function PackIcon({ pack }: { pack: PackItem }) {
  const [failed, setFailed] = useState(false)
  if (pack.icon && !failed)
    return <img src={pack.icon} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} className="h-[38px] w-[38px] flex-none rounded-lg bg-gray-800 object-cover [image-rendering:pixelated]" />
  return (
    <span className="grid h-[38px] w-[38px] flex-none place-items-center rounded-lg text-sm font-extrabold text-white" style={{ background: tileColor(pack.file) }}>
      {pack.folder ? <Folder size={16} /> : (pack.name.match(/[A-Za-z0-9]/) ?? ['?'])[0].toUpperCase()}
    </span>
  )
}

function PackRow({
  type,
  pack,
  lang,
  showAdded,
  position,
  picking,
  onTogglePicker,
  onActive,
  onMove,
  onRemove,
  onNotice,
}: {
  type: PackType
  pack: PackItem
  lang: string
  showAdded: boolean
  position: { index: number; total: number } | null
  picking: boolean
  onTogglePicker(): void
  onActive(on: boolean): void
  onMove(delta: -1 | 1): void
  onRemove(): void
  onNotice(text: string): void
}) {
  const { t } = useTranslation()
  const [confirmRemove, setConfirmRemove] = useState(false)
  const status = pack.verdict !== 'allowed' && pack.reason ? localize(pack.reason, lang) : null
  const iconButton = 'rounded-md p-1.5 text-gray-500 transition-colors hover:bg-gray-700 hover:text-white disabled:pointer-events-none disabled:opacity-25'

  return (
    <div className="border-t border-white/5 first:border-t-0">
      <div className="flex items-center gap-3.5 px-3.5 py-2.5 hover:bg-gray-700/25">
        {position && <span className="w-5 flex-none text-center text-xs font-bold text-green-400 tabular-nums">{position.index + 1}</span>}
        <PackIcon pack={pack} />
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-center gap-2">
            <b className={`truncate font-semibold ${pack.active ? 'text-white' : 'text-gray-400'}`} title={pack.file}>
              {pack.name}
            </b>
            {pack.versionNumber && pack.projectId ? (
              <button onClick={onTogglePicker} className="inline-flex flex-none items-center gap-0.5 rounded text-xs text-gray-400 hover:text-white">
                {pack.versionNumber}
                <ChevronDown size={12} className={`transition-transform ${picking ? 'rotate-180' : ''}`} />
              </button>
            ) : (
              <span className="flex-none text-xs text-gray-500">{pack.folder ? t('packs.folder') : t('mods.notOnModrinth')}</span>
            )}
            {type === 'shader' && pack.active && <Badge tone="green">{t('packs.inUse')}</Badge>}
            {pack.locked && (
              <span title={t('mods.lockedHint')} className="flex-none">
                <Badge tone="blue">
                  <Lock size={10} className="mr-1 inline -translate-y-px" />
                  {t('mods.locked')}
                </Badge>
              </span>
            )}
            {pack.incompatible && (
              <span title={t('packs.incompatibleHint')} className="flex-none">
                <Badge tone="amber">{t('packs.incompatible')}</Badge>
              </span>
            )}
            {pack.verdict === 'blocked' && <Badge tone="red">{t('browse.notAllowed')}</Badge>}
            {pack.verdict === 'askStaff' && <Badge tone="amber">{t('browse.askStaff')}</Badge>}
            {pack.update && (
              <span title={pack.locked ? t('mods.updateLockedHint') : undefined} className="flex-none">
                <Badge tone={pack.locked ? 'gray' : 'green'}>{t('mods.updateAvailable', { version: pack.update.versionNumber })}</Badge>
              </span>
            )}
          </p>
          <p className="truncate text-xs text-gray-400">
            {status ??
              [
                showAdded && pack.addedAt ? t('mods.addedOn', { date: new Date(pack.addedAt).toLocaleDateString(lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) }) : null,
                pack.description,
                pack.size ? fileSize(pack.size) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
          </p>
        </div>
        {confirmRemove ? (
          <span className="flex items-center gap-1.5">
            <button
              onClick={() => {
                setConfirmRemove(false)
                onRemove()
              }}
              className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-red-500"
            >
              {t('mods.removeConfirm')}
            </button>
            <button onClick={() => setConfirmRemove(false)} className="rounded-md px-2 py-1 text-xs text-gray-400 hover:bg-gray-700 hover:text-white">
              {t('browse.cancel')}
            </button>
          </span>
        ) : (
          <>
            {position && (
              <>
                <button onClick={() => onMove(-1)} disabled={position.index === 0} aria-label={t('packs.moveUp', { name: pack.name })} title={t('packs.moveUp', { name: pack.name })} className={iconButton}>
                  <ArrowUp size={15} />
                </button>
                <button
                  onClick={() => onMove(1)}
                  disabled={position.index === position.total - 1}
                  aria-label={t('packs.moveDown', { name: pack.name })}
                  title={t('packs.moveDown', { name: pack.name })}
                  className={iconButton}
                >
                  <ArrowDown size={15} />
                </button>
              </>
            )}
            {/* same width with or without versions, so the buttons line up from row to row */}
            {!pack.projectId && <span aria-hidden="true" className="w-[27px] flex-none" />}
            {pack.projectId && (
              <button
                onClick={onTogglePicker}
                aria-label={t('mods.versions', { mod: pack.name })}
                title={t('mods.versions', { mod: pack.name })}
                aria-expanded={picking}
                className={`rounded-md p-1.5 transition-colors hover:bg-gray-700 hover:text-white ${picking ? 'bg-gray-700 text-white' : 'text-gray-500'}`}
              >
                <History size={15} />
              </button>
            )}
            <button onClick={() => setConfirmRemove(true)} aria-label={t('mods.remove', { mod: pack.name })} title={t('mods.remove', { mod: pack.name })} className={`${iconButton} hover:!text-red-400`}>
              <Trash2 size={15} />
            </button>
          </>
        )}
        <Toggle on={pack.active} label={pack.name} title={type === 'shader' ? t('packs.useHint') : undefined} onChange={onActive} />
      </div>
      {picking && <PackVersionPicker type={type} pack={pack} onDone={onNotice} />}
    </div>
  )
}

/** Every Modrinth version of the pack for this Minecraft version. Click = switch to it; lock = keep it through updates. */
function PackVersionPicker({ type, pack, onDone }: { type: PackType; pack: PackItem; onDone(text: string): void }) {
  const { t, i18n } = useTranslation()
  const [versions, setVersions] = useState<ModVersionChoice[] | null | undefined>(undefined)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = () => window.hemisphere.packs.versions(type, pack.file).then(setVersions)
  useEffect(() => {
    void load()
  }, [pack.file, pack.locked, pack.versionNumber])

  const choose = async (v: ModVersionChoice, lock: boolean) => {
    if (pack.locked && !v.current) return setError(t('mods.unlockFirst', { mod: pack.name }))
    setBusy(v.id)
    setError(null)
    let text: string | null = null
    if (v.current) {
      if (await window.hemisphere.packs.setLock(type, pack.file, lock)) text = lock ? t('mods.lockedNow', { mod: pack.name, version: v.versionNumber }) : t('mods.unlocked', { mod: pack.name })
      else setError(t('packs.busy'))
    } else {
      const r = await window.hemisphere.packs.setVersion(type, pack.file, v.id, lock)
      if (r.ok) text = t(lock ? 'mods.versionLocked' : 'mods.versionSet', { mod: pack.name, version: r.versionNumber })
      else setError(r.reason === 'locked' ? t('mods.unlockFirst', { mod: pack.name }) : r.reason === 'busy' ? t('packs.busy') : t('mods.versionErrors.network'))
    }
    setBusy(null)
    if (text) {
      onDone(text)
      void load()
    }
  }

  return (
    <div className="mx-3.5 mb-3 rounded-lg border border-white/10 bg-gray-950/60 p-2">
      <p className="px-1.5 pb-1.5 text-xs text-gray-400">{t('mods.versionsHint')}</p>
      {error && (
        <p role="alert" className="mb-1.5 flex items-center gap-1.5 rounded-md bg-amber-900/40 px-2 py-1.5 text-xs text-amber-200">
          <Lock size={12} /> {error}
        </p>
      )}
      {versions === undefined ? (
        <div className="space-y-1">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="skeleton h-8 rounded-md" />
          ))}
        </div>
      ) : !versions?.length ? (
        <p className="px-1.5 py-1 text-[13px] text-gray-400">{versions === null ? t('mods.versionErrors.network') : t('mods.versionsNone')}</p>
      ) : (
        <ul className="max-h-[260px] overflow-y-auto pr-1">
          {versions.map((v) => (
            <VersionRow key={v.id} v={v} busy={busy} lang={i18n.language} onPick={() => choose(v, false)} onLock={() => choose(v, !v.locked)} />
          ))}
        </ul>
      )}
    </div>
  )
}

/** "Check for updates" -> "Update N packs" (locked ones are never updated). */
function PackUpdatesButton({ type, items, onDone, className }: { type: PackType; items: PackItem[]; onDone(text: string): void; className: string }) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const pending = items.filter((p) => p.update && !p.locked).length
  const run = async () => {
    setBusy(true)
    if (pending) {
      const r = await window.hemisphere.packs.updateAll(type).catch(() => null)
      onDone(r ? t('packs.updated', { count: r.updated.length }) : t('packs.busy'))
    } else {
      const r = await window.hemisphere.packs.checkUpdates(type).catch(() => null)
      onDone(r ? (r.updates ? t('packs.updatesFound', { count: r.updates }) : t('mods.upToDate')) : t('mods.updateFailed'))
    }
    setBusy(false)
  }
  return (
    <button onClick={run} disabled={busy} className={`${className} disabled:opacity-50 ${pending ? '!bg-green-600 !text-white hover:!bg-green-500' : ''}`}>
      {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} {pending ? t('packs.updateAll', { count: pending }) : t('mods.checkUpdates')}
    </button>
  )
}
