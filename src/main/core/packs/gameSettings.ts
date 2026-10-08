import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { gamePaths } from '../game/target'

/**
 * The game's own settings for packs, read and written in place (every other line is kept as it is):
 *   options.txt                resourcePacks:[…]  bottom to top: the last one wins
 *   config/iris.properties     shaderPack=…  enableShaders=true|false
 * Never while the game runs: Minecraft and Iris write these files when they close.
 */
const optionsPath = () => join(gamePaths().instance, 'options.txt')
const irisPath = () => join(gamePaths().instance, 'config', 'iris.properties')

async function replaceFile(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(`${path}.tmp`, text)
  await rename(`${path}.tmp`, path)
}

// ------------------------------------------------------------------------------ resource packs (options.txt)

const listLine = (text: string, key: string): string[] => {
  const m = text.match(new RegExp(`^${key}:(.*)$`, 'm'))
  if (!m) return []
  try {
    const v = JSON.parse(m[1]) as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export interface ResourcePackSettings {
  /** Minecraft's list as it is, bottom to top ("vanilla", "fabric", "file/<pack>"…) */
  raw: string[]
  /** pack files/folders that are on, top first */
  active: string[]
  incompatible: string[]
}

export async function readResourcePacks(): Promise<ResourcePackSettings> {
  const text = await readFile(optionsPath(), 'utf8').catch(() => '')
  const raw = listLine(text, 'resourcePacks')
  const files = (list: string[]) => list.filter((e) => e.startsWith('file/')).map((e) => e.slice(5))
  return { raw, active: files(raw).reverse(), incompatible: files(listLine(text, 'incompatibleResourcePacks')) }
}

/**
 * Minecraft's list with the player's packs replaced by `activeTopFirst`, where they were (built-in packs such as
 * "vanilla" or a mod's own pack keep their place).
 */
export function withResourcePacks(raw: string[], activeTopFirst: string[]): string[] {
  const files = [...activeTopFirst].reverse().map((f) => `file/${f}`)
  const firstFile = raw.findIndex((e) => e.startsWith('file/'))
  const others = raw.filter((e) => !e.startsWith('file/'))
  const base = others.length ? others : ['vanilla']
  const at = firstFile < 0 ? base.length : firstFile
  return [...base.slice(0, at), ...files, ...base.slice(at)]
}

export async function writeResourcePacks(activeTopFirst: string[]): Promise<void> {
  const text = await readFile(optionsPath(), 'utf8').catch(() => '')
  const { raw, incompatible } = await readResourcePacks()
  const list = withResourcePacks(raw, activeTopFirst)
  const still = incompatible.filter((f) => activeTopFirst.includes(f)).map((f) => `file/${f}`)
  const set = (src: string, key: string, value: string[]) => {
    const line = `${key}:${JSON.stringify(value)}`
    return new RegExp(`^${key}:.*$`, 'm').test(src) ? src.replace(new RegExp(`^${key}:.*$`, 'm'), () => line) : `${src}${src && !src.endsWith('\n') ? '\n' : ''}${line}\n`
  }
  await replaceFile(optionsPath(), set(set(text, 'resourcePacks', list), 'incompatibleResourcePacks', still))
}

// ------------------------------------------------------------------------------ shaders (Iris)

/** Java .properties values: \: \= \\ and \uXXXX escapes. */
const unescape = (v: string) => v.replace(/\\u([0-9a-fA-F]{4})|\\(.)/g, (_, u: string | undefined, c: string | undefined) => (u ? String.fromCharCode(parseInt(u, 16)) : (c ?? '')))
const escape = (v: string) =>
  v
    .replace(/[\\:=#!]/g, (c) => `\\${c}`)
    .replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
    .replace(/^ /, '\\ ')

export interface ShaderSettings {
  /** the shader pack in use ('' = none) */
  pack: string
  on: boolean
}

export async function readShaders(): Promise<ShaderSettings> {
  const text = await readFile(irisPath(), 'utf8').catch(() => '')
  const get = (key: string) => {
    const m = text.match(new RegExp(`^\\s*${key}\\s*[=:]\\s*(.*)$`, 'm'))
    return m ? unescape(m[1].trim()) : null
  }
  const pack = get('shaderPack') ?? ''
  return { pack, on: (get('enableShaders') ?? 'true') !== 'false' && !!pack }
}

export async function writeShaders(next: ShaderSettings): Promise<void> {
  let text = await readFile(irisPath(), 'utf8').catch(() => '')
  const set = (key: string, value: string) => {
    const line = `${key}=${value}`
    const re = new RegExp(`^\\s*${key}\\s*[=:].*$`, 'm')
    text = re.test(text) ? text.replace(re, () => line) : `${text}${text && !text.endsWith('\n') ? '\n' : ''}${line}\n`
  }
  set('shaderPack', escape(next.pack))
  set('enableShaders', String(next.on && !!next.pack))
  await replaceFile(irisPath(), text)
}
