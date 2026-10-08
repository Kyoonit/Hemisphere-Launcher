import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Ban, Check, CloudOff, Download, Loader2, Package, Search, ShieldAlert, TriangleAlert } from 'lucide-react'
import type { InstallResult, ModSearchHit, ModSearchResult } from '@shared/modBrowser'
import { localize } from '@shared/manifest'

/** Find mods: Modrinth search limited to Fabric + Hemisphere's Minecraft version, with the staff policy applied. */
export default function ModBrowser({ onBack }: { onBack(): void }) {
  const { t, i18n } = useTranslation()
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<ModSearchResult | null | undefined>(undefined)
  const [loadingMore, setLoadingMore] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<ModSearchHit | null>(null)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  const searchId = useRef(0)

  // Debounced search; results of an older query never overwrite a newer one.
  useEffect(() => {
    const id = ++searchId.current
    setResult(undefined)
    const timer = setTimeout(async () => {
      const r = await window.hemisphere.client.search(query, 0)
      if (id === searchId.current) setResult(r)
    }, 350)
    return () => clearTimeout(timer)
  }, [query])

  const loadMore = async () => {
    if (!result) return
    setLoadingMore(true)
    const more = await window.hemisphere.client.search(query, result.offset + result.hits.length)
    setLoadingMore(false)
    if (more) setResult({ ...more, hits: [...result.hits, ...more.hits], offset: result.offset })
  }

  const install = async (hit: ModSearchHit, confirmed = false) => {
    setConfirm(null)
    setBusy(hit.projectId)
    setNotice(null)
    const res: InstallResult = await window.hemisphere.client.install(hit.projectId, confirmed)
    setBusy(null)
    if (!res.ok && res.reason === 'needsConfirm') return setConfirm(hit)
    if (res.ok) {
      const extra = res.installed.filter((n) => n !== hit.title)
      setNotice({ ok: true, text: extra.length ? t('browse.installedWith', { mod: hit.title, deps: extra.join(', ') }) : t('browse.installed', { mod: hit.title }) })
      setResult((r) => r && { ...r, hits: r.hits.map((h) => (h.projectId === hit.projectId ? { ...h, state: 'installed' } : h)) })
    } else setNotice({ ok: false, text: t(`browse.errors.${res.reason}`, { mod: hit.title }) })
  }

  return (
    <div className="h-full overflow-auto px-8 py-6">
      <button onClick={onBack} className="mb-3 flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-gray-400 transition-colors hover:bg-gray-700 hover:text-white">
        <ArrowLeft size={14} /> {t('browse.back')}
      </button>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold tracking-[0.08em] text-green-400 uppercase">{t('browse.subtitle', { minecraft: result?.minecraft ?? '…' })}</p>
          <h1 className="text-[30px] font-bold text-white uppercase">{t('browse.title')}</h1>
        </div>
        <label className="relative w-[320px] max-w-full">
          <Search size={15} className="absolute top-1/2 left-2.5 -translate-y-1/2 text-gray-400" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('browse.search')}
            aria-label={t('browse.search')}
            className="w-full rounded-lg border border-gray-700 bg-gray-900 py-2 pr-3 pl-8 text-sm text-white"
          />
        </label>
      </div>

      <p className="mb-4 flex items-start gap-2 rounded-lg bg-gray-900/55 px-3.5 py-2.5 text-[12.5px] text-gray-400">
        <ShieldAlert size={15} className="mt-0.5 flex-none text-green-400" />
        {t('browse.rules')}
      </p>

      {notice && (
        <div
          role="status"
          className={`animate-fade mb-4 flex items-center gap-2 rounded-lg border-l-[3px] px-3.5 py-2 text-[13px] ${notice.ok ? 'border-green-400 bg-gray-800/80 text-gray-200' : 'border-red-400 bg-red-900/35 text-red-200'}`}
        >
          {notice.ok ? <Check size={15} className="text-green-400" /> : <TriangleAlert size={15} className="text-red-400" />}
          {notice.text}
        </div>
      )}

      {confirm && (
        <div role="alertdialog" className="animate-fade mb-4 rounded-lg border-l-[3px] border-amber-400 bg-amber-900/40 px-4 py-3 text-[13px] text-amber-100">
          <b className="block text-white">{t('browse.askStaffTitle', { mod: confirm.title })}</b>
          {confirm.reason && <span className="block">{localize(confirm.reason, i18n.language)}</span>}
          <div className="mt-2.5 flex gap-2">
            <button onClick={() => install(confirm, true)} className="rounded-md bg-amber-400 px-3 py-1 text-xs font-bold text-gray-900 hover:bg-amber-300">
              {t('browse.installAnyway')}
            </button>
            <button onClick={() => setConfirm(null)} className="rounded-md px-3 py-1 text-xs font-semibold text-amber-100 hover:bg-amber-900/60">
              {t('browse.cancel')}
            </button>
          </div>
        </div>
      )}

      {result === undefined ? (
        <div aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="skeleton mb-2 h-[74px] rounded-lg" />
          ))}
        </div>
      ) : result === null ? (
        <p className="flex items-center gap-2 py-6 text-gray-400">
          <CloudOff size={18} /> {t('browse.offline')}
        </p>
      ) : result.hits.length === 0 ? (
        <p className="py-6 text-gray-400">{t('browse.noResults')}</p>
      ) : (
        <>
          <div className="overflow-hidden rounded-lg bg-gray-900/55">
            {result.hits.map((hit) => (
              <HitRow key={hit.projectId} hit={hit} busy={busy === hit.projectId} disabled={busy !== null} lang={i18n.language} onInstall={() => install(hit)} />
            ))}
          </div>
          {result.offset + result.hits.length < result.total && (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="mx-auto mt-3 flex items-center gap-2 rounded-lg bg-gray-700/85 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-gray-600 disabled:opacity-50"
            >
              {loadingMore && <Loader2 size={15} className="animate-spin" />} {t('browse.more')}
            </button>
          )}
          <p className="mt-3 text-center text-xs text-gray-500">{t('browse.source')}</p>
        </>
      )}
    </div>
  )
}

function HitRow({ hit, busy, disabled, lang, onInstall }: { hit: ModSearchHit; busy: boolean; disabled: boolean; lang: string; onInstall(): void }) {
  const { t, i18n } = useTranslation()
  const downloads = new Intl.NumberFormat(i18n.language, { notation: 'compact' }).format(hit.downloads)
  return (
    <div className="flex items-center gap-3.5 border-t border-white/5 px-3.5 py-3 first:border-t-0">
      <Icon src={hit.icon} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 truncate">
          <b className="truncate font-semibold text-white">{hit.title}</b>
          <span className="flex-none text-xs text-gray-500">
            {t('browse.by', { author: hit.author })} · {t('browse.downloads', { count: downloads })}
          </span>
        </p>
        <p className="truncate text-[12.5px] text-gray-400">{hit.description}</p>
        {hit.verdict !== 'allowed' && hit.reason && (
          <p className={`mt-0.5 truncate text-xs ${hit.verdict === 'blocked' ? 'text-red-400' : 'text-amber-400'}`} title={localize(hit.reason, lang)}>
            {localize(hit.reason, lang)}
          </p>
        )}
      </div>
      <Action hit={hit} busy={busy} disabled={disabled} onInstall={onInstall} />
    </div>
  )
}

function Action({ hit, busy, disabled, onInstall }: { hit: ModSearchHit; busy: boolean; disabled: boolean; onInstall(): void }) {
  const { t } = useTranslation()
  const pill = 'flex flex-none items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold'
  if (hit.state === 'inHemisphere')
    return (
      <span className={`${pill} bg-gray-800 text-gray-400`}>
        <Package size={14} /> {t('browse.inHemisphere')}
      </span>
    )
  if (hit.state === 'installed')
    return (
      <span className={`${pill} bg-green-900/40 text-green-400`}>
        <Check size={14} /> {t('browse.installedState')}
      </span>
    )
  if (hit.verdict === 'blocked')
    return (
      <span className={`${pill} bg-red-900/40 text-red-400`}>
        <Ban size={14} /> {t('browse.notAllowed')}
      </span>
    )
  return (
    <button
      onClick={onInstall}
      disabled={disabled}
      className={`${pill} transition-colors disabled:opacity-50 ${hit.verdict === 'askStaff' ? 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/30' : 'bg-green-600 text-white hover:bg-green-500'}`}
    >
      {busy ? <Loader2 size={14} className="animate-spin" /> : hit.verdict === 'askStaff' ? <TriangleAlert size={14} /> : <Download size={14} />}
      {hit.verdict === 'askStaff' ? t('browse.askStaff') : t('browse.install')}
    </button>
  )
}

export function Icon({ src }: { src: string }) {
  const [failed, setFailed] = useState(false)
  if (src && !failed)
    return <img src={src} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} className="h-[40px] w-[40px] flex-none rounded-lg bg-gray-800 object-cover" />
  return (
    <span className="grid h-[40px] w-[40px] flex-none place-items-center rounded-lg bg-gray-700 text-gray-300">
      <Package size={18} />
    </span>
  )
}
