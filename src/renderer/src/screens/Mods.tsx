import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CloudOff, Info, Search, TriangleAlert } from 'lucide-react'
import Toggle from '../components/Toggle'
import type { ClientSummary, ModSummary } from '@shared/client'
import { localize } from '@shared/manifest'

const GROUPS = ['performance', 'voice', 'visual', 'comfort'] as const
type Filter = 'all' | (typeof GROUPS)[number]

/** Same palette idea as the wireframe: a stable colour per mod for its letter tile. */
const TILE = ['#2563eb', '#0d9488', '#b45309', '#7c3aed', '#16a34a', '#db2777', '#0891b2', '#ca8a04', '#dc2626', '#4f46e5']
const tileColor = (id: string) => TILE[[...id].reduce((h, c) => h + c.charCodeAt(0), 0) % TILE.length]

export function useClient(): ClientSummary | null | undefined {
  const [client, setClient] = useState<ClientSummary | null | undefined>(undefined)
  useEffect(() => {
    window.hemisphere.client.get().then(setClient)
  }, [])
  return client
}

export default function Mods() {
  const { t, i18n } = useTranslation()
  const client = useClient()
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [enabled, setEnabled] = useState<Set<string> | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
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

  if (client === undefined || enabled === null) return null
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

      <p className="mt-2 text-xs text-gray-400">
        {t('mods.libraries', { names: libraries.map((l) => l.name).join(', ') })}
      </p>
    </div>
  )
}

function ModRow({ mod, lang, on, onToggle }: { mod: ModSummary; lang: string; on: boolean; onToggle(on: boolean): void }) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-3.5 border-t border-white/5 px-3.5 py-2.5 first:border-t-0 hover:bg-gray-700/35">
      <span className="grid h-[34px] w-[34px] flex-none place-items-center rounded-lg text-sm font-extrabold text-white" style={{ background: tileColor(mod.id) }}>
        {(mod.name.match(/[A-Za-z0-9]/) ?? ['?'])[0].toUpperCase()}
      </span>
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
