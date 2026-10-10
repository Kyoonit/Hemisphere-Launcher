/**
 * The catalogue studio: an item tried on any player (Steve or a player's name), on a background, with an animation,
 * turned with the mouse. Pictures are made from it: copied to paste in Discord, saved as PNG, or kept as the item's
 * picture in the catalogue.
 */
import { useEffect, useMemo, useState } from 'react'
import type { SkinViewer } from 'skinview3d'
import type { StudioPlayer } from '@herald/api'
import type { CatalogueAdjust, CatalogueItem, CatalogueSlot } from '@shared/heraldCatalogue'
import { SKIN_ANIMATIONS, SkinView, type SkinAnimation } from '@launcher/components/skin/SkinView'
import { BUILT_IN_BACKGROUNDS } from '@launcher/components/feed/homePictures'
import en from '@locales/en.json'
import type { Loaded } from './Catalogue'

const SIZE = 460
const PICTURE = 1080
const PLAYERS_KEY = 'catalogue-players'

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

async function drawBackground(ctx: CanvasRenderingContext2D, size: number, bg: Background): Promise<void> {
  if (bg.stops) {
    const g = ctx.createLinearGradient(0, 0, 0, size)
    bg.stops.forEach((c, i) => g.addColorStop(i / (bg.stops!.length - 1), c))
    ctx.fillStyle = g
    ctx.fillRect(0, 0, size, size)
  } else if (bg.picture) {
    const img = new Image()
    img.src = bg.picture
    await img.decode()
    // cover: the middle of the picture
    const k = Math.max(size / img.width, size / img.height)
    ctx.drawImage(img, (size - img.width * k) / 2, (size - img.height * k) / 2, img.width * k, img.height * k)
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

  /** The view as a square picture (PNG bytes), drawn again at the picture's size */
  const picture = async (size: number, withCaption: boolean, transparentOk = true): Promise<Uint8Array | null> => {
    if (!viewer) return null
    const out = document.createElement('canvas')
    out.width = out.height = size
    const ctx = out.getContext('2d')!
    if (bg.id !== 'none' || !transparentOk) await drawBackground(ctx, size, bg.id === 'none' ? BACKGROUNDS[0] : bg)
    const before = viewer.pixelRatio
    viewer.pixelRatio = size / SIZE
    viewer.render()
    ctx.drawImage(viewer.canvas, 0, 0, size, size)
    viewer.pixelRatio = before
    viewer.render()
    if (withCaption) {
      const k = size / 1080
      const shade = ctx.createLinearGradient(0, size * 0.72, 0, size)
      shade.addColorStop(0, 'rgba(0,0,0,0)')
      shade.addColorStop(1, 'rgba(0,0,0,0.7)')
      ctx.fillStyle = shade
      ctx.fillRect(0, size * 0.72, size, size * 0.28)
      ctx.fillStyle = '#ffffff'
      ctx.shadowColor = 'rgba(0,0,0,0.6)'
      ctx.shadowBlur = 12 * k
      ctx.font = `700 ${64 * k}px "Segoe UI", system-ui, sans-serif`
      ctx.fillText(item.name, 56 * k, size - 104 * k, size - 112 * k)
      ctx.font = `600 ${32 * k}px "Segoe UI", system-ui, sans-serif`
      ctx.fillStyle = '#86efac'
      ctx.fillText(['Hemisphere SMP', item.tier || null, 'on Patreon'].filter(Boolean).join('  ·  '), 56 * k, size - 52 * k, size - 112 * k)
    }
    const blob = await new Promise<Blob | null>((r) => out.toBlob(r, 'image/png'))
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null
  }

  const copy = async () => {
    const png = await picture(PICTURE, caption)
    setMessage(png && (await window.herald.catalogue.copyImage(png)) ? { ok: true, text: 'Picture copied: paste it in Discord (Ctrl+V).' } : { ok: false, text: 'The picture could not be copied.' })
  }
  const save = async () => {
    const png = await picture(PICTURE, caption)
    if (png && (await window.herald.catalogue.saveImage(png, item.name))) setMessage({ ok: true, text: 'Picture saved.' })
  }
  const thumbnail = async () => {
    setBusy(true)
    const png = await picture(512, false, false)
    let webp: Uint8Array | null = null
    if (png) {
      const bitmap = await createImageBitmap(new Blob([png as Uint8Array<ArrayBuffer>], { type: 'image/png' }))
      const c = new OffscreenCanvas(512, 512)
      c.getContext('2d')!.drawImage(bitmap, 0, 0)
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
        <div className="relative flex-none overflow-hidden rounded-lg" style={{ width: SIZE, height: SIZE, background: bg.css }}>
          {skin ? (
            <SkinView skin={skin} width={SIZE} height={SIZE} interactive animation={animation} back={skin.cape ? 'cape' : 'none'} worn={worn} onViewer={setViewer} zoom={0.85} className="cursor-grab active:cursor-grabbing" />
          ) : (
            <div className="grid h-full place-items-center text-sm text-gray-400">Loading the player…</div>
          )}
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
            <label className="label">Picture for Discord (1080 × 1080)</label>
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
          <p className="mt-auto text-[11px] text-gray-500">Drag to turn, scroll to zoom. Turn it as you want it on the picture.</p>
        </div>
      </div>
    </div>
  )
}
