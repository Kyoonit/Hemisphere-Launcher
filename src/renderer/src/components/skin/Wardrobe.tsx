import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, FileUp, Loader2, Shirt, Trash2, UserPlus } from 'lucide-react'
import type { Wardrobe as WardrobeData, WardrobeResult, WardrobeSkin } from '@shared/skins'
import { CapeFlat, SkinFlat } from './SkinFlat'

const button = 'flex items-center gap-2 rounded-lg bg-gray-700/85 px-3.5 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-gray-600 disabled:opacity-50'
const chip = (on: boolean) => `rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors ${on ? 'bg-green-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white'}`

/**
 * Settings > Account, under the viewer: the skins kept on this PC, the ones the account wore, and its capes.
 * Clicking a skin previews it in the viewer above (`onPreview`); "Wear" puts it on the account.
 */
export function Wardrobe({ preview, onPreview }: { preview: WardrobeSkin | null; onPreview(skin: WardrobeSkin | null): void }) {
  const { t, i18n } = useTranslation()
  const [data, setData] = useState<WardrobeData | null>(null)
  const [tab, setTab] = useState<'library' | 'history'>('library')
  const [player, setPlayer] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [name, setName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const bar = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void window.hemisphere.skins.wardrobe().then(setData)
    // another account, or a skin worn from elsewhere: the history and capes change
    return window.hemisphere.skins.onChange(() => void window.hemisphere.skins.wardrobe().then(setData))
  }, [])
  useEffect(() => {
    setName(preview?.name ?? '')
    setConfirmDelete(false)
    // the chosen skin's actions, brought into view
    if (preview) requestAnimationFrame(() => bar.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }))
  }, [preview?.hash])

  /** runs an action; its wardrobe replaces ours, its error is shown */
  const act = async (what: string, run: () => Promise<WardrobeResult>, success?: string, after?: (r: Extract<WardrobeResult, { ok: true }>) => void) => {
    setBusy(what)
    setMessage(null)
    const r = await run()
    setBusy(null)
    if (r.ok) {
      setData(r.wardrobe)
      if (success) setMessage({ ok: true, text: success })
      after?.(r)
    } else if (r.error !== 'cancelled') setMessage({ ok: false, text: t(`wardrobe.errors.${r.error}`) })
  }
  const showAdded = (r: Extract<WardrobeResult, { ok: true }>) => {
    setTab('library')
    const s = r.wardrobe.library.find((x) => x.hash === r.added)
    if (s) onPreview(s)
  }

  if (!data) return null
  const list = tab === 'library' ? data.library : data.history
  const selected = preview && list.some((s) => s.hash === preview.hash) ? preview : null
  const date = (at: number) => new Date(at).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short', year: 'numeric' })

  return (
    <div className="mt-8">
      <h3 className="flex items-center gap-2 text-[15px] font-bold text-white">
        <Shirt size={17} /> {t('wardrobe.title')}
      </h3>
      <p className="mt-0.5 text-[13px] text-gray-400">{t('wardrobe.hint')}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button className={button} disabled={!!busy} onClick={() => act('file', () => window.hemisphere.skins.importFile(), t('wardrobe.added'), showAdded)}>
          {busy === 'file' ? <Loader2 size={15} className="animate-spin" /> : <FileUp size={15} />} {t('wardrobe.importFile')}
        </button>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (player.trim()) void act('player', () => window.hemisphere.skins.importPlayer(player.trim()), t('wardrobe.added'), (r) => (setPlayer(''), showAdded(r)))
          }}
        >
          <input
            value={player}
            onChange={(e) => setPlayer(e.target.value.replace(/[^A-Za-z0-9_]/g, '').slice(0, 16))}
            placeholder={t('wardrobe.playerPlaceholder')}
            className="w-44 rounded-lg bg-gray-800 px-3 py-2 text-[13px] text-white ring-1 ring-white/5 outline-none placeholder:text-gray-500 focus:ring-green-600"
          />
          <button type="submit" className={button} disabled={!!busy || !player.trim()}>
            {busy === 'player' ? <Loader2 size={15} className="animate-spin" /> : <UserPlus size={15} />} {t('wardrobe.importPlayer')}
          </button>
        </form>
      </div>
      {message && <p className={`mt-2 text-[13px] ${message.ok ? 'text-green-400' : 'text-amber-400'}`}>{message.text}</p>}

      <div className="mt-4 flex gap-1.5">
        {(['library', 'history'] as const).map((k) => (
          <button key={k} onClick={() => setTab(k)} className={chip(tab === k)}>
            {t(`wardrobe.tabs.${k}`, { count: (k === 'library' ? data.library : data.history).length })}
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <p className="mt-3 text-[13px] text-gray-500">{t(tab === 'library' ? 'wardrobe.emptyLibrary' : 'wardrobe.emptyHistory')}</p>
      ) : (
        <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(92px,1fr))] gap-2">
          {list.map((s) => {
            const on = selected?.hash === s.hash
            return (
              <button
                key={s.hash}
                onClick={() => onPreview(on ? null : s)}
                title={s.name || date(s.at)}
                className={`flex flex-col items-center gap-1.5 rounded-xl px-2 pt-3 pb-2 transition-colors ${on ? 'bg-green-600/15 ring-2 ring-green-600' : 'bg-gray-800/70 ring-1 ring-white/5 hover:bg-gray-700/70'}`}
              >
                <SkinFlat skin={s.skin} slim={s.slim} height={88} />
                <span className="w-full truncate text-center text-[12px] font-semibold text-gray-200">{s.name || date(s.at)}</span>
              </button>
            )
          })}
        </div>
      )}

      {selected && (
        <div ref={bar} className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-gray-800/60 p-3 ring-1 ring-white/5">
          {tab === 'library' ? (
            <input
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 32))}
              onBlur={() => name.trim() && name.trim() !== selected.name && act('edit', () => window.hemisphere.skins.edit(selected.hash, { name: name.trim() }), undefined, (r) => onPreview(r.wardrobe.library.find((x) => x.hash === selected.hash) ?? null))}
              className="w-44 rounded-lg bg-gray-900/70 px-3 py-2 text-[13px] text-white ring-1 ring-white/5 outline-none focus:ring-green-600"
            />
          ) : (
            <span className="px-1 text-[13px] text-gray-300">{t('wardrobe.wornOn', { date: date(selected.at) })}</span>
          )}
          <div className="flex gap-1">
            {([false, true] as const).map((slim) => (
              <button
                key={String(slim)}
                onClick={() =>
                  tab === 'library'
                    ? act('edit', () => window.hemisphere.skins.edit(selected.hash, { slim }), undefined, (r) => onPreview(r.wardrobe.library.find((x) => x.hash === selected.hash) ?? null))
                    : onPreview({ ...selected, slim })
                }
                className={chip(selected.slim === slim)}
              >
                {t(slim ? 'wardrobe.slim' : 'wardrobe.classic')}
              </button>
            ))}
          </div>
          <div className="ml-auto flex gap-2">
            {tab === 'history' && (
              <button className={button} disabled={!!busy} onClick={() => act('keep', () => window.hemisphere.skins.keep(selected.hash, name || t('wardrobe.keptName')), t('wardrobe.kept'))}>
                {t('wardrobe.keep')}
              </button>
            )}
            {tab === 'library' && (
              <button
                className={`${button} ${confirmDelete ? '!bg-red-600 hover:!bg-red-500' : ''}`}
                disabled={!!busy}
                onClick={() => (confirmDelete ? act('remove', () => window.hemisphere.skins.remove(selected.hash), undefined, () => onPreview(null)) : setConfirmDelete(true))}
              >
                <Trash2 size={15} /> {t(confirmDelete ? 'wardrobe.confirmRemove' : 'wardrobe.remove')}
              </button>
            )}
            <button
              className="flex items-center gap-2 rounded-lg bg-green-600 px-3.5 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-green-500 disabled:opacity-50"
              disabled={!!busy || !data.canChange}
              title={data.canChange ? undefined : t('wardrobe.cannotChange')}
              onClick={() => act('wear', () => window.hemisphere.skins.wear(selected.hash, selected.slim), t('wardrobe.worn'), () => onPreview(null))}
            >
              {busy === 'wear' ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} {t('wardrobe.wear')}
            </button>
          </div>
          {!data.canChange && <p className="w-full text-xs text-gray-500">{t('wardrobe.cannotChange')}</p>}
        </div>
      )}

      {data.canChange && (
        <div className="mt-6">
          <p className="mb-1.5 text-xs font-semibold tracking-wide text-gray-400 uppercase">{t('wardrobe.capes')}</p>
          {data.capes === null ? (
            <p className="text-[13px] text-gray-500">{t('wardrobe.capesUnavailable')}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => act('cape', () => window.hemisphere.skins.cape(null), t('wardrobe.capeChanged'))}
                disabled={!!busy}
                className={`grid h-[96px] w-[76px] place-items-center rounded-xl px-2 text-center text-[12px] font-semibold transition-colors ${data.capes.every((c) => !c.active) ? 'bg-green-600/15 text-white ring-2 ring-green-600' : 'bg-gray-800/70 text-gray-300 ring-1 ring-white/5 hover:bg-gray-700/70'}`}
              >
                {t('wardrobe.noCape')}
              </button>
              {data.capes.map((c) => (
                <button
                  key={c.id}
                  title={c.name}
                  disabled={!!busy}
                  onClick={() => !c.active && act('cape', () => window.hemisphere.skins.cape(c.id), t('wardrobe.capeChanged'))}
                  className={`flex h-[96px] w-[76px] flex-col items-center justify-center gap-1 rounded-xl px-1 transition-colors ${c.active ? 'bg-green-600/15 ring-2 ring-green-600' : 'bg-gray-800/70 ring-1 ring-white/5 hover:bg-gray-700/70'}`}
                >
                  <CapeFlat cape={c.cape} height={56} />
                  <span className="w-full truncate text-center text-[11px] font-semibold text-gray-300">{c.name}</span>
                </button>
              ))}
              {data.capes.length === 0 && <p className="self-center text-[13px] text-gray-500">{t('wardrobe.noCapes')}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
