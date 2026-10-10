import { BufferAttribute, BufferGeometry, FrontSide, Group, Matrix4, Mesh, MeshStandardMaterial, NearestFilter, SRGBColorSpace, Texture } from 'three'
import type { SkinViewer } from 'skinview3d'
import { applyPoint, placement, type FaceName, type ModelCube, type ModelData, type ModelFile, type Vec3 } from '@shared/models'

/** A model file with its PNG decoded: size and alpha (flat items get side faces from it) */
export async function withAlpha(f: ModelFile): Promise<ModelFile> {
  if (!f.content.startsWith('data:image/png')) return f
  const img = new Image()
  img.src = f.content
  await img.decode()
  const c = document.createElement('canvas')
  c.width = img.width
  c.height = img.height
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0)
  const px = ctx.getImageData(0, 0, img.width, img.height).data
  const alpha = new Uint8Array(img.width * img.height)
  for (let i = 0; i < alpha.length; i++) alpha[i] = px[i * 4 + 3]
  return { ...f, width: img.width, height: img.height, alpha }
}

/** Worn models (launcher 1.4): a ModelData drawn with three.js and attached to the player of a skinview3d viewer. */
export type WornSlot = 'head' | 'righthand' | 'lefthand'

/** The 4 corners of each face as seen from outside: top-left, top-right, bottom-right, bottom-left (Minecraft's UV order) */
function corners(face: FaceName, [x1, y1, z1]: Vec3, [x2, y2, z2]: Vec3): Vec3[] {
  switch (face) {
    case 'north':
      return [[x2, y2, z1], [x1, y2, z1], [x1, y1, z1], [x2, y1, z1]]
    case 'south':
      return [[x1, y2, z2], [x2, y2, z2], [x2, y1, z2], [x1, y1, z2]]
    case 'west':
      return [[x1, y2, z1], [x1, y2, z2], [x1, y1, z2], [x1, y1, z1]]
    case 'east':
      return [[x2, y2, z2], [x2, y2, z1], [x2, y1, z1], [x2, y1, z2]]
    case 'up':
      return [[x1, y2, z1], [x2, y2, z1], [x2, y2, z2], [x1, y2, z2]]
    case 'down':
      return [[x1, y1, z2], [x2, y1, z2], [x2, y1, z1], [x1, y1, z1]]
  }
}

/** One geometry per texture: every face using it */
function geometries(cubes: ModelCube[], textures: number): BufferGeometry[] {
  const parts = Array.from({ length: textures }, () => ({ pos: [] as number[], uv: [] as number[], index: [] as number[] }))
  for (const cube of cubes) {
    for (const [name, face] of Object.entries(cube.faces) as [FaceName, NonNullable<ModelCube['faces'][FaceName]>][]) {
      const part = parts[face.texture]
      if (!part) continue
      const [u1, v1, u2, v2] = face.uv
      const uvs: [number, number][] = [[u1, v1], [u2, v1], [u2, v2], [u1, v2]]
      const base = part.pos.length / 3
      corners(name, cube.from, cube.to).forEach((c, i) => {
        part.pos.push(...applyPoint(cube.matrix, c))
        // a turned texture: corner i shows the UV of corner i − turns; three.js textures are flipped (v up)
        const [u, v] = uvs[(i - face.turns + 4) % 4]
        part.uv.push(u, 1 - v)
      })
      part.index.push(base, base + 3, base + 2, base, base + 2, base + 1)
    }
  }
  return parts.map((p) => {
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(new Float32Array(p.pos), 3))
    g.setAttribute('uv', new BufferAttribute(new Float32Array(p.uv), 2))
    g.setIndex(p.index)
    g.computeVertexNormals()
    return g
  })
}

const loadTexture = (src: string): Promise<Texture> =>
  new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const t = new Texture(img)
      t.magFilter = NearestFilter
      t.minFilter = NearestFilter
      t.generateMipmaps = false
      t.colorSpace = SRGBColorSpace
      t.needsUpdate = true
      resolve(t)
    }
    img.onerror = () => reject(new Error('texture'))
    img.src = src
  })

/** The model as a three.js group, placed for `slot` in its body part's frame */
/** A small correction of where a model sits (catalogue items): pixels of the player and a factor */
export interface ModelAdjust {
  x: number
  y: number
  z: number
  scale: number
}

export async function buildModel(model: ModelData, slot: WornSlot, adjust?: ModelAdjust): Promise<Group> {
  const textures = await Promise.all(model.textures.map((t) => loadTexture(t.src)))
  const group = new Group()
  geometries(model.cubes, textures.length).forEach((geometry, i) => {
    if (!geometry.index?.count) return geometry.dispose()
    const material = new MeshStandardMaterial({ map: textures[i], transparent: true, alphaTest: 1e-5, side: FrontSide })
    group.add(new Mesh(geometry, material))
  })
  group.matrixAutoUpdate = false
  const placed = new Matrix4().fromArray(placement(model, slot))
  // the correction is in the body part's frame: moved, then scaled around where the model sits
  if (adjust) placed.premultiply(new Matrix4().makeScale(adjust.scale, adjust.scale, adjust.scale)).premultiply(new Matrix4().makeTranslation(adjust.x, adjust.y, adjust.z))
  group.matrix.copy(placed)
  group.userData.textures = textures
  return group
}

/** Frees a model's geometries, materials and textures */
export function disposeModel(group: Group): void {
  group.traverse((o) => {
    if (o instanceof Mesh) {
      o.geometry.dispose()
      ;(o.material as MeshStandardMaterial).dispose()
    }
  })
  for (const t of (group.userData.textures as Texture[] | undefined) ?? []) t.dispose()
  group.removeFromParent()
}

/** The body part a slot follows (entity models follow the whole player) */
export function bodyPart(viewer: SkinViewer, model: ModelData, slot: WornSlot): Group {
  if (model.kind === 'entity') return viewer.playerObject.skin
  return slot === 'head' ? viewer.playerObject.skin.head : slot === 'righthand' ? viewer.playerObject.skin.rightArm : viewer.playerObject.skin.leftArm
}
