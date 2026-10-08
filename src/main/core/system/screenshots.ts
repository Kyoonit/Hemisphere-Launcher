import { app, clipboard, ClipboardItem, nativeImage, protocol, shell } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Screenshot, ScreenshotList } from '@shared/screenshots'
import { gamePaths } from '../game/target'

/**
 * The Screenshots page: Minecraft's screenshots folder (instance/screenshots), newest first.
 * Images reach the page through the hemi-shot:// scheme, which only ever serves .png files from that folder:
 *   hemi-shot://thumb/<file>  small JPEG (made once, cached on disk)
 *   hemi-shot://full/<file>   the original
 */
export const SCHEME = 'hemi-shot'
const THUMB_WIDTH = 480

const dir = () => join(gamePaths().instance, 'screenshots')
const thumbDir = () => join(app.getPath('userData'), 'screenshot-thumbs')

/** A screenshot file name as Minecraft writes it (no folders, no odd characters). */
export const isScreenshotName = (name: string) => /^[\w .()+-]{1,120}\.png$/i.test(name) && !name.startsWith('.')

/** Must be called before the app is ready. */
export function registerScreenshotScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }])
}

export function serveScreenshots(): void {
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url)
    const name = decodeURIComponent(url.pathname.replace(/^\//, ''))
    if (!isScreenshotName(name)) return new Response('not found', { status: 404 })
    const file = join(dir(), name)
    if (!existsSync(file)) return new Response('not found', { status: 404 })
    try {
      if (url.hostname === 'full') return new Response(await readFile(file), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' } })
      if (url.hostname === 'thumb') return new Response(thumbnail(file, name), { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'max-age=31536000' } })
    } catch (err) {
      console.warn('[screenshots] could not serve', name, err)
    }
    return new Response('not found', { status: 404 })
  })
}

/** Small JPEG of a screenshot, made once per file version and kept in the launcher's data folder. */
function thumbnail(file: string, name: string): Buffer {
  const st = statSync(file)
  const cached = join(thumbDir(), `${name}.${Math.round(st.mtimeMs)}.jpg`)
  if (existsSync(cached)) return readFileSync(cached)
  const image = nativeImage.createFromPath(file)
  const jpeg = image.resize({ width: Math.min(THUMB_WIDTH, image.getSize().width || THUMB_WIDTH), quality: 'good' }).toJPEG(82)
  mkdirSync(thumbDir(), { recursive: true })
  writeFileSync(cached, jpeg)
  return jpeg
}

export function listScreenshots(): ScreenshotList {
  const folder = dir()
  if (!existsSync(folder)) return { screenshots: [], totalBytes: 0 }
  const screenshots: Screenshot[] = []
  for (const name of readdirSync(folder)) {
    if (!isScreenshotName(name)) continue
    try {
      const st = statSync(join(folder, name))
      if (!st.isFile()) continue
      // Minecraft names them by date ("2026-10-08_21.14.03.png"); the file time is the fallback
      screenshots.push({ name, takenAt: takenAtFromName(name) ?? st.mtimeMs, size: st.size, version: Math.round(st.mtimeMs) })
    } catch {
      /* vanished meanwhile */
    }
  }
  screenshots.sort((a, b) => b.takenAt - a.takenAt)
  return { screenshots, totalBytes: screenshots.reduce((s, x) => s + x.size, 0) }
}

/** "2026-10-08_21.14.03.png" (or "_2") -> local time of that moment. */
export function takenAtFromName(name: string): number | null {
  const m = name.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})\.(\d{2})\.(\d{2})/)
  if (!m) return null
  const t = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime()
  return Number.isFinite(t) ? t : null
}

const existing = (name: string) => (isScreenshotName(name) && existsSync(join(dir(), name)) ? join(dir(), name) : null)

/** Puts the image on the clipboard (paste straight into Discord). */
export async function copyScreenshot(name: string): Promise<boolean> {
  const file = existing(name)
  if (!file) return false
  const png = await readFile(file)
  await clipboard.write([new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })])
  return true
}

export function showScreenshotInFolder(name: string): void {
  const file = existing(name)
  if (file) shell.showItemInFolder(file)
}

/** To the Recycle Bin (recoverable). */
export async function deleteScreenshot(name: string): Promise<boolean> {
  const file = existing(name)
  if (!file) return false
  await shell.trashItem(file)
  return true
}
