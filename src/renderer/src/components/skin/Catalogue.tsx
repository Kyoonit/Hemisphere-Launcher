import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink, Loader2, Sparkles, WifiOff, X } from 'lucide-react'
import type { ShopBundle, ShopItem } from '@shared/catalogueShop'

const chip = (on: boolean) => `rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors ${on ? 'bg-green-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white'}`
const today = () => new Date().toISOString().slice(0, 10)

/** An item tried on in the viewer above */
export interface TriedItem {
  item: ShopItem
  bundle: ShopBundle
}

/**
 * Settings > Account, between the viewer and the wardrobe: the Patreon catalogue. Clicking an item tries it on in the
 * viewer (models on the head or in a hand, skins on the player); its button opens its Patreon page. Items are given
 * to a Microsoft account Herald has checked, sealed, and opened in memory only (src/main/core/catalogue/shop.ts).
 */
export function Catalogue({ tried, onTry }: { tried: TriedItem | null; onTry(t: TriedItem | null): void }) {
  const { t } = useTranslation()
  const [items, setItems] = useState<ShopItem[] | null>(null)
  const [offline, setOffline] = useState(false)
  const [kind, setKind] = useState<'all' | 'model' | 'skin'>('all')
  const [loading, setLoading] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    void window.hemisphere.shop.list().then((r) => {
      if (r.ok) (setItems(r.value.items), setOffline(r.value.offline), r.value.blocked && setMessage(t('shop.errors.blocked')))
      else setItems([])
    })
  }, [])

  const tryOn = async (item: ShopItem) => {
    if (tried?.item.id === item.id) return onTry(null)
    setLoading(item.id)
    setMessage(null)
    const r = await window.hemisphere.shop.item(item.id)
    setLoading(null)
    if (r.ok) onTry({ item, bundle: r.value })
    // the reason too (which step, what Mojang or Herald said), to help the staff when a player reports it
    else setMessage(`${t(`shop.errors.${r.error}`)}${r.message && r.message !== r.error ? ` (${r.message})` : ''}`)
  }

  // nothing in the catalogue (or never reached): no section at all
  if (!items?.length) return null
  const shown = items.filter((i) => kind === 'all' || i.kind === kind)
  const selected = tried && items.some((i) => i.id === tried.item.id) ? tried.item : null

  return (
    <div className="mt-8">
      <h3 className="flex items-center gap-2 text-[15px] font-bold text-white">
        <Sparkles size={17} /> {t('shop.title')}
      </h3>
      <p className="mt-0.5 text-[13px] text-gray-400">{t('shop.hint')}</p>
      {offline && (
        <p className="mt-2 flex items-center gap-1.5 text-[12.5px] text-amber-400">
          <WifiOff size={14} /> {t('shop.offline')}
        </p>
      )}
      {items.some((i) => i.kind === 'skin') && items.some((i) => i.kind === 'model') && (
        <div className="mt-3 flex gap-1.5">
          {(['all', 'model', 'skin'] as const).map((k) => (
            <button key={k} onClick={() => setKind(k)} className={chip(kind === k)}>
              {t(`shop.kinds.${k}`)}
            </button>
          ))}
        </div>
      )}
      {message && <p className="mt-2 text-[13px] text-amber-400">{message}</p>}

      <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-2">
        {shown.map((item) => (
          <ItemCard key={item.id} item={item} on={selected?.id === item.id} loading={loading === item.id} disabled={!!loading} onClick={() => void tryOn(item)} />
        ))}
      </div>

      {selected && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl bg-gray-800/60 p-3 ring-1 ring-white/5">
          <div className="min-w-0 flex-1">
            <b className="block text-[14px] text-white">{selected.name}</b>
            <span className="text-[12px] text-gray-400">
              {selected.kind === 'skin' ? t('shop.skin') : t(`skins.models.slots.${selected.slot}`)}
              {selected.tier && ` · ${selected.tier}`}
            </span>
            {selected.description && <p className="mt-1 text-[13px] whitespace-pre-line text-gray-300">{selected.description}</p>}
          </div>
          <div className="flex gap-2">
            <button onClick={() => onTry(null)} className="flex items-center gap-1.5 rounded-lg bg-gray-700/85 px-3.5 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-gray-600">
              <X size={15} /> {t('shop.takeOff')}
            </button>
            <button
              onClick={() => window.hemisphere.shop.openPatreon(selected.id)}
              className="flex items-center gap-2 rounded-lg bg-[#ff424d] px-3.5 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-[#ff5a63]"
            >
              <ExternalLink size={15} /> {t('shop.patreon')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function ItemCard({ item, on, loading, disabled, onClick }: { item: ShopItem; on: boolean; loading: boolean; disabled: boolean; onClick(): void }) {
  const { t } = useTranslation()
  const [picture, setPicture] = useState<string | null>(null)
  useEffect(() => {
    if (item.thumbnail) void window.hemisphere.shop.thumbnail(item.id).then((r) => r.ok && setPicture(r.value))
  }, [item.id, item.version, item.thumbnail])
  const fresh = !!item.newUntil && item.newUntil >= today()
  return (
    <button
      onClick={onClick}
      disabled={disabled && !loading}
      title={item.name}
      className={`relative flex flex-col gap-1.5 rounded-xl p-2 text-left transition-colors ${on ? 'bg-green-600/15 ring-2 ring-green-600' : 'bg-gray-800/70 ring-1 ring-white/5 hover:bg-gray-700/70'}`}
    >
      <div className="grid aspect-square place-items-center overflow-hidden rounded-lg bg-gray-900/70">
        {picture ? <img src={picture} alt="" className="h-full w-full object-cover" /> : <Sparkles size={22} className="text-gray-600" />}
        {loading && (
          <div className="absolute inset-0 grid place-items-center rounded-xl bg-gray-900/60">
            <Loader2 size={22} className="animate-spin text-white" />
          </div>
        )}
      </div>
      {fresh && <span className="absolute top-3 left-3 rounded-full bg-green-600 px-2 py-0.5 text-[10.5px] font-bold text-white uppercase">{t('shop.new')}</span>}
      <span className="truncate px-0.5 text-[12.5px] font-semibold text-gray-100">{item.name}</span>
      <span className="-mt-1 truncate px-0.5 text-[11.5px] text-gray-400">{item.tier || (item.kind === 'skin' ? t('shop.skin') : t(`skins.models.slots.${item.slot}`))}</span>
    </button>
  )
}
