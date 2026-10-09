/**
 * Herald, main process. Holds the session token (encrypted by Windows with safeStorage, never given to the page) and
 * talks to the Herald server for the interface. Local settings (time zones) stay on this PC.
 */
import { app, BrowserWindow, clipboard, ipcMain, safeStorage, shell } from 'electron'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ApiResult, LocalSettings, Profile } from '@herald/api'
import { installUpdate, startUpdater, updateState } from './updater'

/** Staging until the production server exists (S12); a build can point elsewhere with MAIN_VITE_HERALD_SERVER. */
const SERVER = (import.meta.env?.MAIN_VITE_HERALD_SERVER || 'https://herald-staging.hemisphere-launcher.workers.dev').replace(/\/$/, '')
/** Only these server routes can be called from the interface. */
const ALLOWED = [
  /^\/me$/,
  /^\/sync$/,
  /^\/profiles$/,
  /^\/profiles\/p-[a-z0-9-]{1,20}(\/code)?$/,
  /^\/publications$/,
  /^\/publications\/[nbw]-[a-z0-9]{12}(\/(status|publish|unpublish|delete|restore|comments|editing|versions\/\d{1,6}))?$/,
  /^\/publish$/,
  /^\/server\/(templates|maintenances|maintenance-now|back-online|restart|history)$/,
  /^\/server\/maintenances\/m-[a-z0-9]{10}\/delete$/,
]

let win: BrowserWindow | null = null
let token: string | null = null
const sessionFile = () => join(app.getPath('userData'), 'session.bin')
const settingsFile = () => join(app.getPath('userData'), 'settings.json')

async function loadToken(): Promise<void> {
  try {
    const data = await readFile(sessionFile())
    token = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(data) : null
  } catch {
    token = null
  }
}
async function saveToken(next: string | null): Promise<void> {
  token = next
  if (!next) return void (await rm(sessionFile(), { force: true }))
  if (!safeStorage.isEncryptionAvailable()) return // kept in memory only: sign in again next time
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(sessionFile(), safeStorage.encryptString(next))
}

async function call<T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(SERVER + path, {
      method,
      signal: AbortSignal.timeout(20_000),
      headers: { 'content-type': 'application/json', 'user-agent': `Herald/${app.getVersion()}`, ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const data = (await res.json().catch(() => ({}))) as T & { error?: string }
    if (res.ok) return { ok: true, data }
    if (res.status === 401 && token && path !== '/login') {
      await saveToken(null)
      win?.webContents.send('session:ended')
    }
    return { ok: false, status: res.status, error: data.error ?? `HTTP ${res.status}` }
  } catch {
    return { ok: false, status: 0, error: 'The Herald server cannot be reached. Check your internet connection.' }
  }
}

const DEFAULT_SETTINGS: LocalSettings = { timeZone: null, extraZones: ['America/New_York', 'Australia/Sydney', 'UTC'] }
async function readSettings(): Promise<LocalSettings> {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(await readFile(settingsFile(), 'utf8')) }
  } catch {
    return DEFAULT_SETTINGS
  }
}

function registerIpc(): void {
  ipcMain.handle('info', () => ({ version: app.getVersion(), server: SERVER, staging: SERVER.includes('staging') || SERVER.includes('127.0.0.1') }))
  ipcMain.handle('session:current', async (): Promise<Profile | null> => {
    if (!token) return null
    const me = await call<Profile>('GET', '/me')
    return me.ok ? me.data : null
  })
  ipcMain.handle('session:signIn', async (_e, name: unknown, code: unknown): Promise<ApiResult<Profile>> => {
    if (typeof name !== 'string' || typeof code !== 'string') return { ok: false, status: 400, error: 'Name and code expected.' }
    const res = await call<{ token: string; me: Profile }>('POST', '/login', { name, code })
    if (!res.ok) return res
    await saveToken(res.data.token)
    return { ok: true, data: res.data.me }
  })
  ipcMain.handle('session:signOut', async () => {
    if (token) await call('POST', '/logout')
    await saveToken(null)
  })
  ipcMain.handle('api', async (_e, method: unknown, path: unknown, body: unknown) => {
    if (!['GET', 'POST', 'PATCH'].includes(method as string) || typeof path !== 'string' || !ALLOWED.some((r) => r.test(path))) return { ok: false, status: 400, error: 'Not allowed.' }
    return call(method as string, path, body)
  })
  // Pictures: raw bytes both ways (a JSON body would cost the server's CPU budget)
  ipcMain.handle('image:upload', async (_e, bytes: unknown, width: unknown, height: unknown) => {
    if (!(bytes instanceof Uint8Array) || typeof width !== 'number' || typeof height !== 'number') return { ok: false, status: 400, error: 'Picture expected.' }
    try {
      const res = await fetch(`${SERVER}/images`, {
        method: 'POST',
        signal: AbortSignal.timeout(60_000),
        headers: { 'content-type': 'image/webp', 'x-width': String(width), 'x-height': String(height), 'user-agent': `Herald/${app.getVersion()}`, ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: bytes,
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      return res.ok ? { ok: true, data } : { ok: false, status: res.status, error: data.error ?? `HTTP ${res.status}` }
    } catch {
      return { ok: false, status: 0, error: 'The Herald server cannot be reached. Check your internet connection.' }
    }
  })
  const pictures = new Map<string, Uint8Array>()
  ipcMain.handle('image:get', async (_e, id: unknown) => {
    if (typeof id !== 'string' || !/^[0-9a-f]{64}$/.test(id)) return null
    if (pictures.has(id)) return pictures.get(id)
    try {
      const res = await fetch(`${SERVER}/images/${id}`, { signal: AbortSignal.timeout(30_000), headers: token ? { authorization: `Bearer ${token}` } : {} })
      if (!res.ok) return null
      const bytes = new Uint8Array(await res.arrayBuffer())
      pictures.set(id, bytes)
      return bytes
    } catch {
      return null
    }
  })
  ipcMain.handle('settings:get', () => readSettings())
  ipcMain.handle('settings:set', async (_e, patch: Partial<LocalSettings>) => {
    const next = { ...(await readSettings()) }
    if (patch && 'timeZone' in patch) next.timeZone = typeof patch.timeZone === 'string' ? patch.timeZone : null
    if (patch && Array.isArray(patch.extraZones)) next.extraZones = patch.extraZones.filter((z): z is string => typeof z === 'string').slice(0, 6)
    await mkdir(app.getPath('userData'), { recursive: true })
    await writeFile(settingsFile(), JSON.stringify(next, null, 2))
    return next
  })
  ipcMain.on('window:minimize', () => win?.minimize())
  ipcMain.on('window:toggleMaximize', () => (win?.isMaximized() ? win.unmaximize() : win?.maximize()))
  ipcMain.on('window:close', () => win?.close())
  ipcMain.on('copy', (_e, text: unknown) => typeof text === 'string' && clipboard.writeText(text))
  ipcMain.handle('update:state', () => updateState())
  ipcMain.on('update:install', () => installUpdate())
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1100,
    minHeight: 680,
    frame: false,
    show: false,
    backgroundColor: '#111827',
    title: 'Herald',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, webviewTag: false, spellcheck: true },
  })
  // Links open in the browser; the window never navigates away from Herald
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.once('ready-to-show', () => win?.show())
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  win.on('closed', () => (win = null))
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.setAppUserModelId('club.hemispheresurvival.herald')
  app.on('second-instance', () => {
    if (win?.isMinimized()) win.restore()
    win?.focus()
  })
  app.whenReady().then(async () => {
    await loadToken()
    registerIpc()
    createWindow()
    startUpdater(SERVER, () => token, (s) => win?.webContents.send('update:state', s))
  })
  app.on('window-all-closed', () => app.quit())
}
