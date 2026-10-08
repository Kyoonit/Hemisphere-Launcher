import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, CloudOff, Download, FolderOpen, History, Info, Loader2, Lock, LockOpen, RefreshCw, RotateCcw, Search, Trash2, TriangleAlert, Upload } from 'lucide-react'
import ModSetsMenu from '../components/ModSetsMenu'
import type { ModItem, ModVersionChoice } from '@shared/modBrowser'
import Toggle from '../components/Toggle'
import type { ClientSummary } from '@shared/client'
import { localize } from '@shared/manifest'

type Filter = 'all' | 'yours' | 'updates' | 'disabled'
type Sort = 'name' | 'recent'

/** Same palette idea as the wireframe: a stable colour per mod for its letter tile. */
const TILE = ['#2563eb', '#0d9488', '#b45309', '#7c3aed', '#16a34a', '#db2777', '#0891b2', '#ca8a04', '#dc2626', '#4f46e5']
const tileColor = (id: string) => TILE[[...id].reduce((h, c) => h + c.charCodeAt(0), 0) % TILE.length]

/** 0.4 MB, or 38 KB for tiny files. */
const fileSize = (bytes: number) => (bytes < 100 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`)

/** Client info; pass a changing `refreshKey` to reload it (e.g. after an update finished). */
export function useClient(refreshKey: unknown = null): ClientSummary | null | undefined {
  const [client, setClient] = useState<ClientSummary | null | undefined>(undefined)
  useEffect(() => {
    window.hemisphere.client.get().then(setClient)
  }, [refreshKey])
  return client
}

/**
 * Every mod in one list, Hemisphere's and the player's, with the same tools for all: on/off, version picker with locks,
 * updates, remove. Changing a Hemisphere mod takes it over (it stops following Hemisphere's updates) until the player
 * goes back to Hemisphere's version.
 */
export default function Mods({ onImport, onBrowse, onHistory }: { onImport(): void; onBrowse(): void; onHistory(): void }) {
  const { t, i18n } = useTranslation()
  const client = useClient()
  // which mods (All or one filter) and in which order: they combine, e.g. "Added by you" by "Last added"
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('name')
  const [query, setQuery] = useState('')
  // "undo": the restore point taken just before "Update all"
  const [notice, setNotice] = useState<{ text: string; undo?: string } | null>(null)
  const [undoing, setUndoing] = useState(false)
  const [mods, setMods] = useState<ModItem[] | null | undefined>(undefined)
  // which version panel is open, by Modrinth project: it stays open while the mod changes version or is taken over
  const [openPicker, setOpenPicker] = useState<string | null>(null)
  const reload = () => window.hemisphere.client.list().then(setMods)
  useEffect(() => {
    void reload()
  }, [])

  // nothing left to update: the Updates view falls back to All
  const view: Filter =
    (filter === 'updates' && !mods?.some((m) => m.update)) || (filter === 'disabled' && !mods?.some((m) => !m.enabled)) ? 'all' : filter
  const items = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (mods ?? [])
      .filter((m) => (view === 'all' || (view === 'yours' ? !m.fromHemisphere : view === 'disabled' ? !m.enabled : !!m.update)) && (!q || m.name.toLowerCase().includes(q) || (m.file ?? '').toLowerCase().includes(q)))
      // Last added: newest install first (mods not installed yet go last); otherwise alphabetical
      .sort((a, b) => (sort === 'recent' ? b.addedAt - a.addedAt : 0) || a.name.localeCompare(b.name, i18n.language, { sensitivity: 'base' }))
  }, [mods, view, sort, query, i18n.language])
  const libraries = client?.mods.filter((m) => m.category === 'library') ?? []

  if (client === undefined || mods === undefined)
    return (
      <div className="h-full overflow-hidden px-8 py-6" aria-busy="true">
        <div className="skeleton mb-2 h-3 w-48 rounded" />
        <div className="skeleton mb-6 h-8 w-32 rounded" />
        <div className="skeleton mb-4 h-9 w-full rounded-lg" />
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="skeleton mb-2 h-[58px] rounded-lg" />
        ))}
      </div>
    )
  if (client === null || mods === null)
    return (
      <div className="grid h-full place-items-center text-gray-400">
        <p className="flex items-center gap-2">
          <CloudOff size={18} /> {t('mods.unavailable')}
        </p>
      </div>
    )

  // "Updates" only appears when something can be updated (locked mods included: they're shown, never updated)
  const withUpdate = mods.filter((m) => m.update).length
  const disabledCount = mods.filter((m) => !m.enabled).length
  // after the line: Added by you, Disabled, Updates (the last two only when there's something to show)
  const filters: [Filter, string][] = [
    ['yours', `${t('mods.yours')} (${mods.filter((m) => !m.fromHemisphere).length})`],
    ...(disabledCount ? [['disabled', `${t('mods.disabledFilter')} (${disabledCount})`] as [Filter, string]] : []),
    ...(withUpdate ? [['updates', `${t('mods.updatesFilter')} (${withUpdate})`] as [Filter, string]] : []),
  ]
  const sorts: [Sort, string][] = [
    ['name', t('mods.byName')],
    ['recent', t('mods.lastAdded')],
  ]
  const chip = (active: boolean) =>
    `rounded-lg px-3 py-1 text-[13px] font-medium transition-colors ${active ? 'bg-green-600 text-white' : 'bg-gray-800/70 text-gray-300 hover:bg-gray-700 hover:text-white'}`
  const toolButton = 'flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-semibold text-gray-300 transition-colors hover:bg-gray-700 hover:text-white'

  return (
    <div className="h-full overflow-auto">
      {/* Stays at the top while scrolling: search, find, updates, import, folder, filters. */}
      <div className="sticky top-0 z-10 border-b border-white/10 bg-gray-900 px-8 pt-5 pb-3 shadow-lg">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold tracking-[0.08em] text-green-400 uppercase">{t('mods.subtitle', { version: client.clientVersion, minecraft: client.minecraft })}</p>
            <h1 className="text-[30px] leading-tight font-bold text-white">{t('nav.mods').toUpperCase()}</h1>
          </div>
          {/* top right, under the window buttons: sets, history, import */}
          <div className="flex flex-none items-center gap-1.5">
            <ModSetsMenu
              className={toolButton}
              onSwitched={() => {
                setNotice(null)
                void reload()
              }}
            />
            <button onClick={onHistory} className={toolButton}>
              <History size={14} /> {t('history.title')}
            </button>
            <button onClick={onImport} className={toolButton}>
              <Upload size={14} /> {t('import.settingsButton')}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <label className="relative mr-1 w-[240px]">
            <Search size={15} className="absolute top-1/2 left-2.5 -translate-y-1/2 text-gray-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('mods.search')}
              aria-label={t('mods.search')}
              className="w-full rounded-lg border border-gray-700 bg-gray-900 py-2 pr-3 pl-8 text-sm text-white"
            />
          </label>
          <button onClick={onBrowse} className="flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-2 text-[13px] font-semibold text-white shadow-md transition-colors hover:bg-green-500">
            <Download size={14} /> {t('browse.open')}
          </button>
          <UpdatesButton
            mods={mods}
            className={toolButton}
            onDone={(text, undo) => {
              setNotice({ text, undo })
              void reload()
            }}
          />
          <button onClick={() => window.hemisphere.system.openFolder('mods')} className={toolButton}>
            <FolderOpen size={14} /> {t('mods.openFolder')}
          </button>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <button onClick={() => setFilter('all')} aria-pressed={view === 'all'} className={chip(view === 'all')}>
            {t('mods.groups.all')}
          </button>
          {/* the order: a quieter highlight, it combines with All or a filter */}
          {sorts.map(([s, label]) => (
            <button
              key={s}
              onClick={() => setSort(s)}
              aria-pressed={sort === s}
              className={`rounded-lg px-3 py-1 text-[13px] font-medium transition-colors ${sort === s ? 'bg-green-900/50 text-green-300 ring-1 ring-green-500/70' : 'bg-gray-800/70 text-gray-300 hover:bg-gray-700 hover:text-white'}`}
            >
              {label}
            </button>
          ))}
          <span aria-hidden="true" className="mx-2.5 h-5 w-px bg-white/20" />
          {filters.map(([f, label]) => (
            <button key={f} onClick={() => setFilter(view === f ? 'all' : f)} aria-pressed={view === f} className={chip(view === f)}>
              {label}
            </button>
          ))}
          <span className="ml-2 self-center text-xs text-gray-400">
            {client.source === 'cache' && <span className="mr-2 text-amber-400">{t('mods.offlineCopy')}</span>}
            {t('mods.enabledTotal', { count: mods.filter((m) => m.enabled).length })}
            {' · '}
            {t('mods.applyNext')}
          </span>
        </div>

        {notice && (
          <div role="status" className="animate-fade mt-2.5 flex items-center gap-2 rounded-lg border-l-[3px] border-green-400 bg-gray-800/80 px-3.5 py-2 text-[13px] text-gray-200">
            <Info size={15} className="text-green-400" />
            {notice.text}
            {notice.undo && (
              <button
                disabled={undoing}
                onClick={async () => {
                  setUndoing(true)
                  const r = await window.hemisphere.backups.restore(notice.undo!)
                  setUndoing(false)
                  setNotice({ text: r.ok ? t('mods.undone') : t(`backups.errors.${r.reason}`) })
                  void reload()
                }}
                className="ml-1 font-semibold text-green-400 underline-offset-2 hover:text-green-300 hover:underline disabled:opacity-50"
              >
                {undoing ? t('backups.restoring') : t('mods.undo')}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="px-8 pt-3 pb-6">
        {items.length ? (
          <div className="overflow-hidden rounded-lg bg-gray-900/55">
            {items.map((item) => (
              <ModRow
                key={item.key}
                item={item}
                lang={i18n.language}
                showAdded={sort === 'recent'}
                picking={openPicker === (item.projectId ?? item.key)}
                onTogglePicker={() => setOpenPicker((p) => (p === (item.projectId ?? item.key) ? null : (item.projectId ?? item.key)))}
                onChanged={() => void reload()}
                onNotice={(text) => setNotice({ text })}
              />
            ))}
          </div>
        ) : (
          <p className="py-4 text-gray-400">{view === 'yours' && !query ? t('mods.yoursEmpty') : t('mods.noMatch')}</p>
        )}
        <p className="mt-2 text-xs text-gray-400">{t('mods.yoursHint')}</p>
        <p className="mt-1.5 text-xs text-gray-400">{t('mods.libraries', { names: libraries.map((l) => l.name).join(', ') })}</p>
      </div>
    </div>
  )
}

/** Modrinth icon; falls back to a letter tile when offline or the mod has no icon. */
function ModIcon({ item }: { item: ModItem }) {
  const [failed, setFailed] = useState(false)
  if (item.icon && !failed)
    return <img src={item.icon} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} className="h-[38px] w-[38px] flex-none rounded-lg bg-gray-800 object-cover" />
  return (
    <span className="grid h-[38px] w-[38px] flex-none place-items-center rounded-lg text-sm font-extrabold text-white" style={{ background: tileColor(item.key) }}>
      {(item.name.match(/[A-Za-z0-9]/) ?? ['?'])[0].toUpperCase()}
    </span>
  )
}

function ModRow({
  item,
  lang,
  showAdded,
  picking,
  onTogglePicker,
  onChanged,
  onNotice,
}: {
  item: ModItem
  lang: string
  showAdded: boolean
  picking: boolean
  onTogglePicker(): void
  onChanged(): void
  onNotice(text: string): void
}) {
  const { t } = useTranslation()
  const [confirmRemove, setConfirmRemove] = useState(false)

  const toggle = async (on: boolean) => {
    if (item.managed) {
      const id = item.key.slice(2)
      const res = await window.hemisphere.client.setModEnabled(id, on)
      if (res.alsoChanged.length) onNotice(t(on ? 'mods.alsoOn' : 'mods.alsoOff', { names: res.alsoChanged.join(', '), mod: item.name }))
      onChanged()
    } else if (item.file && (await window.hemisphere.client.setPlayerMod(item.file, on))) onChanged()
  }

  const status = item.duplicate
    ? t('mods.duplicateHint')
    : item.incompatibleWith
      ? t('mods.incompatible', { minecraft: item.incompatibleWith })
      : item.verdict !== 'allowed' && item.reason
        ? localize(item.reason, lang)
        : null

  return (
    <div className="border-t border-white/5 first:border-t-0">
      <div className="flex items-center gap-3.5 px-3.5 py-2.5 hover:bg-gray-700/25">
        <ModIcon item={item} />
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-center gap-2">
            <b className={`truncate font-semibold ${item.enabled ? 'text-white' : 'text-gray-500'}`} title={item.file ?? undefined}>
              {item.name}
            </b>
            {item.versionNumber && item.projectId ? (
              <button onClick={onTogglePicker} className="inline-flex flex-none items-center gap-0.5 rounded text-xs text-gray-400 hover:text-white">
                {item.versionNumber}
                <ChevronDown size={12} className={`transition-transform ${picking ? 'rotate-180' : ''}`} />
              </button>
            ) : (
              <span className="flex-none text-xs text-gray-400">{item.versionNumber ?? t('mods.notOnModrinth')}</span>
            )}
            {!item.fromHemisphere && <Badge tone="gray">{t('mods.yoursTag')}</Badge>}
            {item.recommended && <Badge tone="green">{t('mods.recommended')}</Badge>}
            {item.locked && (
              <span title={t('mods.lockedHint')} className="flex-none">
                <Badge tone="blue">
                  <Lock size={10} className="mr-1 inline -translate-y-px" />
                  {t('mods.locked')}
                </Badge>
              </span>
            )}
            {item.duplicate && <Badge tone="amber">{t('mods.duplicate')}</Badge>}
            {item.verdict === 'blocked' && <Badge tone="red">{t('browse.notAllowed')}</Badge>}
            {item.verdict === 'askStaff' && <Badge tone="amber">{t('browse.askStaff')}</Badge>}
            {item.update && (
              <span title={item.locked ? t('mods.updateLockedHint') : undefined} className="flex-none">
                <Badge tone={item.locked ? 'gray' : 'green'}>{t('mods.updateAvailable', { version: item.update.versionNumber })}</Badge>
              </span>
            )}
          </p>
          <p className="truncate text-xs text-gray-400">
            {status ??
              [
                showAdded
                  ? item.addedAt
                    ? t('mods.addedOn', { date: new Date(item.addedAt).toLocaleDateString(lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) })
                    : t('mods.notInstalledYet')
                  : null,
                item.description ? localize(item.description, lang) : null, item.fromHemisphere && !item.managed ? t('mods.takenOver') : null, fileSize(item.size)]
                .filter(Boolean)
                .join(' · ')}
          </p>
          {item.managed && item.recommended && !item.enabled && (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-amber-400">
              <TriangleAlert size={12} /> {t(item.category === 'voice' ? 'mods.warnVoice' : item.category === 'performance' ? 'mods.warnRecommended' : 'mods.warnFeature')}
            </p>
          )}
        </div>
        {confirmRemove ? (
          <span className="flex items-center gap-1.5">
            <button
              onClick={async () => {
                setConfirmRemove(false)
                if (await window.hemisphere.client.remove(item.key)) {
                  onNotice(t('mods.removed', { mod: item.name }))
                  onChanged()
                }
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
            {item.projectId && (
              <button
                onClick={onTogglePicker}
                aria-label={t('mods.versions', { mod: item.name })}
                title={t('mods.versions', { mod: item.name })}
                aria-expanded={picking}
                className={`rounded-md p-1.5 transition-colors hover:bg-gray-700 hover:text-white ${picking ? 'bg-gray-700 text-white' : 'text-gray-500'}`}
              >
                <History size={15} />
              </button>
            )}
            <button
              onClick={() => setConfirmRemove(true)}
              aria-label={t('mods.remove', { mod: item.name })}
              title={t('mods.remove', { mod: item.name })}
              className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-gray-700 hover:text-red-400"
            >
              <Trash2 size={15} />
            </button>
          </>
        )}
        <Toggle
          on={item.enabled}
          label={item.name}
          disabled={item.duplicate && !item.enabled}
          title={item.duplicate ? t('mods.duplicateLocked') : undefined}
          onChange={(on) => void toggle(on)}
        />
      </div>
      {picking && (
        <VersionPicker
          item={item}
          onDone={(text) => {
            onNotice(text)
            onChanged()
          }}
        />
      )}
    </div>
  )
}

/** Every Modrinth version of the mod for this Minecraft version. Click = switch to it; lock = keep it through updates. */
function VersionPicker({ item, onDone }: { item: ModItem; onDone(text: string): void }) {
  const { t, i18n } = useTranslation()
  const [versions, setVersions] = useState<ModVersionChoice[] | null | undefined>(undefined)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = () => window.hemisphere.client.versions(item.key).then(setVersions)
  useEffect(() => {
    void load()
  }, [item.key, item.locked, item.versionNumber])

  const run = async (id: string, job: () => Promise<string | null>) => {
    setBusy(id)
    setError(null)
    const text = await job()
    setBusy(null)
    if (text) {
      onDone(text) // the panel stays open: it refreshes with the new version / lock
      void load()
    }
  }
  /** A locked mod keeps its version: switching (or going back to Hemisphere's) needs an unlock first. */
  const lockedOut = () => {
    setError(t('mods.unlockFirst', { mod: item.name }))
    return null
  }
  const choose = (v: ModVersionChoice, lock: boolean) =>
    run(v.id, async () => {
      if (item.locked && !v.current) return lockedOut()
      if (v.current) {
        // the version stays: only the lock changes
        if (!(await window.hemisphere.client.setLock(item.key, lock))) return setError(t('mods.versionErrors.busy')), null
        return lock ? t('mods.lockedNow', { mod: item.name, version: v.versionNumber }) : t('mods.unlocked', { mod: item.name })
      }
      const r = await window.hemisphere.client.setVersion(item.key, v.id, lock)
      if (!r.ok) return r.reason === 'locked' ? lockedOut() : (setError(t(`mods.versionErrors.${r.reason}`)), null)
      return t(lock ? 'mods.versionLocked' : 'mods.versionSet', { mod: item.name, version: r.versionNumber })
    })
  const back = () =>
    run('back', async () => {
      if (item.locked) return lockedOut()
      if (!(await window.hemisphere.client.backToHemisphere(item.key))) return setError(t('mods.versionErrors.busy')), null
      return t('mods.backDone', { mod: item.name, version: item.hemisphereVersion })
    })

  return (
    <div className="mx-3.5 mb-3 rounded-lg border border-white/10 bg-gray-950/60 p-2">
      <p className="px-1.5 pb-1.5 text-xs text-gray-400">
        {t('mods.versionsHint')} {item.managed && t('mods.takeOverHint')}
      </p>
      {item.fromHemisphere && !item.managed && item.hemisphereVersion && (
        <button
          onClick={back}
          disabled={busy !== null}
          className="mb-1.5 flex w-full items-center gap-2 rounded-md bg-green-900/25 px-2 py-1.5 text-left text-[13px] font-semibold text-green-300 transition-colors hover:bg-green-900/45 disabled:opacity-50"
        >
          <RotateCcw size={14} /> {t('mods.backToHemisphere', { version: item.hemisphereVersion })}
          {busy === 'back' && <Loader2 size={13} className="ml-auto animate-spin" />}
        </button>
      )}
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
      ) : versions === null || versions.length === 0 ? (
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

/** A version line: click to switch to it; the lock next to the date switches to it AND locks it (or unlocks). */
export function VersionRow({ v, busy, lang, onPick, onLock }: { v: ModVersionChoice; busy: string | null; lang: string; onPick(): void; onLock?: () => void }) {
  const { t } = useTranslation()
  return (
    <li className={`flex items-center gap-1 rounded-md ${v.current ? 'bg-green-900/30' : 'hover:bg-gray-700/60'}`}>
      <button onClick={onPick} disabled={busy !== null || v.current} className="flex min-w-0 flex-1 items-center gap-2.5 px-2 py-1.5 text-left text-[13px] disabled:cursor-default">
        <span className="min-w-0 flex-1 truncate font-semibold text-white">{v.versionNumber}</span>
        {v.type !== 'release' && <Badge tone="amber">{t(`mods.versionType.${v.type}`)}</Badge>}
        {v.latest && <Badge tone="green">{t('mods.latest')}</Badge>}
        {v.current && <Badge tone="gray">{t('mods.current')}</Badge>}
        <span className="w-[86px] flex-none text-right text-xs text-gray-400 tabular-nums">
          {new Date(v.published).toLocaleDateString(lang, { day: 'numeric', month: 'short', year: 'numeric' })}
        </span>
        <span className="grid w-4 flex-none place-items-center">{busy === v.id && <Loader2 size={13} className="animate-spin text-gray-300" />}</span>
      </button>
      {onLock && (
        <button
          onClick={onLock}
          disabled={busy !== null}
          aria-label={v.locked ? t('mods.unlockVersion', { version: v.versionNumber }) : t('mods.lockVersion', { version: v.versionNumber })}
          title={v.locked ? t('mods.unlockVersion', { version: v.versionNumber }) : t('mods.lockVersion', { version: v.versionNumber })}
          className={`mr-1 rounded-md p-1.5 transition-colors disabled:opacity-50 ${v.locked ? 'bg-blue-900/60 text-blue-300 hover:bg-blue-900' : 'text-gray-500 hover:bg-gray-700 hover:text-white'}`}
        >
          {v.locked ? <Lock size={14} /> : <LockOpen size={14} />}
        </button>
      )}
    </li>
  )
}

export function Badge({ tone, children }: { tone: 'red' | 'amber' | 'green' | 'gray' | 'blue'; children: React.ReactNode }) {
  const tones = {
    red: 'bg-red-900/50 text-red-300',
    amber: 'bg-amber-900/50 text-amber-300',
    green: 'bg-green-900/50 text-green-300',
    gray: 'bg-gray-700/80 text-gray-300',
    blue: 'bg-blue-900/50 text-blue-300',
  }
  return <span className={`flex-none rounded-full px-2 py-px text-[11px] font-semibold ${tones[tone]}`}>{children}</span>
}

/** "Check for updates" -> "Update N mods" (locked mods are never updated). */
function UpdatesButton({ mods, onDone, className }: { mods: ModItem[]; onDone(notice: string, undo?: string): void; className: string }) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const pending = mods.filter((m) => m.update && !m.locked).length
  const run = async () => {
    setBusy(true)
    if (pending) {
      const r = await window.hemisphere.client.updateAll()
      onDone(r ? t('mods.updated', { count: r.updated.length }) : t('mods.updateFailed'), (r?.updated.length && r.restorePoint) || undefined)
    } else {
      const r = await window.hemisphere.client.checkUpdates()
      onDone(r ? (r.updates ? t('mods.updatesFound', { count: r.updates }) : t('mods.upToDate')) : t('mods.updateFailed'))
    }
    setBusy(false)
  }
  return (
    <button onClick={run} disabled={busy} className={`${className} disabled:opacity-50 ${pending ? '!bg-green-600 !text-white hover:!bg-green-500' : ''}`}>
      <RefreshCw size={14} className={busy ? 'animate-spin' : ''} /> {pending ? t('mods.updateAll', { count: pending }) : t('mods.checkUpdates')}
    </button>
  )
}
