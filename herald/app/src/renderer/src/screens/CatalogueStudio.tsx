/**
 * The catalogue studio: an item tried on any player (Steve or a player's name), on a background, with an animation,
 * turned with the mouse and placed in the frame with a right-drag. Pictures are made from it at a chosen size: copied
 * to paste in Discord, saved as PNG, or kept as the item's picture in the catalogue. The frame has the picture's shape:
 * what is seen is what is made.
 */
import { useEffect, useMemo, useState } from 'react'
import type { SkinViewer } from 'skinview3d'
import type { StudioPlayer } from '@herald/api'
import type { CatalogueAdjust, CatalogueItem, CatalogueSlot } from '@shared/heraldCatalogue'
import { centreView, SKIN_ANIMATIONS, SkinView, type SkinAnimation } from '@launcher/components/skin/SkinView'
import { BUILT_IN_BACKGROUNDS } from '@launcher/components/feed/homePictures'
import en from '@locales/en.json'
import type { Loaded } from './Catalogue'

/** The frame on screen fits in this box */
const BOX = { width: 560, height: 460 }
const PLAYERS_KEY = 'catalogue-players'
const FORMAT_KEY = 'catalogue-format'

/** Known picture sizes */
const FORMATS = [
  { id: 'square', label: 'Square 1080 × 1080 (Discord, Instagram)', width: 1080, height: 1080 },
  { id: 'portrait', label: 'Portrait 1080 × 1350 (Instagram 4:5)', width: 1080, height: 1350 },
  { id: 'story', label: 'Story 1080 × 1920 (9:16)', width: 1080, height: 1920 },
  { id: 'hd', label: 'HD 1280 × 720', width: 1280, height: 720 },
  { id: 'fullhd', label: 'Full HD 1920 × 1080', width: 1920, height: 1080 },
  { id: 'qhd', label: 'QHD 2560 × 1440', width: 2560, height: 1440 },
  { id: '4k', label: '4K 3840 × 2160', width: 3840, height: 2160 },
] as const
type Format = (typeof FORMATS)[number]
const savedFormat = (): Format => {
  try {
    return FORMATS.find((x) => x.id === localStorage.getItem(FORMAT_KEY)) ?? FORMATS[0]
  } catch {
    return FORMATS[0]
  }
}
/** The frame on screen for a format: its shape, as big as the box allows */
const frameOf = (f: Format) => {
  const k = Math.min(BOX.width / f.width, BOX.height / f.height)
  return { width: Math.round(f.width * k), height: Math.round(f.height * k) }
}

/** Backgrounds: colours, the launcher's own pictures, or none (a transparent PNG) */
type Background = { id: string; label: string; css: string; stops?: string[]; picture?: string }
const BACKGROUNDS: Background[] = [
  { id: 'night', label: 'Night', css: 'linear-gradient(180deg, #0f172a, #1e293b)', stops: ['#0f172a', '#1e293b'] },
  { id: 'emerald', label: 'Emerald', css: 'linear-gradient(180deg, #064e3b, #10b981)', stops: ['#064e3b', '#10b981'] },
  { id: 'sunset', label: 'Sunset', css: 'linear-gradient(180deg, #4c1d95, #db2777, #f97316)', stops: ['#4c1d95', '#db2777', '#f97316'] },
  { id: 'sky', label: 'Sky', css: 'linear-gradient(180deg, #0ea5e9, #e0f2fe)', stops: ['#0ea5e9', '#e0f2fe'] },
  { id: 'stone', label: 'Stone', css: 'linear-gradient(180deg, #4b5563, #111827)', stops: ['#4b5563', '#111827'] },
  ...BUILT_IN_BACKGROUNDS.map((b) => ({ id: b.name, label: (en.backgrounds as Record<string, string>)[b.name.split('.')[1]] ?? b.name, css: `center / cover url("${b.src}")`, picture: b.src })),
  { id: 'none', label: 'None (transparent)', css: 'repeating-conic-gradient(#2a2f3a 0% 25%, #1f2430 0% 50%) 50% / 24px 24px' },
]

async function drawBackground(ctx: CanvasRenderingContext2D, width: number, height: number, bg: Background): Promise<void> {
  if (bg.stops) {
    const g = ctx.createLinearGradient(0, 0, 0, height)
    bg.stops.forEach((c, i) => g.addColorStop(i / (bg.stops!.length - 1), c))
    ctx.fillStyle = g
    ctx.fillRect(0, 0, width, height)
  } else if (bg.picture) {
    const img = new Image()
    img.src = bg.picture
    await img.decode()
    // cover: the middle of the picture
    const k = Math.max(width / img.width, height / img.height)
    ctx.drawImage(img, (width - img.width * k) / 2, (height - img.height * k) / 2, img.width * k, img.height * k)
  }
}

const recentPlayers = (): string[] => {
  try {
    const list = JSON.parse(localStorage.getItem(PLAYERS_KEY) ?? '[]')
    return Array.isArray(list) ? list.filter((n) => typeof n === 'string').slice(0, 8) : []
  } catch {
    return []
  }
}

export function Studio({ item, loaded, adjust, slot, slim, onThumbnail, canWrite }: { item: CatalogueItem; loaded: Loaded; adjust: CatalogueAdjust; slot: CatalogueSlot; slim: boolean; onThumbnail(image: string): void; canWrite: boolean }) {
  const [player, setPlayer] = useState<StudioPlayer | null>(null)
  const [name, setName] = useState('')
  const [recent, setRecent] = useState(recentPlayers)
  const [bg, setBg] = useState<Background>(BACKGROUNDS[0])
  const [animation, setAnimation] = useState<SkinAnimation>('idle')
  const [caption, setCaption] = useState(true)
  const [format, setFormat] = useState<Format>(savedFormat)
  const frame = frameOf(format)
  const [viewer, setViewer] = useState<SkinViewer | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const wear = async (who: string) => {
    setBusy(true)
    setMessage(null)
    const p = await window.herald.catalogue.player(who)
    setBusy(false)
    if (!p) return setMessage({ ok: false, text: `No player “${who}” (or Mojang isn’t answering).` })
    setPlayer(p)
    if (p.name !== 'Steve') {
      const next = [p.name, ...recent.filter((n) => n.toLowerCase() !== p.name.toLowerCase())].slice(0, 8)
      setRecent(next)
      try {
        localStorage.setItem(PLAYERS_KEY, JSON.stringify(next))
      } catch {
        /* not kept */
      }
    }
  }
  useEffect(() => void wear(recentPlayers()[0] ?? 'Steve'), []) // eslint-disable-line react-hooks/exhaustive-deps

  // a skin item is worn as the skin (with the player's cape); a model on the player's skin
  const skin = loaded.kind === 'skin' ? { id: 'item', skin: loaded.skin, slim, cape: player?.cape ?? null, fallback: false } : player ? { id: 'player', skin: player.skin, slim: player.slim, cape: player.cape, fallback: false } : null
  // the same list while nothing changes (a new one rebuilds the model)
  const worn = useMemo(() => (loaded.kind === 'model' ? [{ model: loaded.model, slot, adjust }] : []), [loaded, slot, adjust])

  /** The view as a picture of the format's size (the frame drawn again at that size), as a canvas */
  const render = async (width: number, height: number, withCaption: boolean, transparentOk = true): Promise<HTMLCanvasElement | null> => {
    if (!viewer) return null
    const out = document.createElement('canvas')
    out.width = width
    out.height = height
    const ctx = out.getContext('2d')!
    if (bg.id !== 'none' || !transparentOk) await drawBackground(ctx, width, height, bg.id === 'none' ? BACKGROUNDS[0] : bg)
    const before = viewer.pixelRatio
    viewer.pixelRatio = width / frame.width
    viewer.render()
    ctx.drawImage(viewer.canvas, 0, 0, width, height)
    viewer.pixelRatio = before
    viewer.render()
    if (withCaption) {
      // sized on the short side: the same look on every format
      const k = Math.min(width, height) / 1080
      const top = height - 300 * k
      const shade = ctx.createLinearGradient(0, top, 0, height)
      shade.addColorStop(0, 'rgba(0,0,0,0)')
      shade.addColorStop(1, 'rgba(0,0,0,0.7)')
      ctx.fillStyle = shade
      ctx.fillRect(0, top, width, height - top)
      ctx.fillStyle = '#ffffff'
      ctx.shadowColor = 'rgba(0,0,0,0.6)'
      ctx.shadowBlur = 12 * k
      ctx.font = `700 ${64 * k}px "Segoe UI", system-ui, sans-serif`
      ctx.fillText(item.name, 56 * k, height - 104 * k, width - 112 * k)
      ctx.font = `600 ${32 * k}px "Segoe UI", system-ui, sans-serif`
      ctx.fillStyle = '#86efac'
      ctx.fillText(['Hemisphere SMP', item.tier || null, 'on Patreon'].filter(Boolean).join('  ·  '), 56 * k, height - 52 * k, width - 112 * k)
    }
    return out
  }
  const png = async (canvas: HTMLCanvasElement | null): Promise<Uint8Array | null> => {
    const blob = canvas ? await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png')) : null
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null
  }
  const picture = () => render(format.width, format.height, caption).then(png)

  const copy = async () => {
    setBusy(true)
    const bytes = await picture()
    setBusy(false)
    setMessage(bytes && (await window.herald.catalogue.copyImage(bytes)) ? { ok: true, text: 'Picture copied: paste it in Discord (Ctrl+V).' } : { ok: false, text: 'The picture could not be copied.' })
  }
  const save = async () => {
    setBusy(true)
    const bytes = await picture()
    setBusy(false)
    if (bytes && (await window.herald.catalogue.saveImage(bytes, `${item.name} ${format.width}x${format.height}`))) setMessage({ ok: true, text: 'Picture saved.' })
  }
  const thumbnail = async () => {
    setBusy(true)
    // the middle square of the frame, 512 × 512
    const scale = 512 / Math.min(frame.width, frame.height)
    const full = await render(Math.round(frame.width * scale), Math.round(frame.height * scale), false, false)
    let webp: Uint8Array | null = null
    if (full) {
      const c = new OffscreenCanvas(512, 512)
      c.getContext('2d')!.drawImage(full, (512 - full.width) / 2, (512 - full.height) / 2)
      webp = new Uint8Array(await (await c.convertToBlob({ type: 'image/webp', quality: 0.88 })).arrayBuffer())
    }
    const res = webp ? await window.herald.images.upload(webp, 512, 512) : null
    setBusy(false)
    if (res?.ok) onThumbnail(res.data.id)
    else setMessage({ ok: false, text: res && !res.ok ? res.error : 'The picture could not be made.' })
  }

  return (
    <div className="card p-3">
      <div className="flex flex-wrap gap-4">
        <div className="grid flex-none place-items-center" style={{ width: BOX.width, height: BOX.height }}>
        <div className="relative overflow-hidden rounded-lg" style={{ width: frame.width, height: frame.height, background: bg.css }}>
          {skin ? (
            <SkinView skin={skin} width={frame.width} height={frame.height} interactive pan animation={animation} back={skin.cape ? 'cape' : 'none'} worn={worn} onViewer={setViewer} zoom={0.85} className="cursor-grab active:cursor-grabbing" />
          ) : (
            <div className="grid h-full place-items-center text-sm text-gray-400">Loading the player…</div>
          )}
        </div>
        </div>
        <div className="flex min-w-56 flex-1 flex-col gap-3">
          <div>
            <label className="label">Worn by</label>
            <form
              className="flex gap-1.5"
              onSubmit={(e) => {
                e.preventDefault()
                if (name.trim()) void wear(name.trim())
              }}
            >
              <input className="field py-1.5!" value={name} placeholder="A player’s name" maxLength={16} onChange={(e) => setName(e.target.value.replace(/[^A-Za-z0-9_]/g, ''))} />
              <button className="btn btn-sm" disabled={busy || !name.trim()}>
                Wear
              </button>
            </form>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {['Steve', ...recent].map((n) => (
                <button key={n} className={`btn btn-sm ${player?.name === n ? 'btn-primary' : 'btn-ghost'}`} disabled={busy} onClick={() => void wear(n)}>
                  {n}
                </button>
              ))}
            </div>
            {loaded.kind === 'skin' && <p className="mt-1 text-[11px] text-gray-500">A skin item: the player only lends their cape.</p>}
          </div>
          <div>
            <label className="label">Background</label>
            <div className="flex flex-wrap gap-1.5">
              {BACKGROUNDS.map((b) => (
                <button key={b.id} title={b.label} onClick={() => setBg(b)} className={`h-8 w-11 rounded-md border-2 ${bg.id === b.id ? 'border-green-500' : 'border-transparent'}`} style={{ background: b.css }} />
              ))}
            </div>
          </div>
          <div>
            <label className="label">Animation</label>
            <select className="field py-1.5!" value={animation} onChange={(e) => setAnimation(e.target.value as SkinAnimation)}>
              {SKIN_ANIMATIONS.map((a) => (
                <option key={a} value={a}>
                  {(en.skins.animations as Record<string, string>)[a]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Picture size</label>
            <select
              className="field mb-2 py-1.5!"
              value={format.id}
              onChange={(e) => {
                const next = FORMATS.find((x) => x.id === e.target.value) ?? FORMATS[0]
                setFormat(next)
                try {
                  localStorage.setItem(FORMAT_KEY, next.id)
                } catch {
                  /* not kept */
                }
              }}
            >
              {FORMATS.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
            </select>
            <label className="mb-2 flex items-center gap-2 text-xs text-gray-300">
              <input type="checkbox" checked={caption} onChange={(e) => setCaption(e.target.checked)} /> Name and tier on the picture
            </label>
            <div className="flex flex-wrap gap-1.5">
              <button className="btn btn-sm btn-primary" disabled={!viewer || busy} onClick={() => void copy()}>
                Copy the picture
              </button>
              <button className="btn btn-sm" disabled={!viewer || busy} onClick={() => void save()}>
                Save as PNG…
              </button>
              {canWrite && (
                <button className="btn btn-sm btn-ghost" disabled={!viewer || busy} onClick={() => void thumbnail()}>
                  Use as the item’s picture
                </button>
              )}
            </div>
          </div>
          {message && <p className={`text-xs ${message.ok ? 'text-green-400' : 'text-red-400'}`}>{message.text}</p>}
          <div className="mt-auto flex items-end justify-between gap-2">
            <p className="text-[11px] text-gray-500">Left-drag to turn, right-drag to place it in the frame (it never leaves it), scroll to zoom.</p>
            <button className="btn btn-sm btn-ghost flex-none" disabled={!viewer} onClick={() => viewer && centreView(viewer)}>
              Centre
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
