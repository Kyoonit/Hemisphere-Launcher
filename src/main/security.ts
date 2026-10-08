import { app, ipcMain, session, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'

/**
 * Process-wide hardening (Electron security checklist):
 * - no web permissions (camera, microphone, notifications, geolocation…): the UI needs none
 * - no new windows, navigation or <webview> in any web contents, not just the main window
 * - IPC is only answered for the launcher's own page in its main window
 */
export function hardenApp(): void {
  const ses = session.defaultSession
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  ses.setPermissionCheckHandler(() => false)

  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-attach-webview', (e) => e.preventDefault())
    contents.on('will-navigate', (e) => e.preventDefault())
    contents.on('will-redirect', (e) => e.preventDefault())
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
