import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CloudOff, FolderOpen, Info, RefreshCw, Search, Trash2, TriangleAlert, Upload } from 'lucide-react'
import type { PlayerModInfo } from '@shared/modBrowser'
import { Icon as BrowserIcon } from './ModBrowser'
import Toggle from '../components/Toggle'
import type { ClientSummary, ModSummary } from '@shared/client'
import { localize } from '@shared/manifest'

const GROUPS = ['performance', 'voice', 'visual', 'comfort'] as const
type Filter = 'all' | (typeof GROUPS)[number]

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

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (client?.mods ?? []).filter(
      (m) => m.category !== 'library' && (filter === 'all' || m.category === filter) && (!q || m.name.toLowerCase().includes(q)),
    )
  }, [client, filter, query])
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

  return (
    <div className="h-full overflow-auto px-8 py-6">
      <div className="mb-5 flex items-end justify-between">
        <div>
          <p className="text-xs font-bold tracking-[0.08em] text-green-400 uppercase">
            {t('mods.subtitle', { version: client.clientVersion, minecraft: client.minecraft })}
          </p>
          <h1 className="text-[30px] font-bold text-white">{t('nav.mods').toUpperCase()}</h1>
        </div>
        <button onClick={onBrowse} className="flex items-center gap-2 rounded-lg bg-green-600 px-3.5 py-2 text-sm font-semibold text-white shadow-md transition-colors hover:bg-green-500">
          <Search size={15} /> {t('browse.open')}
        </button>
      </div>
      <div className="-mt-3 mb-4 text-right">
        <span className="text-xs text-gray-400">
          {client.source === 'cache' && <span className="mr-2 text-amber-400">{t('mods.offlineCopy')}</span>}
          {t('mods.enabledCount', { on: client.mods.filter((m) => m.category !== 'library' && enabled.has(m.id)).length, total: client.mods.length - libraries.length })}
          {' · '}
          {t('mods.applyNext')}
        </span>
      </div>

      {notice && (
        <div className="animate-fade mb-4 flex items-center gap-2 rounded-lg border-l-[3px] border-green-400 bg-gray-800/80 px-3.5 py-2 text-[13px] text-gray-200">
          <Info size={15} className="text-green-400" />
          {notice}
        </div>
      )}

      <div className="mb-4 flex items-center gap-2.5">
        <label className="relative w-[260px]">
          <Search size={15} className="absolute top-1/2 left-2.5 -translate-y-1/2 text-gray-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('mods.search')}
            aria-label={t('mods.search')}
            className="w-full rounded-lg border border-gray-700 bg-gray-900 py-2 pr-3 pl-8 text-sm text-white"
          />
        </label>
        {(['all', ...GROUPS] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
              filter === f ? 'bg-green-600 text-white' : 'bg-gray-800/70 text-gray-300 hover:bg-gray-700 hover:text-white'
            }`}
          >
            {t(`mods.groups.${f}`)}
          </button>
        ))}
      </div>

      {GROUPS.filter((g) => visible.some((m) => m.category === g)).map((g) => {
        const rows = visible.filter((m) => m.category === g)
        return (
          <section key={g} className="mb-5">
            <div className="mb-1.5 flex items-center gap-2">
              <span className="text-xs font-bold tracking-[0.08em] text-gray-400 uppercase">{t(`mods.groups.${g}`)}</span>
              <span className="rounded-full bg-gray-700 px-2 text-[11px] font-semibold text-gray-300">{rows.length}</span>
            </div>
            <div className="overflow-hidden rounded-lg bg-gray-900/55">
              {rows.map((m) => (
                <ModRow key={m.id} mod={m} lang={i18n.language} on={enabled.has(m.id)} onToggle={(on) => toggle(m, on)} />
              ))}
            </div>
          </section>
        )
      })}
      {visible.length === 0 && <p className="text-gray-400">{t('mods.noMatch')}</p>}

      {filter === 'all' && !query && (
        <section className="mb-5">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="text-xs font-bold tracking-[0.08em] text-gray-400 uppercase">{t('mods.yours')}</span>
            <span className="rounded-full bg-gray-700 px-2 text-[11px] font-semibold text-gray-300">{own?.filter((m) => m.enabled).length ?? 0}</span>
            <span className="ml-auto flex gap-1.5">
              <PlayerModUpdates own={own} onDone={(text) => {
                setNotice(text)
                void reloadOwn()
              }} />
              <button onClick={onImport} className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold text-gray-300 hover:bg-gray-700 hover:text-white">
                <Upload size={13} /> {t('import.settingsButton')}
              </button>
              <button onClick={() => window.hemisphere.system.openFolder('mods')} className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold text-gray-300 hover:bg-gray-700 hover:text-white">
                <FolderOpen size={13} /> {t('mods.openFolder')}
              </button>
            </span>
          </div>
          <div className="overflow-hidden rounded-lg bg-gray-900/55">
            {own?.length ? (
              own.map((m) => <PlayerModRow key={m.file} mod={m} lang={i18n.language} onChanged={() => void reloadOwn()} />)
            ) : (
              <p className="px-3.5 py-3 text-[13px] text-gray-400">{t('mods.yoursEmpty')}</p>
            )}
          </div>
          <p className="mt-1.5 text-xs text-gray-400">{t('mods.yoursHint')}</p>
        </section>
      )}

      <p className="mt-2 text-xs text-gray-400">
        {t('mods.libraries', { names: libraries.map((l) => l.name).join(', ') })}
      </p>
    </div>
  )
}

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
    <span className="grid h-[34px] w-[34px] flex-none place-items-center rounded-lg text-sm font-extrabold text-white" style={{ background: tileColor(mod.id) }}>
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
            <TriangleAlert size={12} /> {t(mod.category === 'voice' ? 'mods.warnVoice' : mod.category === 'performance' ? 'mods.warnRecommended' : 'mods.warnFeature')}
          </p>
        )}
      </div>
      {mod.recommended && <span className="rounded-full bg-green-600/20 px-2 py-0.5 text-[11px] font-semibold text-green-400">{t('mods.recommended')}</span>}
      <Toggle on={on} onChange={onToggle} label={mod.name} />
    </div>
  )
}

/** One of the player's own mods: name and icon from Modrinth, staff policy, update badge, on/off, remove. */
function PlayerModRow({ mod, lang, onChanged }: { mod: PlayerModInfo; lang: string; onChanged(): void }) {
  const { t } = useTranslation()
  const [confirmRemove, setConfirmRemove] = useState(false)
  const name = mod.title ?? mod.file
  return (
    <div className="flex items-center gap-3.5 border-t border-white/5 px-3.5 py-2.5 first:border-t-0">
      <BrowserIcon src={mod.icon} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2">
          <b className={`truncate font-semibold ${mod.enabled ? 'text-white' : 'text-gray-500'}`} title={mod.file}>
            {name}
          </b>
          {mod.verdict === 'blocked' && <Badge tone="red">{t('browse.notAllowed')}</Badge>}
          {mod.verdict === 'askStaff' && <Badge tone="amber">{t('browse.askStaff')}</Badge>}
          {mod.update && <Badge tone="green">{t('mods.updateAvailable', { version: mod.update.versionNumber })}</Badge>}
        </p>
        <p className="truncate text-xs text-gray-400">
          {mod.incompatibleWith
            ? t('mods.incompatible', { minecraft: mod.incompatibleWith })
            : mod.verdict !== 'allowed' && mod.reason
              ? localize(mod.reason, lang)
              : [mod.versionNumber, mod.projectId ? null : t('mods.notOnModrinth'), `${(mod.size / 1024 / 1024).toFixed(1)} MB`].filter(Boolean).join(' · ')}
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
        <button
          onClick={() => setConfirmRemove(true)}
          aria-label={t('mods.remove', { mod: name })}
          title={t('mods.remove', { mod: name })}
          className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-gray-700 hover:text-red-400"
        >
          <Trash2 size={15} />
        </button>
      )}
      <Toggle
        on={mod.enabled}
        label={name}
        onChange={async (on) => {
          if (await window.hemisphere.client.setPlayerMod(mod.file, on)) onChanged()
        }}
      />
    </div>
  )
}

function Badge({ tone, children }: { tone: 'red' | 'amber' | 'green'; children: React.ReactNode }) {
  const tones = { red: 'bg-red-900/50 text-red-300', amber: 'bg-amber-900/50 text-amber-300', green: 'bg-green-900/50 text-green-300' }
  return <span className={`flex-none rounded-full px-2 py-px text-[11px] font-semibold ${tones[tone]}`}>{children}</span>
}

/** "Check for updates" -> "Update N mods". */
function PlayerModUpdates({ own, onDone }: { own: PlayerModInfo[] | null; onDone(notice: string): void }) {
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
    <button
      onClick={run}
      disabled={busy}
      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold disabled:opacity-50 ${pending ? 'bg-green-600 text-white hover:bg-green-500' : 'text-gray-300 hover:bg-gray-700 hover:text-white'}`}
    >
      <RefreshCw size={13} className={busy ? 'animate-spin' : ''} /> {pending ? t('mods.updateAll', { count: pending }) : t('mods.checkUpdates')}
    </button>
  )
}
