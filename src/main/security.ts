import { app, ipcMain, session, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { WEB_PAGES, webPageFor } from '@shared/webPages'

/** The storage of each web page shown in the launcher (nothing shared with the launcher's page); made once the app is ready */
const pageSessions = new Map<string, Electron.Session>()
const partitionOf = (contents: Electron.WebContents) => [...pageSessions].find(([, s]) => s === contents.session)?.[0] ?? null

/**
 * Process-wide hardening (Electron security checklist):
 * - no web permissions (camera, notifications, geolocation…), except the microphone for the launcher's own page
 *   (Settings > Game > test your microphone for voice chat): audio only, never video
 * - no new windows, navigation or <webview> in any web contents, not just the main window. One exception: the
 *   launcher's page may show its web pages in a <webview> (the server's BlueMap, the website's rules: shared/webPages.ts):
 *   those addresses only, each with its own storage, no preload, sandboxed, no permission, never leaving them
 * - IPC is only answered for the launcher's own page in its main window
 */
export function hardenApp(): void {
  const ses = session.defaultSession
  const micOnly = (permission: string, mediaTypes: string[] | undefined, url: string) => permission === 'media' && isLauncherUrl(url) && (mediaTypes ?? []).every((t) => t === 'audio')
  ses.setPermissionRequestHandler((wc, permission, callback, details) => callback(micOnly(permission, (details as { mediaTypes?: string[] }).mediaTypes, wc.getURL())))
  ses.setPermissionCheckHandler((_wc, permission, origin, details) => micOnly(permission, details.mediaType ? [details.mediaType] : undefined, (details as { requestingUrl?: string }).requestingUrl ?? origin))

  for (const { partition } of Object.values(WEB_PAGES)) {
    const s = session.fromPartition(partition)
    pageSessions.set(partition, s)
    s.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
    s.setPermissionCheckHandler(() => false)
  }

  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-attach-webview', (e, prefs, params) => {
      if (!(contents === trustedWindow?.webContents && isLauncherUrl(contents.getURL()) && webPageFor(params.partition, params.src))) return e.preventDefault()
      delete prefs.preload
      prefs.nodeIntegration = false
      prefs.nodeIntegrationInSubFrames = false
      prefs.contextIsolation = true
      prefs.sandbox = true
      prefs.webSecurity = true
      prefs.partition = params.partition
    })
    // a web page moves inside its own addresses only (the map's view, the rules' pages); anything else is refused
    const allowed = (url: string) => {
      const partition = contents.getType() === 'webview' ? partitionOf(contents) : null
      return partition !== null && webPageFor(partition, url) !== null
    }
    contents.on('will-navigate', (e, url) => !allowed(url) && e.preventDefault())
    contents.on('will-redirect', (e, url) => !allowed(url) && e.preventDefault())
    contents.on('will-frame-navigate', (e) => contents.getType() === 'webview' && !allowed(e.url) && e.preventDefault())
    // a site's own router changes the address without loading a page: back to the page's start when it leaves it
    contents.on('did-navigate-in-page', (_e, url, isMainFrame) => {
      const partition = contents.getType() === 'webview' ? partitionOf(contents) : null
      const home = partition && Object.values(WEB_PAGES).find((p) => p.partition === partition)
      if (home && isMainFrame && !allowed(url)) void contents.loadURL(home.url)
    })
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
