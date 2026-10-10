import { app, ipcMain, session, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { BLUEMAP } from '@shared/server'

/** The server map's own storage (its view settings): nothing shared with the launcher's page */
export const MAP_PARTITION = 'persist:bluemap'
const MAP_ORIGIN = new URL(BLUEMAP.url).origin
const isMapUrl = (url: string) => {
  try {
    return new URL(url).origin === MAP_ORIGIN
  } catch {
    return false
  }
}

/**
 * Process-wide hardening (Electron security checklist):
 * - no web permissions (camera, notifications, geolocation…), except the microphone for the launcher's own page
 *   (Settings > Game > test your microphone for voice chat): audio only, never video
 * - no new windows, navigation or <webview> in any web contents, not just the main window. One exception: the
 *   launcher's page may show the server's BlueMap in a <webview> (Map screen): that page only, its own storage, no
 *   preload, sandboxed, no permission, and it never leaves the map's address
 * - IPC is only answered for the launcher's own page in its main window
 */
export function hardenApp(): void {
  const ses = session.defaultSession
  const micOnly = (permission: string, mediaTypes: string[] | undefined, url: string) => permission === 'media' && isLauncherUrl(url) && (mediaTypes ?? []).every((t) => t === 'audio')
  ses.setPermissionRequestHandler((wc, permission, callback, details) => callback(micOnly(permission, (details as { mediaTypes?: string[] }).mediaTypes, wc.getURL())))
  ses.setPermissionCheckHandler((_wc, permission, origin, details) => micOnly(permission, details.mediaType ? [details.mediaType] : undefined, (details as { requestingUrl?: string }).requestingUrl ?? origin))

  const map = session.fromPartition(MAP_PARTITION)
  map.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  map.setPermissionCheckHandler(() => false)

  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-attach-webview', (e, prefs, params) => {
      if (!(contents === trustedWindow?.webContents && isLauncherUrl(contents.getURL()) && isMapUrl(params.src) && params.partition === MAP_PARTITION)) return e.preventDefault()
      delete prefs.preload
      prefs.nodeIntegration = false
      prefs.nodeIntegrationInSubFrames = false
      prefs.contextIsolation = true
      prefs.sandbox = true
      prefs.webSecurity = true
      prefs.partition = MAP_PARTITION
    })
    const guest = contents.getType() === 'webview'
    // the map moves inside itself (its address keeps the view); anything else is refused
    contents.on('will-navigate', (e, url) => !(guest && isMapUrl(url)) && e.preventDefault())
    contents.on('will-redirect', (e, url) => !(guest && isMapUrl(url)) && e.preventDefault())
    contents.on('will-frame-navigate', (e) => guest && !isMapUrl(e.url) && e.preventDefault())
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  })
}

let trustedWindow: BrowserWindow | null = null

/** The page the launcher loads: the bundled index.html, or the dev server while developing. */
function isLauncherUrl(url: string): boolean {
  const dev = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined
  if (dev && url.startsWith(new URL(dev).origin + '/')) return true
  return url.split(/[?#]/)[0] === pathToFileURL(join(__dirname, '../renderer/index.html')).href
}

export function trustWindow(win: BrowserWindow): void {
  trustedWindow = win
}

function isTrusted(e: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const frame = e.senderFrame
  return (
    !!frame &&
    !!trustedWindow &&
    !trustedWindow.isDestroyed() &&
    e.sender === trustedWindow.webContents &&
    frame === trustedWindow.webContents.mainFrame &&
    isLauncherUrl(frame.url)
  )
}

/** ipcMain.handle that rejects calls from anything but the launcher page. */
export function handle(channel: string, listener: (e: IpcMainInvokeEvent, ...args: any[]) => unknown): void {
  ipcMain.handle(channel, (e, ...args) => {
    if (!isTrusted(e)) {
      console.warn(`[security] blocked IPC "${channel}" from ${e.senderFrame?.url ?? 'unknown'}`)
      throw new Error('blocked')
    }
    return listener(e, ...args)
  })
}

/** ipcMain.on that ignores messages from anything but the launcher page. */
export function on(channel: string, listener: (e: IpcMainEvent, ...args: any[]) => void): void {
  ipcMain.on(channel, (e, ...args) => {
    if (!isTrusted(e)) {
      console.warn(`[security] blocked IPC "${channel}" from ${e.senderFrame?.url ?? 'unknown'}`)
      return
    }
    listener(e, ...args)
  })
}
