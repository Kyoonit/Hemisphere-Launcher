import { useEffect, useRef, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Box, RefreshCw } from 'lucide-react'
import { SKIN_ANIMATIONS, SkinView, type BackItem, type SkinAnimation, type WornModel } from './SkinView'
import { takeSkinViewerRequest, useActiveSkin } from './activeSkin'
import { ModelTester } from './ModelTester'
import type { SkinInfo, WardrobeSkin } from '@shared/skins'
import { Wardrobe } from './Wardrobe'

const GAP = 10
const BUTTON = 30
const TALLEST = 240
const SMALLEST = 96
/** width of the still picture for its height */
const WIDE = 0.64

/**
 * Where Home's skin goes: centred between PLAY and the bottom of the page, as tall as it can be (up to TALLEST)
 * without covering anything (footer buttons, news, side cards); hidden when there's no room at all.
 */
function skinSpot(page: HTMLElement, below: HTMLElement, own: HTMLElement | null): { top: number; height: number } | null {
  const box = page.getBoundingClientRect()
  const top = below.getBoundingClientRect().bottom - box.top + GAP
  const mid = box.width / 2
  const others: DOMRect[] = []
  for (const el of Array.from(page.children)) {
    if (el === own || el.contains(below)) continue
    for (const c of el.tagName === 'FOOTER' ? Array.from(el.children) : [el]) {
      const r = c.getBoundingClientRect()
      if (r.width && r.height) others.push(new DOMRect(r.left - box.left, r.top - box.top, r.width, r.height))
    }
  }
  for (let h = TALLEST; h >= SMALLEST; h -= 4) {
    const half = (h * WIDE) / 2 + GAP
    let bottom = box.height - GAP
    for (const r of others) {
      if (r.right <= mid - half || r.left >= mid + half || r.bottom <= top) continue
      bottom = Math.min(bottom, r.top - GAP)
    }
    const room = bottom - top
    if (room >= h + BUTTON) return { top: top + (room - h - BUTTON) / 2, height: h }
  }
  return null
}

/** Home, under PLAY: the active account's skin, still; its button opens the 3D viewer (Settings > Account). */
export function HomeSkin({ page, below, onOpen }: { page: RefObject<HTMLElement | null>; below: RefObject<HTMLElement | null>; onOpen(): void }) {
  const { t } = useTranslation()
  const { skin } = useActiveSkin()
  const own = useRef<HTMLDivElement>(null)
  const [spot, setSpot] = useState<{ top: number; height: number } | null>(null)
  useEffect(() => {
    const p = page.current
    const b = below.current
    if (!p || !b) return
    const place = () =>
      setSpot((was) => {
        const now = skinSpot(p, b, own.current)
        return was && now && was.height === now.height && Math.abs(was.top - now.top) < 1 ? was : now
      })
    place()
    // anything that moves or resizes: the window, the notices under PLAY, the news card, the entrance animations
    const watch = new ResizeObserver(place)
    watch.observe(p)
    watch.observe(b)
    for (const el of Array.from(p.querySelectorAll('footer > *, :scope > *'))) watch.observe(el)
    p.addEventListener('animationend', place)
    return () => {
      watch.disconnect()
      p.removeEventListener('animationend', place)
    }
  }, [page, below, skin])
  return (
    <div ref={own} className="pointer-events-none absolute left-1/2 -translate-x-1/2" style={{ top: spot?.top ?? 0 }}>
      {skin && spot && (
        <div className="animate-fade group pointer-events-auto relative flex flex-col items-center">
          <SkinView skin={skin} width={Math.round(spot.height * WIDE)} height={spot.height} dragTurn className="drop-shadow-[0_6px_14px_rgba(0,0,0,0.55)]" />
          <button
            onClick={onOpen}
            title={t('skins.open')}
            className="-mt-1 flex items-center gap-1.5 rounded-full bg-gray-800/80 px-2.5 py-1 text-[11.5px] font-semibold text-gray-300 backdrop-blur-md transition-colors hover:bg-gray-700 hover:text-white"
          >
            <Box size={12} /> {t('skins.view3d')}
          </button>
        </div>
      )}
    </div>
  )
}

const KEEP = 'skin-viewer'
const saved = (): { animation: SkinAnimation; outer: boolean; back: BackItem; rotate: boolean } => {
  try {
    return { animation: 'idle', outer: true, back: 'cape', rotate: false, ...JSON.parse(localStorage.getItem(KEEP) ?? '{}') }
  } catch {
    return { animation: 'idle', outer: true, back: 'cape', rotate: false }
  }
}

/** Settings > Account: the active account's skin in 3D, turned with the mouse, with its animation and layers. */
export function SkinViewerSection() {
  const { t } = useTranslation()
  const { skin: own, refresh } = useActiveSkin()
  const [opts, setOpts] = useState(saved)
  // a wardrobe skin tried on in the viewer (with the account's cape), not worn yet
  const [preview, setPreview] = useState<WardrobeSkin | null>(null)
  const [worn, setWorn] = useState<WornModel[]>([])
  const skin: SkinInfo | null = own && preview ? { ...own, skin: preview.skin, slim: preview.slim, fallback: false } : own
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    try {
      localStorage.setItem(KEEP, JSON.stringify(opts))
    } catch {
      /* not kept */
    }
  }, [opts])
  // opened from Home's button: brought into view
  useEffect(() => {
    if (takeSkinViewerRequest()) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [])
  const set = (patch: Partial<typeof opts>) => setOpts((o) => ({ ...o, ...patch }))

  return (
    <div ref={ref} className="mt-8">
      <h3 className="text-[15px] font-bold text-white">{t('skins.title')}</h3>
      <p className="mt-0.5 text-[13px] text-gray-400">{own?.fallback ? t('skins.defaultHint') : t('skins.hint')}</p>
      <div className="mt-3 flex items-stretch gap-5">
        <div className={`relative grid h-[340px] w-[260px] flex-none cursor-grab place-items-center rounded-xl bg-gradient-to-b from-gray-800/70 to-gray-900/70 active:cursor-grabbing ${preview ? 'ring-2 ring-green-600' : 'ring-1 ring-white/5'}`}>
          {preview && (
            <div className="absolute inset-x-2 top-2 z-10 flex items-center justify-between gap-2 rounded-lg bg-gray-900/85 px-2.5 py-1.5 text-[12px] backdrop-blur-md">
              <span className="truncate font-semibold text-green-400">{t('wardrobe.previewing')}</span>
              <button onClick={() => setPreview(null)} className="flex-none font-semibold text-gray-300 hover:text-white">
                {t('wardrobe.backToMine')}
              </button>
            </div>
          )}
          {skin ? <SkinView skin={skin} width={260} height={340} interactive animation={opts.animation} outerLayer={opts.outer} back={opts.back} autoRotate={opts.rotate} worn={worn} /> : <div className="skeleton h-[300px] w-[200px] rounded-lg" />}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-4 text-sm">
          <div>
            <p className="mb-1.5 text-xs font-semibold tracking-wide text-gray-400 uppercase">{t('skins.animation')}</p>
            <div className="flex flex-wrap gap-1.5">
              {SKIN_ANIMATIONS.map((a) => (
                <button
                  key={a}
                  onClick={() => set({ animation: a })}
                  className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors ${opts.animation === a ? 'bg-green-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white'}`}
                >
                  {t(`skins.animations.${a}`)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-xs font-semibold tracking-wide text-gray-400 uppercase">{t('skins.back')}</p>
            <div className="flex flex-wrap gap-1.5">
              {(['cape', 'elytra', 'none'] as const).map((b) => (
                <button
                  key={b}
                  disabled={!skin?.cape && b !== 'none'}
                  onClick={() => set({ back: b })}
                  className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors disabled:opacity-40 ${opts.back === b && (skin?.cape || b === 'none') ? 'bg-green-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white'}`}
                >
                  {t(`skins.backs.${b}`)}
                </button>
              ))}
            </div>
            {skin && !skin.cape && <p className="mt-1 text-xs text-gray-500">{t('skins.noCape')}</p>}
          </div>
          <label className="flex cursor-pointer items-center gap-2.5 text-gray-200">
            <input type="checkbox" className="h-4 w-4 accent-green-600" checked={opts.outer} onChange={(e) => set({ outer: e.target.checked })} />
            {t('skins.outerLayer')}
          </label>
          <label className="flex cursor-pointer items-center gap-2.5 text-gray-200">
            <input type="checkbox" className="h-4 w-4 accent-green-600" checked={opts.rotate} onChange={(e) => set({ rotate: e.target.checked })} />
            {t('skins.autoRotate')}
          </label>
          <p className="mt-auto text-xs text-gray-500">{t('skins.mouseHint')}</p>
          <button onClick={refresh} className="flex w-fit items-center gap-2 rounded-lg bg-gray-800 px-3.5 py-2 text-[13px] font-semibold text-gray-300 transition-colors hover:bg-gray-700 hover:text-white">
            <RefreshCw size={14} /> {t('skins.refresh')}
          </button>
        </div>
      </div>
      <ModelTester onWear={setWorn} />
      <Wardrobe preview={preview} onPreview={setPreview} />
    </div>
  )
}
