import { useEffect, useRef } from 'react'
import { CrouchAnimation, FlyingAnimation, IdleAnimation, RunningAnimation, SkinViewer, WalkingAnimation, WaveAnimation, type PlayerAnimation } from 'skinview3d'
import { Box3, Vector3 } from 'three'
import type { SkinInfo } from '@shared/skins'
import type { ModelData } from '@shared/models'
import { bodyPart, buildModel, disposeModel, type ModelAdjust, type WornSlot } from './modelMesh'

/** A model worn by the player in a view (Patreon try-on) */
export interface WornModel {
  model: ModelData
  slot: WornSlot
  adjust?: ModelAdjust
}

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

const NONE: WornModel[] = []

/** Viewers that can be moved in their frame (right-drag): how to put the player back in the middle */
const centring = new WeakMap<SkinViewer, () => void>()
export const centreView = (v: SkinViewer) => centring.get(v)?.()

export function SkinView({
  skin,
  width,
  height,
  interactive = false,
  animation = 'none',
  outerLayer = true,
  back = 'cape',
  autoRotate = false,
  dragTurn = false,
  worn = NONE,
  onViewer,
  zoom = 1,
  pan = false,
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
  /** a still picture the player can turn on itself by dragging it sideways */
  dragTurn?: boolean
  /** models on the head or in the hands */
  worn?: WornModel[]
  /** the viewer, once made (captures: it keeps its last picture readable) */
  onViewer?(viewer: SkinViewer | null): void
  /** camera distance factor (below 1: further away) */
  zoom?: number
  /** right-drag moves the player in the frame (its middle never leaves it), to frame a picture */
  pan?: boolean
  className?: string
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const keepInFrame = useRef<(() => void) | null>(null)
  const viewer = useRef<SkinViewer | null>(null)
  const still = !interactive && animation === 'none' && !autoRotate
  const stillRef = useRef(still)
  stillRef.current = still

  // one viewer per canvas, freed with it
  useEffect(() => {
    const v = new SkinViewer({ canvas: canvas.current!, width, height, pixelRatio: 'match-device', enableControls: interactive, fov: 40, zoom: interactive ? 0.85 : 0.95, preserveDrawingBuffer: !!onViewer })
    onViewer?.(v)
    if (interactive) v.controls.enablePan = false
    if (!interactive) {
      // a slight three-quarter view, like a character portrait
      v.playerWrapper.rotation.y = -0.45
    }
    viewer.current = v
    // drag sideways: the player turns on its own axis, drawn only while moving
    const c = canvas.current!
    let from: { x: number; angle: number } | null = null
    const down = (e: PointerEvent) => {
      if (!dragTurn || e.button !== 0) return
      c.setPointerCapture(e.pointerId)
      from = { x: e.clientX, angle: v.playerWrapper.rotation.y }
    }
    const move = (e: PointerEvent) => {
      if (!from) return
      v.playerWrapper.rotation.y = from.angle + (e.clientX - from.x) * 0.012
      v.render()
    }
    const up = () => (from = null)
    // right-drag: the picture's frame moves over the scene (a camera view offset, whatever the rotation), as a
    // fraction of the frame; the middle of the player (and what it wears) always stays inside the frame
    const shift = { x: 0, y: 0 }
    const box = new Box3()
    const corner = new Vector3()
    const apply = () => {
      const w = c.clientWidth || 1
      const h = c.clientHeight || 1
      if (!shift.x && !shift.y) v.camera.clearViewOffset()
      else v.camera.setViewOffset(w, h, -shift.x * w, -shift.y * h, w, h)
    }
    const part = new Box3()
    const clamp = () => {
      if (!pan) return
      v.camera.updateMatrixWorld()
      v.playerObject.updateWorldMatrix(true, true)
      // what is shown only (a hidden cape does not count)
      box.makeEmpty()
      v.playerObject.traverseVisible((o) => {
        const g = (o as { geometry?: { boundingBox: Box3 | null; computeBoundingBox(): void } }).geometry
        if (!g) return
        if (!g.boundingBox) g.computeBoundingBox()
        box.union(part.copy(g.boundingBox!).applyMatrix4(o.matrixWorld))
      })
      if (box.isEmpty()) return apply()
      let [minX, maxX, minY, maxY] = [Infinity, -Infinity, Infinity, -Infinity]
      for (let i = 0; i < 8; i++) {
        corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(v.camera)
        minX = Math.min(minX, (corner.x + 1) / 2)
        maxX = Math.max(maxX, (corner.x + 1) / 2)
        minY = Math.min(minY, (1 - corner.y) / 2)
        maxY = Math.max(maxY, (1 - corner.y) / 2)
      }
      // the player's middle never leaves the frame (at most half of it goes past an edge)
      const cx = (minX + maxX) / 2 - shift.x
      const cy = (minY + maxY) / 2 - shift.y
      shift.x = Math.min(1 - cx, Math.max(-cx, shift.x))
      shift.y = Math.min(1 - cy, Math.max(-cy, shift.y))
      apply()
    }
    keepInFrame.current = clamp
    centring.set(v, () => {
      shift.x = shift.y = 0
      apply()
      v.render()
    })
    let moving: { x: number; y: number; sx: number; sy: number } | null = null
    const panDown = (e: PointerEvent) => {
      if (!pan || e.button !== 2) return
      c.setPointerCapture(e.pointerId)
      moving = { x: e.clientX, y: e.clientY, sx: shift.x, sy: shift.y }
    }
    const panMove = (e: PointerEvent) => {
      if (!moving) return
      shift.x = moving.sx + (e.clientX - moving.x) / (c.clientWidth || 1)
      shift.y = moving.sy + (e.clientY - moving.y) / (c.clientHeight || 1)
      apply()
      clamp()
      v.render()
    }
    const panUp = (e: PointerEvent) => e.button === 2 && (moving = null)
    const noMenu = (e: MouseEvent) => pan && e.preventDefault()
    if (pan) {
      c.addEventListener('pointerdown', panDown)
      c.addEventListener('pointermove', panMove)
      c.addEventListener('pointerup', panUp)
      c.addEventListener('contextmenu', noMenu)
      // turned or zoomed: its middle still inside the frame
      v.controls.addEventListener('change', clamp)
    }
    c.addEventListener('pointerdown', down)
    c.addEventListener('pointermove', move)
    c.addEventListener('pointerup', up)
    c.addEventListener('pointercancel', up)
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
      c.removeEventListener('pointerdown', panDown)
      c.removeEventListener('pointermove', panMove)
      c.removeEventListener('pointerup', panUp)
      c.removeEventListener('contextmenu', noMenu)
      v.controls.removeEventListener('change', clamp)
      keepInFrame.current = null
      c.removeEventListener('pointerdown', down)
      c.removeEventListener('pointermove', move)
      c.removeEventListener('pointerup', up)
      c.removeEventListener('pointercancel', up)
      unwatch()
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', redraw)
      document.removeEventListener('visibilitychange', visibility)
      v.dispose()
      viewer.current = null
      onViewer?.(null)
    }
  }, [interactive, dragTurn, pan]) // eslint-disable-line react-hooks/exhaustive-deps

  // a still picture is drawn again at its new size (on the next frame too: resizing clears the canvas)
  useEffect(() => {
    const v = viewer.current
    if (!v) return
    v.setSize(width, height)
    keepInFrame.current?.() // the frame changed shape: the player's middle stays inside
    v.render()
    const frame = requestAnimationFrame(() => v.render())
    return () => cancelAnimationFrame(frame)
  }, [width, height])

  // worn models: built, attached to their body part (they follow its animation), freed when they change
  useEffect(() => {
    const v = viewer.current
    if (!v) return
    // room for what's above the head or in the hands
    v.zoom = (interactive ? 0.85 : 0.95) * (worn.length ? 0.78 : 1) * zoom
    if (!worn.length) return v.render()
    let cancelled = false
    const built: Awaited<ReturnType<typeof buildModel>>[] = []
    void Promise.all(
      worn.map(async (w) => {
        const g = await buildModel(w.model, w.slot, w.adjust)
        if (cancelled) return disposeModel(g)
        built.push(g)
        bodyPart(v, w.model, w.slot).add(g)
      }),
    )
      .then(() => !cancelled && (keepInFrame.current?.(), v.render())) // what it wears stays in the frame too
      .catch((err) => console.warn('[skin] model:', err))
    return () => {
      cancelled = true
      built.forEach(disposeModel)
      v.render()
    }
  }, [worn, interactive, dragTurn, zoom, pan]) // a new viewer gets them again

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

  return <canvas ref={canvas} className={`${dragTurn ? 'cursor-grab touch-none active:cursor-grabbing' : ''} ${className}`} style={{ width, height }} />
}
