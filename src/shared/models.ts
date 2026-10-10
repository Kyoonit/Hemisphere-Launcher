/**
 * 3D models worn on the player (launcher 1.4, Patreon try-on): Minecraft JSON models (resource pack items/blocks)
 * and Blockbench projects (.bbmodel), read into one simple form the viewer draws. Pure code: no three.js here.
 *
 * Coordinates are Minecraft's model space (pixels, a block is 0–16, y up, north = −z). UVs are 0–1 of their texture,
 * already for the first frame of an animated texture.
 */

export type Vec3 = [number, number, number]
export type FaceName = 'north' | 'south' | 'east' | 'west' | 'up' | 'down'
export const FACES: FaceName[] = ['north', 'south', 'east', 'west', 'up', 'down']

export interface ModelFace {
  /** [u1, v1, u2, v2], 0–1 (u1 > u2 or v1 > v2 = mirrored) */
  uv: [number, number, number, number]
  /** clockwise quarter turns of the texture on the face (0–3) */
  turns: number
  /** index in ModelData.textures */
  texture: number
}

export interface ModelCube {
  from: Vec3
  to: Vec3
  /** model-space transform of the cube (column-major 4×4, like three.js Matrix4.elements) */
  matrix: number[]
  faces: Partial<Record<FaceName, ModelFace>>
}

export interface ModelTexture {
  name: string
  /** data: URL of the PNG */
  src: string
}

/** How an item is held or worn (Minecraft's `display` block): degrees, pixels, factor */
export interface DisplayTransform {
  rotation: Vec3
  translation: Vec3
  scale: Vec3
}
export type DisplaySlot = 'head' | 'thirdperson_righthand' | 'thirdperson_lefthand'

export interface ModelData {
  /** java: placed like a Minecraft item (display transforms); entity: Blockbench entity model, feet at 0 */
  kind: 'java' | 'entity'
  textures: ModelTexture[]
  cubes: ModelCube[]
  display: Partial<Record<DisplaySlot, DisplayTransform>>
}

/** A file given with the model: JSON models (parents) and PNG textures */
export interface ModelFile {
  name: string
  /** text for .json/.bbmodel; data: URL for .png */
  content: string
  /** PNG size (for animated textures: frames stacked vertically) */
  width?: number
  height?: number
  /** PNG alpha, one byte per pixel, row by row (flat items: which pixels get side faces) */
  alpha?: Uint8Array
}

export class ModelError extends Error {}

const MAX_CUBES = 4000
const MAX_DEPTH = 8

// ---------------------------------------------------------------- 4×4 matrices (column-major)

type M4 = number[]
const identity = (): M4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
export function multiply(a: M4, b: M4): M4 {
  const out = new Array<number>(16).fill(0)
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]
  return out
}
const translate = (x: number, y: number, z: number): M4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]
const scale = (x: number, y: number, z: number): M4 => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1]
const rad = (deg: number) => (deg * Math.PI) / 180
export function rotate(axis: 'x' | 'y' | 'z', deg: number): M4 {
  const c = Math.cos(rad(deg))
  const s = Math.sin(rad(deg))
  if (axis === 'x') return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]
  if (axis === 'y') return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]
  return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
}
/** a rotation around `origin` */
const around = (origin: Vec3, r: M4): M4 => multiply(translate(...origin), multiply(r, translate(-origin[0], -origin[1], -origin[2])))
export const applyPoint = (m: M4, p: Vec3): Vec3 => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
]

// ---------------------------------------------------------------- checks

const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const vec = (v: unknown, d: Vec3 = [0, 0, 0]): Vec3 => (Array.isArray(v) && v.length >= 3 ? [num(v[0], d[0]), num(v[1], d[1]), num(v[2], d[2])] : [...d])
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const parseJson = (text: string, what: string): unknown => {
  try {
    return JSON.parse(text.replace(/^﻿/, ''))
  } catch {
    throw new ModelError(`${what}: not valid JSON`)
  }
}

function displayOf(v: unknown): ModelData['display'] {
  const out: ModelData['display'] = {}
  for (const slot of ['head', 'thirdperson_righthand', 'thirdperson_lefthand'] as const) {
    const d = obj(obj(v)[slot])
    if (!Object.keys(d).length) continue
    out[slot] = { rotation: vec(d.rotation), translation: vec(d.translation), scale: vec(d.scale, [1, 1, 1]) }
  }
  return out
}

// ---------------------------------------------------------------- Minecraft JSON models

/** Vanilla parents a resource pack model often points to (not shipped with the model): their display blocks */
const BUILTIN: Record<string, { display: ModelData['display']; generated?: boolean }> = {
  'block/block': {
    display: { thirdperson_righthand: { rotation: [75, 45, 0], translation: [0, 2.5, 0], scale: [0.375, 0.375, 0.375] }, thirdperson_lefthand: { rotation: [75, 45, 0], translation: [0, 2.5, 0], scale: [0.375, 0.375, 0.375] } },
  },
  'item/generated': {
    generated: true,
    display: {
      head: { rotation: [0, 180, 0], translation: [0, 13, 7], scale: [1, 1, 1] },
      thirdperson_righthand: { rotation: [0, 0, 0], translation: [0, 3, 1], scale: [0.55, 0.55, 0.55] },
      thirdperson_lefthand: { rotation: [0, 0, 0], translation: [0, 3, 1], scale: [0.55, 0.55, 0.55] },
    },
  },
  'item/handheld': {
    generated: true,
    display: {
      head: { rotation: [0, 180, 0], translation: [0, 13, 7], scale: [1, 1, 1] },
      thirdperson_righthand: { rotation: [0, -90, 55], translation: [0, 4, 0.5], scale: [0.85, 0.85, 0.85] },
      thirdperson_lefthand: { rotation: [0, 90, -55], translation: [0, 4, 0.5], scale: [0.85, 0.85, 0.85] },
    },
  },
}
const resourceName = (ref: string) => ref.replace(/^minecraft:/, '').replace(/^.*?:/, '')
const baseName = (path: string) => path.replace(/\\/g, '/').split('/').pop()!.replace(/\.(json|png|bbmodel)$/i, '').toLowerCase()

/** MC's default UVs (pixels 0–16) when a face doesn't give them */
function defaultUv(face: FaceName, f: Vec3, t: Vec3): [number, number, number, number] {
  switch (face) {
    case 'down':
      return [f[0], 16 - t[2], t[0], 16 - f[2]]
    case 'up':
      return [f[0], f[2], t[0], t[2]]
    case 'north':
      return [16 - t[0], 16 - t[1], 16 - f[0], 16 - f[1]]
    case 'south':
      return [f[0], 16 - t[1], t[0], 16 - f[1]]
    case 'west':
      return [f[2], 16 - t[1], t[2], 16 - f[1]]
    case 'east':
      return [16 - t[2], 16 - t[1], 16 - f[2], 16 - f[1]]
  }
}

/**
 * A Minecraft JSON model with its files (parent models, PNG textures, found by file name). Vanilla parents
 * (block/block, item/generated, item/handheld) are known; "item/generated" builds the flat item from layer0.
 */
export function readJavaModel(main: ModelFile, files: ModelFile[]): ModelData {
  // models and textures can share a name (test_sword.json, test_sword.png)
  const models = new Map(files.filter((f) => /.json$/i.test(f.name)).map((f) => [baseName(f.name), f]))
  const pngs = new Map(files.filter((f) => /.png$/i.test(f.name)).map((f) => [baseName(f.name), f]))
  // the parent chain: textures and display merged (child wins), elements from the nearest model having some
  let textures: Record<string, string> = {}
  let display: ModelData['display'] = {}
  let elements: unknown[] | null = null
  let generated = false
  let current: ModelFile | null = main
  for (let depth = 0; current; depth++) {
    if (depth > MAX_DEPTH) throw new ModelError('parent chain too long')
    const m = obj(parseJson(current.content, current.name))
    textures = { ...(obj(m.textures) as Record<string, string>), ...textures }
    display = { ...displayOf(m.display), ...display }
    if (!elements && Array.isArray(m.elements)) elements = m.elements
    const parent = typeof m.parent === 'string' ? resourceName(m.parent) : null
    current = null
    if (!parent) break
    const builtin = BUILTIN[parent]
    if (builtin) {
      display = { ...builtin.display, ...display }
      generated = !elements && !!builtin.generated
    } else {
      current = models.get(baseName(parent)) ?? null
      // a parent only for textures/display may be left out when the model has its own cubes
      if (!current && !elements) throw new ModelError(`parent model "${parent}" is missing`)
    }
  }

  const out: ModelData = { kind: 'java', textures: [], cubes: [], display }
  const textureIndex = new Map<string, { index: number; frames: number }>()
  const texture = (ref: unknown): { index: number; frames: number } | null => {
    let key = typeof ref === 'string' ? ref : ''
    for (let i = 0; key.startsWith('#') && i < 16; i++) key = typeof textures[key.slice(1)] === 'string' ? textures[key.slice(1)] : ''
    if (!key || key.startsWith('#')) return null
    const name = baseName(resourceName(key))
    if (textureIndex.has(name)) return textureIndex.get(name)!
    const png = pngs.get(name)
    if (!png || !png.content.startsWith('data:image/png')) throw new ModelError(`texture "${key}" is missing`)
    // animated textures (.mcmeta): frames stacked vertically, the first one is shown
    const frames = png.width && png.height && png.height > png.width && png.height % png.width === 0 ? png.height / png.width : 1
    const t = { index: out.textures.length, frames }
    out.textures.push({ name, src: png.content })
    textureIndex.set(name, t)
    return t
  }

  if (generated && !elements) {
    const layer = pngs.get(baseName(resourceName(textures.layer0 ?? '')))
    if (!layer) throw new ModelError('texture "layer0" is missing')
    out.cubes = generatedCubes(texture('#layer0')!, layer)
    return out
  }
  for (const raw of elements ?? []) {
    const e = obj(raw)
    const from = vec(e.from)
    const to = vec(e.to)
    let matrix = identity()
    const r = obj(e.rotation)
    if (r.axis === 'x' || r.axis === 'y' || r.axis === 'z') {
      const angle = num(r.angle)
      let m = rotate(r.axis, angle)
      if (r.rescale === true && angle % 90) {
        // MC stretches the two other axes so the rotated cube keeps its size on the grid
        const k = 1 / Math.cos(rad(Math.abs(angle)))
        m = multiply(m, scale(r.axis === 'x' ? 1 : k, r.axis === 'y' ? 1 : k, r.axis === 'z' ? 1 : k))
      }
      matrix = around(vec(r.origin, [8, 8, 8]), m)
    }
    const faces: ModelCube['faces'] = {}
    for (const name of FACES) {
      const f = obj(obj(e.faces)[name])
      if (!Object.keys(f).length) continue
      const t = texture(f.texture)
      if (!t) continue
      const uv = Array.isArray(f.uv) && f.uv.length === 4 ? (f.uv.map((x) => num(x)) as [number, number, number, number]) : defaultUv(name, from, to)
      faces[name] = { uv: [uv[0] / 16, uv[1] / 16 / t.frames, uv[2] / 16, uv[3] / 16 / t.frames], turns: Math.round(num(f.rotation) / 90) & 3, texture: t.index }
    }
    out.cubes.push({ from, to, matrix, faces })
    if (out.cubes.length > MAX_CUBES) throw new ModelError('too many cubes')
  }
  return out
}

/**
 * item/generated: the texture as a flat item, one pixel thick (7.5–8.5 on z), like Minecraft's: front and back
 * faces, and a side face for each opaque pixel next to a see-through one. `opaque` comes from the decoded PNG.
 */
function generatedCubes(t: { index: number; frames: number }, png: ModelFile): ModelCube[] {
  const cubes: ModelCube[] = [
    {
      from: [0, 0, 7.5],
      to: [16, 16, 8.5],
      matrix: identity(),
      faces: { north: { uv: [1, 0, 0, 1 / t.frames], turns: 0, texture: t.index }, south: { uv: [0, 0, 1, 1 / t.frames], turns: 0, texture: t.index } },
    },
  ]
  const alpha = png.alpha
  const w = png.width ?? 16
  const h = (png.height ?? 16) / t.frames
  if (!alpha) return cubes
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && alpha[y * w + x] > 0
  const px = 16 / w
  const py = 16 / h
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!solid(x, y)) continue
      const u: [number, number, number, number] = [x / w, y / h / t.frames, (x + 1) / w, (y + 1) / h / t.frames]
      const faces: ModelCube['faces'] = {}
      if (!solid(x - 1, y)) faces.west = { uv: u, turns: 0, texture: t.index }
      if (!solid(x + 1, y)) faces.east = { uv: u, turns: 0, texture: t.index }
      if (!solid(x, y - 1)) faces.up = { uv: u, turns: 0, texture: t.index }
      if (!solid(x, y + 1)) faces.down = { uv: u, turns: 0, texture: t.index }
      if (Object.keys(faces).length) cubes.push({ from: [x * px, 16 - (y + 1) * py, 7.5], to: [(x + 1) * px, 16 - y * py, 8.5], matrix: identity(), faces })
      if (cubes.length > MAX_CUBES) throw new ModelError('too many cubes')
    }
  return cubes
}

// ---------------------------------------------------------------- Blockbench projects

/** Blockbench rotates in Z, then Y, then X (degrees) */
const bbRotation = (r: Vec3): M4 => multiply(rotate('x', r[0]), multiply(rotate('y', r[1]), rotate('z', r[2])))

/** A Blockbench project (.bbmodel): cubes, groups (outliner) and the textures saved inside it */
export function readBbmodel(file: ModelFile): ModelData {
  const p = obj(parseJson(file.content, file.name))
  const meta = obj(p.meta)
  const format = typeof meta.model_format === 'string' ? meta.model_format : 'free'
  const java = format === 'java_block' || format === 'java_item'
  const res = obj(p.resolution)
  const projectW = num(res.width, 16) || 16
  const projectH = num(res.height, 16) || 16

  const out: ModelData = { kind: java ? 'java' : 'entity', textures: [], cubes: [], display: java ? displayOf(p.display) : {} }
  const texList = Array.isArray(p.textures) ? p.textures.map(obj) : []
  const uvSize: [number, number][] = []
  const byUuid = new Map<string, number>()
  for (const t of texList) {
    if (typeof t.source !== 'string' || !t.source.startsWith('data:image/png')) throw new ModelError(`texture "${String(t.name ?? '?')}" is not saved inside the project`)
    if (typeof t.uuid === 'string') byUuid.set(t.uuid, out.textures.length)
    // since Blockbench 4.5 each texture has its own UV size; before, the project's
    uvSize.push([num(t.uv_width, projectW) || projectW, num(t.uv_height, projectH) || projectH])
    out.textures.push({ name: typeof t.name === 'string' ? t.name : `texture ${out.textures.length + 1}`, src: t.source })
  }

  // groups: each element's transform includes its groups' rotations (around their origins)
  const parentMatrix = new Map<string, M4>()
  const walk = (nodes: unknown, m: M4, depth: number) => {
    if (!Array.isArray(nodes) || depth > 64) return
    for (const n of nodes) {
      if (typeof n === 'string') parentMatrix.set(n, m)
      else {
        const g = obj(n)
        if (g.visibility === false) continue
        walk(g.children, multiply(m, around(vec(g.origin), bbRotation(vec(g.rotation)))), depth + 1)
      }
    }
  }
  walk(p.outliner, identity(), 0)
  const grouped = parentMatrix.size > 0

  for (const raw of Array.isArray(p.elements) ? p.elements : []) {
    const e = obj(raw)
    if ((e.type !== undefined && e.type !== 'cube') || e.visibility === false || e.export === false) continue
    const id = typeof e.uuid === 'string' ? e.uuid : ''
    if (grouped && !parentMatrix.has(id)) continue // hidden with its group
    const inflate = num(e.inflate)
    const from = vec(e.from).map((v) => v - inflate) as Vec3
    const to = vec(e.to).map((v) => v + inflate) as Vec3
    const matrix = multiply(parentMatrix.get(id) ?? identity(), around(vec(e.origin), bbRotation(vec(e.rotation))))
    const faces: ModelCube['faces'] = {}
    for (const name of FACES) {
      const f = obj(obj(e.faces)[name])
      const ref = f.texture
      const index = typeof ref === 'number' ? ref : typeof ref === 'string' ? (byUuid.get(ref) ?? -1) : -1
      if (index < 0 || index >= out.textures.length || !Array.isArray(f.uv) || f.uv.length !== 4) continue
      const [w, h] = uvSize[index]
      const uv = f.uv.map((x) => num(x))
      faces[name] = { uv: [uv[0] / w, uv[1] / h, uv[2] / w, uv[3] / h], turns: Math.round(num(f.rotation) / 90) & 3, texture: index }
    }
    out.cubes.push({ from, to, matrix, faces })
    if (out.cubes.length > MAX_CUBES) throw new ModelError('too many cubes')
  }
  return out
}

// ---------------------------------------------------------------- on the player

/**
 * Where a model goes on the player, in the frame of the body part it follows (three.js space of skinview3d:
 * pixels, y up, the player faces +z; head frame at the neck, arm frame at the shoulder). Same steps as Minecraft's
 * head layer and item-in-hand layer, then the model's display transform and the −8 centring of item models.
 */
export function placement(model: ModelData, slot: 'head' | 'righthand' | 'lefthand'): M4 {
  // entity models (Blockbench free/Bedrock): feet at 0, front to the north like item models; follows the body root
  if (model.kind === 'entity') return multiply(translate(0, -24, 0), rotate('y', 180))
  const name: DisplaySlot = slot === 'head' ? 'head' : slot === 'righthand' ? 'thirdperson_righthand' : 'thirdperson_lefthand'
  let d = model.display[name]
  if (!d && slot === 'lefthand' && model.display.thirdperson_righthand) {
    const r = model.display.thirdperson_righthand // MC mirrors the right hand's transform
    d = { rotation: [r.rotation[0], -r.rotation[1], -r.rotation[2]], translation: [-r.translation[0], r.translation[1], r.translation[2]], scale: r.scale }
  }
  const clamp = (v: number, m: number) => Math.max(-m, Math.min(m, v))
  const t = d?.translation ?? [0, 0, 0]
  const s = d?.scale ?? [1, 1, 1]
  const r = d?.rotation ?? [0, 0, 0]
  const shown = multiply(
    translate(clamp(t[0], 80), clamp(t[1], 80), clamp(t[2], 80)),
    multiply(multiply(rotate('x', r[0]), multiply(rotate('y', r[1]), rotate('z', r[2]))), scale(clamp(s[0], 4), clamp(s[1], 4), clamp(s[2], 4))),
  )
  const item = multiply(shown, translate(-8, -8, -8))
  // Minecraft's entity space (y down, facing −z) seen in skinview3d's (y up, facing +z): a half turn around x
  const mc = scale(1, -1, -1)
  if (slot === 'head') return multiply(mc, multiply(translate(0, -4, 0), multiply(rotate('y', 180), multiply(scale(0.625, -0.625, -0.625), item))))
  const side = slot === 'righthand' ? 1 : -1
  // the hand: from the shoulder pivot, as Minecraft's item-in-hand layer
  return multiply(mc, multiply(rotate('x', -90), multiply(rotate('y', 180), multiply(translate(side, 2, -10), item))))
}

/** Reads a model by its file type: .bbmodel, or .json with its PNG textures (and parent models) */
export function readModel(files: ModelFile[]): ModelData {
  const bb = files.find((f) => /\.bbmodel$/i.test(f.name))
  if (bb) return readBbmodel(bb)
  const jsons = files.filter((f) => /\.json$/i.test(f.name))
  if (!jsons.length) throw new ModelError('no .bbmodel or .json model')
  // the main model: the one no other file uses as parent
  const parents = new Set(jsons.map((f) => obj(parseJson(f.content, f.name)).parent).filter((p): p is string => typeof p === 'string').map((p) => baseName(resourceName(p))))
  const main = jsons.find((f) => !parents.has(baseName(f.name))) ?? jsons[0]
  return readJavaModel(main, files)
}
