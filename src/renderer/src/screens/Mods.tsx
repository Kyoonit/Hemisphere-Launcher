import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, CloudOff, Download, FolderOpen, History, Info, Loader2, RefreshCw, Search, Trash2, TriangleAlert, Upload } from 'lucide-react'
import type { ModVersionChoice, PlayerModInfo } from '@shared/modBrowser'
import { Icon as BrowserIcon } from './ModBrowser'
import Toggle from '../components/Toggle'
import type { ClientSummary, ModSummary } from '@shared/client'
import { localize } from '@shared/manifest'

type Filter = 'all' | 'yours'
const FILTERS: Filter[] = ['all', 'yours']

/** Same palette idea as the wireframe: a stable colour per mod for its letter tile. */
const TILE = ['#2563eb', '#0d9488', '#b45309', '#7c3aed', '#16a34a', '#db2777', '#0891b2', '#ca8a04', '#dc2626', '#4f46e5']
const tileColor = (id: string) => TILE[[...id].reduce((h, c) => h + c.charCodeAt(0), 0) % TILE.length]

/** Client info; pass a changing `refreshKey` to reload it (e.g. after an update finished). */
export function useClient(refreshKey: unknown = null): ClientSummary | null | undefined {
  const [client, setClient] = useState<ClientSummary | null | undefined>(undefined)
  useEffect(() => {
    window.hemisphere.client.get().then(setClient)
  }, [refreshKey])
  return client
}

export default function Mods({ onImport, onBrowse }: { onImport(): void; onBrowse(): void }) {
  const { t, i18n } = useTranslation()
  const client = useClient()
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [enabled, setEnabled] = useState<Set<string> | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [own, setOwn] = useState<PlayerModInfo[] | null>(null)
  const reloadOwn = () => window.hemisphere.client.playerMods().then(setOwn)
  useEffect(() => {
    void reloadOwn()
  }, [])
  useEffect(() => {
    window.hemisphere.client.enabledMods().then((ids) => setEnabled(new Set(ids)))
  }, [])

  const toggle = async (mod: ModSummary, on: boolean) => {
    const res = await window.hemisphere.client.setModEnabled(mod.id, on)
    setEnabled(new Set(res.enabled))
    const names = res.alsoChanged.map((id) => client?.mods.find((m) => m.id === id)?.name ?? id).join(', ')
    setNotice(names ? t(on ? 'mods.alsoOn' : 'mods.alsoOff', { names, mod: mod.name }) : null)
  }

  // One list: Hemisphere's mods and the player's own, alphabetical; the search box looks through both.
  const items = useMemo((): ListItem[] => {
    const q = query.trim().toLowerCase()
    const hemisphere: ListItem[] =
      filter === 'yours'
        ? []
        : (client?.mods ?? [])
            .filter((m) => m.category !== 'library' && (!q || m.name.toLowerCase().includes(q)))
            .map((mod) => ({ kind: 'hemisphere', name: mod.name, mod }))
    const yours: ListItem[] = (own ?? [])
      .filter((m) => !q || (m.title ?? '').toLowerCase().includes(q) || m.file.toLowerCase().includes(q))
      .map((mod) => ({ kind: 'player', name: mod.title ?? mod.file, mod }))
    return [...hemisphere, ...yours].sort((a, b) => a.name.localeCompare(b.name, i18n.language, { sensitivity: 'base' }))
  }, [client, own, filter, query, i18n.language])
  const libraries = client?.mods.filter((m) => m.category === 'library') ?? []

  if (client === undefined || enabled === null)
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
  if (client === null)
    return (
      <div className="grid h-full place-items-center text-gray-400">
        <p className="flex items-center gap-2">
          <CloudOff size={18} /> {t('mods.unavailable')}
        </p>
      </div>
    )

  const hemisphereOn = client.mods.filter((m) => m.category !== 'library' && enabled.has(m.id)).length
  const yoursOn = own?.filter((m) => m.enabled).length ?? 0
  const toolButton =
    'flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-semibold text-gray-300 transition-colors hover:bg-gray-700 hover:text-white'

  return (
    <div className="h-full overflow-auto">
      {/* Stays at the top while scrolling: search, find, updates, import, folder, filters. */}
      <div className="sticky top-0 z-10 border-b border-white/10 bg-gray-900 px-8 pt-5 pb-3 shadow-lg">
        <div className="mb-3 flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold tracking-[0.08em] text-green-400 uppercase">
              {t('mods.subtitle', { version: client.clientVersion, minecraft: client.minecraft })}
            </p>
            <h1 className="text-[30px] leading-tight font-bold text-white">{t('nav.mods').toUpperCase()}</h1>
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
          <button
            onClick={onBrowse}
            className="flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-2 text-[13px] font-semibold text-white shadow-md transition-colors hover:bg-green-500"
          >
            <Download size={14} /> {t('browse.open')}
          </button>
          <PlayerModUpdates
            own={own}
            className={toolButton}
            onDone={(text) => {
              setNotice(text)
              void reloadOwn()
            }}
          />
          <button onClick={onImport} className={toolButton}>
            <Upload size={14} /> {t('import.settingsButton')}
          </button>
          <button onClick={() => window.hemisphere.system.openFolder('mods')} className={toolButton}>
            <FolderOpen size={14} /> {t('mods.openFolder')}
          </button>
        </div>

        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-lg px-3 py-1 text-[13px] font-medium transition-colors ${
                filter === f ? 'bg-green-600 text-white' : 'bg-gray-800/70 text-gray-300 hover:bg-gray-700 hover:text-white'
              }`}
            >
              {f === 'yours' ? `${t('mods.yours')} (${own?.length ?? 0})` : t('mods.groups.all')}
            </button>
          ))}
          <span className="ml-2 self-center text-xs text-gray-400">
            {client.source === 'cache' && <span className="mr-2 text-amber-400">{t('mods.offlineCopy')}</span>}
            {t('mods.enabledTotal', { count: hemisphereOn + yoursOn })}
            {' · '}
            {t('mods.applyNext')}
          </span>
        </div>

        {notice && (
          <div
            role="status"
            className="animate-fade mt-2.5 flex items-center gap-2 rounded-lg border-l-[3px] border-green-400 bg-gray-800/80 px-3.5 py-2 text-[13px] text-gray-200"
          >
            <Info size={15} className="text-green-400" />
            {notice}
          </div>
        )}
      </div>

      <div className="px-8 pt-3 pb-6">
        {items.length ? (
          <div className="overflow-hidden rounded-lg bg-gray-900/55">
            {items.map((item) =>
              item.kind === 'hemisphere' ? (
                <ModRow key={`h-${item.mod.id}`} mod={item.mod} lang={i18n.language} on={enabled.has(item.mod.id)} onToggle={(on) => toggle(item.mod, on)} />
              ) : (
                <PlayerModRow key={`p-${item.mod.file}`} mod={item.mod} lang={i18n.language} onChanged={() => void reloadOwn()} onNotice={setNotice} />
              ),
            )}
          </div>
        ) : (
          <p className="py-4 text-gray-400">{filter === 'yours' && !query ? t('mods.yoursEmpty') : t('mods.noMatch')}</p>
        )}
        {(filter === 'all' || filter === 'yours') && <p className="mt-2 text-xs text-gray-400">{t('mods.yoursHint')}</p>}
        <p className="mt-1.5 text-xs text-gray-400">{t('mods.libraries', { names: libraries.map((l) => l.name).join(', ') })}</p>
      </div>
    </div>
  )
}

type ListItem = { kind: 'hemisphere'; name: string; mod: ModSummary } | { kind: 'player'; name: string; mod: PlayerModInfo }

/** Modrinth icon; falls back to a letter tile when offline or the mod has no icon. */
function ModIcon({ mod }: { mod: ModSummary }) {
  const [failed, setFailed] = useState(false)
  if (mod.icon && !failed)
    return (
      <img
        src={mod.icon}
        alt=""
        loading="lazy"
        draggable={false}
        onError={() => setFailed(true)}
        className="h-[34px] w-[34px] flex-none rounded-lg bg-gray-800 object-cover"
      />
    )
  return (
    <span
      className="grid h-[34px] w-[34px] flex-none place-items-center rounded-lg text-sm font-extrabold text-white"
      style={{ background: tileColor(mod.id) }}
    >
      {(mod.name.match(/[A-Za-z0-9]/) ?? ['?'])[0].toUpperCase()}
    </span>
  )
}

function ModRow({ mod, lang, on, onToggle }: { mod: ModSummary; lang: string; on: boolean; onToggle(on: boolean): void }) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-3.5 border-t border-white/5 px-3.5 py-2.5 first:border-t-0 hover:bg-gray-700/35">
      <ModIcon mod={mod} />
      <div className="min-w-0 flex-1">
        <b className="font-semibold text-white">{mod.name}</b>
        <span className="ml-1.5 text-xs text-gray-400">{mod.version}</span>
        <p className="truncate text-[12.5px] text-gray-400">{localize(mod.description, lang)}</p>
        {mod.recommended && !on && (
          <p className="mt-0.5 flex items-center gap-1 text-xs text-amber-400">
            <TriangleAlert size={12} />{' '}
            {t(mod.category === 'voice' ? 'mods.warnVoice' : mod.category === 'performance' ? 'mods.warnRecommended' : 'mods.warnFeature')}
          </p>
        )}
      </div>
      {mod.recommended && <span className="rounded-full bg-green-600/20 px-2 py-0.5 text-[11px] font-semibold text-green-400">{t('mods.recommended')}</span>}
      <Toggle on={on} onChange={onToggle} label={mod.name} />
    </div>
  )
}

/** 0.4 MB, or 38 KB for tiny files. */
const fileSize = (bytes: number) => (bytes < 100 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`)

/** One of the player's own mods: name and icon from Modrinth, staff policy, update badge, on/off, remove. */
function PlayerModRow({ mod, lang, onChanged, onNotice }: { mod: PlayerModInfo; lang: string; onChanged(): void; onNotice(text: string): void }) {
  const { t } = useTranslation()
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [picking, setPicking] = useState(false)
  const name = mod.title ?? mod.file
  return (
    <div className="border-t border-white/5 first:border-t-0">
      <div className="flex items-center gap-3.5 px-3.5 py-2.5">
        <BrowserIcon src={mod.icon} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2">
            <b className={`truncate font-semibold ${mod.enabled ? 'text-white' : 'text-gray-500'}`} title={mod.file}>
              {name}
            </b>
            <Badge tone="gray">{t('mods.yoursTag')}</Badge>
            {mod.inHemisphere && <Badge tone="amber">{t('mods.duplicate')}</Badge>}
            {mod.verdict === 'blocked' && <Badge tone="red">{t('browse.notAllowed')}</Badge>}
            {mod.verdict === 'askStaff' && <Badge tone="amber">{t('browse.askStaff')}</Badge>}
            {mod.pinned && (
              <span title={t('mods.pinnedHint')}>
                <Badge tone="blue">{t('mods.pinned')}</Badge>
              </span>
            )}
            {mod.update && <Badge tone="green">{t('mods.updateAvailable', { version: mod.update.versionNumber })}</Badge>}
          </p>
          <p className="truncate text-xs text-gray-400">
            {mod.inHemisphere ? (
              t('mods.duplicateHint')
            ) : mod.incompatibleWith ? (
              t('mods.incompatible', { minecraft: mod.incompatibleWith })
            ) : mod.verdict !== 'allowed' && mod.reason ? (
              localize(mod.reason, lang)
            ) : (
              <>
                {mod.projectId && mod.versionNumber ? (
                  <button onClick={() => setPicking((p) => !p)} className="inline-flex items-center gap-0.5 rounded hover:text-white">
                    {mod.versionNumber}
                    <ChevronDown size={12} className={`transition-transform ${picking ? 'rotate-180' : ''}`} />
                  </button>
                ) : (
                  (mod.versionNumber ?? t('mods.notOnModrinth'))
                )}
                {' · '}
                {fileSize(mod.size)}
              </>
            )}
          </p>
        </div>
        {confirmRemove ? (
          <span className="flex items-center gap-1.5">
            <button
              onClick={async () => {
                setConfirmRemove(false)
                if (await window.hemisphere.client.removePlayerMod(mod.file)) onChanged()
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
            {mod.projectId && (
              <button
                onClick={() => setPicking((p) => !p)}
                aria-label={t('mods.versions', { mod: name })}
                title={t('mods.versions', { mod: name })}
                aria-expanded={picking}
                className={`rounded-md p-1.5 transition-colors hover:bg-gray-700 hover:text-white ${picking ? 'bg-gray-700 text-white' : 'text-gray-500'}`}
              >
                <History size={15} />
              </button>
            )}
            <button
              onClick={() => setConfirmRemove(true)}
              aria-label={t('mods.remove', { mod: name })}
              title={t('mods.remove', { mod: name })}
              className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-gray-700 hover:text-red-400"
            >
              <Trash2 size={15} />
            </button>
          </>
        )}
        <Toggle
          on={mod.enabled}
          label={name}
          disabled={mod.inHemisphere && !mod.enabled}
          title={mod.inHemisphere ? t('mods.duplicateLocked') : undefined}
          onChange={async (on) => {
            if (await window.hemisphere.client.setPlayerMod(mod.file, on)) onChanged()
          }}
        />
      </div>
      {picking && (
        <VersionPicker
          mod={mod}
          onDone={(text) => {
            setPicking(false)
            onNotice(text)
            onChanged()
          }}
        />
      )}
    </div>
  )
}

/** Every Modrinth version of the mod for this Minecraft version; picking an older one pins it. */
function VersionPicker({ mod, onDone }: { mod: PlayerModInfo; onDone(text: string): void }) {
  const { t, i18n } = useTranslation()
  const [versions, setVersions] = useState<ModVersionChoice[] | null | undefined>(undefined)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    window.hemisphere.client.playerModVersions(mod.file).then(setVersions)
  }, [mod.file])
  const name = mod.title ?? mod.file

  const choose = async (v: ModVersionChoice) => {
    setBusy(v.id)
    setError(null)
    const r = await window.hemisphere.client.setPlayerModVersion(mod.file, v.id)
    setBusy(null)
    if (r.ok)
      onDone(r.pinned ? t('mods.versionPinned', { mod: name, version: r.versionNumber }) : t('mods.versionLatest', { mod: name, version: r.versionNumber }))
    else setError(t(`mods.versionErrors.${r.reason}`))
  }

  return (
    <div className="mx-3.5 mb-3 rounded-lg border border-white/10 bg-gray-950/60 p-2">
      <p className="px-1.5 pb-1.5 text-xs text-gray-400">{t('mods.versionsHint')}</p>
      {error && <p className="px-1.5 pb-1.5 text-xs text-red-400">{error}</p>}
      {versions === undefined ? (
        <div className="space-y-1">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="skeleton h-8 rounded-md" />
          ))}
        </div>
      ) : versions === null || versions.length === 0 ? (
        <p className="px-1.5 py-1 text-[13px] text-gray-400">{versions === null ? t('mods.versionErrors.network') : t('mods.versionsNone')}</p>
      ) : (
        <ul className="max-h-[240px] overflow-y-auto pr-1">
          {versions.map((v) => (
            <li key={v.id}>
              <button
                onClick={() => choose(v)}
                disabled={busy !== null || (v.current && (v.latest ? !mod.pinned : mod.pinned))}
                className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors disabled:cursor-default ${v.current ? 'bg-green-900/30' : 'hover:bg-gray-700/60'}`}
              >
                <span className="min-w-0 flex-1 truncate font-semibold text-white">{v.versionNumber}</span>
                {v.type !== 'release' && <Badge tone="amber">{t(`mods.versionType.${v.type}`)}</Badge>}
                {v.latest && <Badge tone="green">{t('mods.latest')}</Badge>}
                {v.current && <Badge tone="gray">{t('mods.current')}</Badge>}
                <span className="w-[86px] flex-none text-right text-xs text-gray-400 tabular-nums">
                  {new Date(v.published).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
                <span className="grid w-4 flex-none place-items-center">{busy === v.id && <Loader2 size={13} className="animate-spin text-gray-300" />}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Badge({ tone, children }: { tone: 'red' | 'amber' | 'green' | 'gray' | 'blue'; children: React.ReactNode }) {
  const tones = {
    red: 'bg-red-900/50 text-red-300',
    amber: 'bg-amber-900/50 text-amber-300',
    green: 'bg-green-900/50 text-green-300',
    gray: 'bg-gray-700/80 text-gray-300',
    blue: 'bg-blue-900/50 text-blue-300',
  }
  return <span className={`flex-none rounded-full px-2 py-px text-[11px] font-semibold ${tones[tone]}`}>{children}</span>
}

/** "Check for updates" -> "Update N mods". */
function PlayerModUpdates({ own, onDone, className }: { own: PlayerModInfo[] | null; onDone(notice: string): void; className: string }) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const pending = own?.filter((m) => m.update).length ?? 0
  if (!own?.some((m) => m.projectId)) return null
  const run = async () => {
    setBusy(true)
    if (pending) {
      const r = await window.hemisphere.client.updatePlayerMods()
      onDone(r ? t('mods.updated', { count: r.updated.length }) : t('mods.updateFailed'))
    } else {
      const r = await window.hemisphere.client.checkPlayerModUpdates()
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
