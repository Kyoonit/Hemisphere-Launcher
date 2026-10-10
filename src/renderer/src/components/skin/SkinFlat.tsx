import { useEffect, useRef } from 'react'

/**
 * Flat front pictures for the wardrobe's lists (2D canvas: dozens of them cost nothing, unlike 3D views).
 * The player is 16×32 skin pixels; the cape's front is 10×16.
 */
type Part = [sx: number, sy: number, w: number, h: number, dx: number, dy: number, mirror?: boolean]

function frontParts(slim: boolean, legacy: boolean): Part[] {
  const aw = slim ? 3 : 4
  const base: Part[] = [
    [8, 8, 8, 8, 4, 0], // head
    [20, 20, 8, 12, 4, 8], // body
    [44, 20, aw, 12, 4 - aw, 8], // right arm (on the left of the picture)
    [4, 20, 4, 12, 4, 20], // right leg
  ]
  // 64×32 skins (old format): no left limbs, no overlays but the hat; the right ones are mirrored
  if (legacy) return [...base, [44, 20, aw, 12, 12, 8, true], [4, 20, 4, 12, 8, 20, true], [40, 8, 8, 8, 4, 0]]
  return [
    ...base,
    [36, 52, aw, 12, 12, 8], // left arm
    [20, 52, 4, 12, 8, 20], // left leg
    [40, 8, 8, 8, 4, 0], // hat
    [20, 36, 8, 12, 4, 8], // jacket
    [44, 36, aw, 12, 4 - aw, 8], // right sleeve
    [52, 52, aw, 12, 12, 8], // left sleeve
    [4, 36, 4, 12, 4, 20], // right trouser
    [4, 52, 4, 12, 8, 20], // left trouser
  ]
}

/** Minecraft ignores the hat of an old 64×32 skin when it has no see-through pixel (it was often painted over) */
function hasSeeThrough(img: HTMLImageElement): boolean {
  const c = document.createElement('canvas')
  c.width = 32
  c.height = 16
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 32, 0, 32, 16, 0, 0, 32, 16)
  const px = ctx.getImageData(0, 0, 32, 16).data
  for (let i = 3; i < px.length; i += 4) if (px[i] < 128) return true
  return false
}

function useImage(src: string, draw: (ctx: CanvasRenderingContext2D, img: HTMLImageElement) => void, deps: unknown[]) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let live = true
    const img = new Image()
    img.onload = () => {
      const ctx = canvas.current?.getContext('2d')
      if (!live || !ctx) return
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
      ctx.imageSmoothingEnabled = false
      draw(ctx, img)
    }
    img.src = src
    return () => {
      live = false
    }
  }, [src, ...deps]) // eslint-disable-line react-hooks/exhaustive-deps
  return canvas
}

export function SkinFlat({ skin, slim, height = 96, className = '' }: { skin: string; slim: boolean; height?: number; className?: string }) {
  const canvas = useImage(
    skin,
    (ctx, img) => {
      const legacy = img.height === 32
      for (const [sx, sy, w, h, dx, dy, mirror] of frontParts(slim, legacy)) {
        if (legacy && sx === 40 && !hasSeeThrough(img)) continue
        if (!mirror) ctx.drawImage(img, sx, sy, w, h, dx * 4, dy * 4, w * 4, h * 4)
        else {
          ctx.save()
          ctx.scale(-1, 1)
          ctx.drawImage(img, sx, sy, w, h, -(dx + w) * 4, dy * 4, w * 4, h * 4)
          ctx.restore()
        }
      }
    },
    [slim],
  )
  return <canvas ref={canvas} width={64} height={128} className={`[image-rendering:pixelated] ${className}`} style={{ height, width: height / 2 }} />
}

export function CapeFlat({ cape, height = 64, className = '' }: { cape: string; height?: number; className?: string }) {
  const canvas = useImage(
    cape,
    (ctx, img) => {
      const u = img.width / 64 // HD capes
      ctx.drawImage(img, u, u, 10 * u, 16 * u, 0, 0, 40, 64)
    },
    [],
  )
  return <canvas ref={canvas} width={40} height={64} className={`[image-rendering:pixelated] ${className}`} style={{ height, width: (height * 10) / 16 }} />
}
