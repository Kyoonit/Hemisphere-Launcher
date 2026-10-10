import { useEffect, useRef, useState } from 'react'
import { CrouchAnimation, FlyingAnimation, IdleAnimation, RunningAnimation, SkinViewer, WalkingAnimation, WaveAnimation, type PlayerAnimation } from 'skinview3d'
import type { SkinInfo } from '@shared/skins'
import { useAccounts } from '../../accounts'

/**
 * A Minecraft skin in 3D (skinview3d, on three.js). Still pictures (Home) draw one frame and stop; the viewer (Settings >
 * Account) turns with the mouse and plays an animation. Nothing is drawn while the window is hidden.
 */
export type SkinAnimation = 'none' | 'idle' | 'walk' | 'run' | 'wave' | 'crouch' | 'fly'
export const SKIN_ANIMATIONS: SkinAnimation[] = ['idle', 'walk', 'run', 'wave', 'crouch', 'fly', 'none']
const ANIMATION: Record<Exclude<SkinAnimation, 'none'>, () => PlayerAnimation> = {
  idle: () => new IdleAnimation(),
  walk: () => new WalkingAnimation(),
  run: () => new RunningAnimation(),
  wave: () => new WaveAnimation(),
  crouch: () => new CrouchAnimation(),
  fly: () => new FlyingAnimation(),
}
export type BackItem = 'cape' | 'elytra' | 'none'

export function SkinView({
  skin,
  width,
  height,
  interactive = false,
  animation = 'none',
  outerLayer = true,
  back = 'cape',
  autoRotate = false,
  className = '',
}: {
  skin: SkinInfo
  width: number
  height: number
  /** turn and zoom with the mouse (else a still picture) */
  interactive?: boolean
  animation?: SkinAnimation
  outerLayer?: boolean
  back?: BackItem
  autoRotate?: boolean
  className?: string
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const viewer = useRef<SkinViewer | null>(null)
  const still = !interactive && animation === 'none' && !autoRotate
  const stillRef = useRef(still)
  stillRef.current = still

  // one viewer per canvas, freed with it
  useEffect(() => {
    const v = new SkinViewer({ canvas: canvas.current!, width, height, pixelRatio: 'match-device', enableControls: interactive, fov: 40, zoom: interactive ? 0.85 : 0.95 })
    if (interactive) v.controls.enablePan = false
    if (!interactive) {
      // a slight three-quarter view, like a character portrait
      v.playerWrapper.rotation.y = -0.45
    }
    viewer.current = v
    const visibility = () => (v.renderPaused = document.hidden || stillRef.current)
    document.addEventListener('visibilitychange', visibility)
    // a new screen scale (window moved to another monitor) clears the canvas: a still picture is drawn again
    let frame = 0
    const redraw = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => v.render())
    }
    window.addEventListener('resize', redraw)
    let unwatch = () => {}
    const watchScale = () => {
      const scale = matchMedia(`(resolution: ${devicePixelRatio}dppx)`)
      const changed = () => {
        unwatch()
        redraw()
        watchScale()
      }
      scale.addEventListener('change', changed)
      unwatch = () => scale.removeEventListener('change', changed)
    }
    watchScale()
    return () => {
      unwatch()
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', redraw)
      document.removeEventListener('visibilitychange', visibility)
      v.dispose()
      viewer.current = null
    }
  }, [interactive]) // eslint-disable-line react-hooks/exhaustive-deps

  // a still picture is drawn again at its new size (on the next frame too: resizing clears the canvas)
  useEffect(() => {
    const v = viewer.current
    if (!v) return
    v.setSize(width, height)
    v.render()
    const frame = requestAnimationFrame(() => v.render())
    return () => cancelAnimationFrame(frame)
  }, [width, height])

  // skin, cape, layers, animation: a still picture draws again once everything is in place, then stops
  useEffect(() => {
    const v = viewer.current
    if (!v) return
    let cancelled = false
    void (async () => {
      v.renderPaused = false
      await v.loadSkin(skin.skin, { model: skin.slim ? 'slim' : 'default' })
      if (skin.cape && back !== 'none') await v.loadCape(skin.cape, { backEquipment: back })
      else v.loadCape(null)
      if (cancelled) return
      v.playerObject.skin.setOuterLayerVisible(outerLayer)
      v.animation = animation === 'none' ? null : ANIMATION[animation]()
      v.autoRotate = autoRotate
      v.autoRotateSpeed = 1.2
      v.render()
      v.renderPaused = document.hidden || still
    })()
    return () => {
      cancelled = true
    }
  }, [skin.skin, skin.slim, skin.cape, back, outerLayer, animation, autoRotate, still])

  return <canvas ref={canvas} className={className} style={{ width, height }} />
}

/** The active account's skin (null while loading or without an account); `refresh` asks Mojang again. */
export function useActiveSkin(): { skin: SkinInfo | null; refresh(): void } {
  const { state } = useAccounts()
  const id = state?.activeId ?? null
  const [skin, setSkin] = useState<SkinInfo | null>(null)
  const load = (refresh = false) => void window.hemisphere.skins.get(id ?? undefined, refresh).then((s) => setSkin(s && s.id === id ? s : null))
  useEffect(() => {
    setSkin(null)
    if (id) load()
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  return { skin, refresh: () => load(true) }
}

/** Home's button opens Settings > Account and brings the viewer into view (once). */
let focusViewer = false
export const requestSkinViewer = () => (focusViewer = true)
export const takeSkinViewerRequest = () => {
  const asked = focusViewer
  focusViewer = false
  return asked
}
