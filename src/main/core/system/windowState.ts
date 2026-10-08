import { app, screen, type BrowserWindow, type Rectangle } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Remembers the window's size, position and maximized state between launches (window-state.json). */
interface WindowState {
  bounds: Rectangle
  maximized: boolean
}

const file = () => join(app.getPath('userData'), 'window-state.json')
const MIN = { width: 960, height: 600 }

/** Saved bounds, only if they still fit on a connected screen (monitor unplugged, resolution changed). */
export function loadWindowState(): WindowState | null {
  try {
    const s = JSON.parse(readFileSync(file(), 'utf8')) as WindowState
    const b = s.bounds
    if (![b.x, b.y, b.width, b.height].every(Number.isFinite) || b.width < MIN.width || b.height < MIN.height) return null
    const area = screen.getDisplayMatching(b).workArea
    const visible = b.x < area.x + area.width - 100 && b.x + b.width > area.x + 100 && b.y >= area.y - 10 && b.y < area.y + area.height - 100
    if (!visible) return null
    return {
      bounds: { ...b, width: Math.min(b.width, area.width), height: Math.min(b.height, area.height) },
      maximized: s.maximized === true,
    }
  } catch {
    return null
  }
}

export function trackWindowState(win: BrowserWindow, restored: WindowState | null): void {
  let timer: NodeJS.Timeout | undefined
  // Windows rounds bounds at fractional display scaling: keep the restored values while the player hasn't moved
  // or resized, or the window would grow a few pixels on every launch.
  let opened: Rectangle | null = null
  win.once('show', () => setTimeout(() => !win.isDestroyed() && (opened = win.getNormalBounds()), 300))
  const same = (a: Rectangle, b: Rectangle | null) => !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
  const save = () => {
    if (win.isDestroyed() || win.isMinimized()) return
    const current = win.getNormalBounds()
    const bounds = restored && same(current, opened) ? restored.bounds : current
    const state: WindowState = { bounds, maximized: win.isMaximized() }
    try {
      writeFileSync(file(), JSON.stringify(state))
    } catch {
      /* not critical */
    }
  }
  const later = () => {
    clearTimeout(timer)
    timer = setTimeout(save, 500)
  }
  win.on('resize', later)
  win.on('move', later)
  win.on('maximize', save)
  win.on('unmaximize', save)
  win.on('close', () => {
    clearTimeout(timer)
    save()
  })
}
