/**
 * Herald, main process. Holds the session token (encrypted by Windows with safeStorage, never given to the page) and
 * talks to the Herald server for the interface. Local settings (time zones) stay on this PC.
 */
import { app, BrowserWindow, clipboard, dialog, ipcMain, safeStorage, shell } from 'electron'
import { createHash, randomBytes, scrypt } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { ApiResult, LocalSettings, Profile } from '@herald/api'
import { installUpdate, startUpdater, updateState } from './updater'
import { staffCodeFrom } from '@shared/heraldPublic'
import { STAFF_CODE_SCRYPT } from '@shared/dev'
import { CONTENT_BASE, ClientManifestSchema, ContentIndexSchema, PACK_BASES } from '@shared/manifest'
import { compatibleVersions, fabricLoadersUrl, MAX_PACK_FILE, modrinthGetter, MOJANG_VERSIONS, newestVersions, packReadiness, resolvePack, searchMods, type DraftMod } from '@shared/heraldPack'

/** Staging until the production server exists (S12); a build can point elsewhere with MAIN_VITE_HERALD_SERVER. */
const SERVER = (import.meta.env?.MAIN_VITE_HERALD_SERVER || 'https://herald-staging.hemisphere-launcher.workers.dev').replace(/\/$/, '')
/** Only these server routes can be called from the interface. */
const ALLOWED = [
  /^\/me$/,
  /^\/sync$/,
  /^\/profiles$/,
  /^\/profiles\/p-[a-z0-9-]{1,20}(\/code)?$/,
  /^\/publications$/,
  /^\/publications\/[nebw]-[a-z0-9]{12}(\/(status|publish|unpublish|delete|restore|comments|editing|versions\/\d{1,6}))?$/,
  /^\/publish$/,
  /^\/backgrounds$/,
  /^\/settings\/public$/,
  /^\/pack(\/proposals)?$/,
  /^\/pack\/proposals\/k-[a-z0-9]{10}\/(approve|reject|withdraw)$/,
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
  // Launcher settings: the staff code is made here; only its fingerprint goes to the server, the code is shown once
  ipcMain.handle('launcher:newStaffCode', async (_e, version: unknown) => {
    const code = staffCodeFrom(randomBytes(12))
    const salt = randomBytes(16).toString('hex')
    const { N, r, p, keylen } = STAFF_CODE_SCRYPT
    const hash = await new Promise<string>((resolve, reject) => scrypt(code, salt, keylen, { N, r, p }, (err, key) => (err ? reject(err) : resolve(key.toString('hex')))))
    const res = await call<Record<string, unknown>>('POST', '/settings/public', { version, part: 'staffCode', settings: { staffCode: { salt, hash } } })
    return res.ok ? { ok: true, data: { ...res.data, code } } : res
  })
  ipcMain.handle('launcher:checkDiscord', async (_e, id: unknown) => {
    if (typeof id !== 'string' || !/^\d{17,20}$/.test(id)) return { ok: false, reason: 'notApp' }
    try {
      const res = await fetch(`https://discord.com/api/v10/applications/${id}/rpc`, { signal: AbortSignal.timeout(8000) })
      if (res.status === 404 || res.status === 400) return { ok: false, reason: 'notApp' }
      if (!res.ok) return { ok: false, reason: 'network' }
      const body = (await res.json()) as { name?: unknown }
      return { ok: true, name: typeof body.name === 'string' ? body.name.slice(0, 64) : id }
    } catch {
      return { ok: false, reason: 'network' }
    }
  })
  ipcMain.handle('launcher:latest', async () => {
    try {
      const res = await fetch('https://api.github.com/repos/Kyoonit/Hemisphere-Launcher/releases/latest', { signal: AbortSignal.timeout(8000), headers: { accept: 'application/vnd.github+json', 'user-agent': `Herald/${app.getVersion()}` } })
      const body = (await res.json()) as { tag_name?: unknown }
      return res.ok && typeof body.tag_name === 'string' ? body.tag_name.replace(/^v/, '') : null
    } catch {
      return null
    }
  })
  // Mod pack (S10): Modrinth and GitHub are read from this PC (the server's CPU budget is tiny)
  const modrinth = modrinthGetter(`Kyoonit/Hemisphere-Launcher (Herald ${app.getVersion()})`)
  const failed = (err: unknown) => ({ ok: false, status: 0, error: err instanceof Error && err.message.startsWith('Modrinth') ? `${err.message}: try again in a moment.` : 'Modrinth cannot be reached. Check your internet connection.' })
  const mc = (v: unknown) => typeof v === 'string' && /^[0-9][0-9a-z.\-]{0,31}$/.test(v)
  ipcMain.handle('pack:online', async (_e, base: unknown) => {
    // Herald's content repository first, then where the pack was published before (until it moves)
    const bases = [...new Set([...(typeof base === 'string' && (PACK_BASES as readonly string[]).includes(base) ? [base] : []), CONTENT_BASE])]
    for (const from of bases) {
      try {
        const get = (path: string) => fetch(from + path, { signal: AbortSignal.timeout(15_000), cache: 'no-store' })
        const res = await get('index.json')
        if (!res.ok) continue
        const index = ContentIndexSchema.parse(await res.json())
        const bytes = Buffer.from(await (await get(index.latest.manifest)).arrayBuffer())
        if (createHash('sha512').update(bytes).digest('hex') !== index.latest.sha512) continue
        return { index, manifest: ClientManifestSchema.parse(JSON.parse(bytes.toString('utf8'))), from }
      } catch {
        // next place
      }
    }
    return null
  })
  ipcMain.handle('pack:search', async (_e, query: unknown, minecraft: unknown) => {
    if (typeof query !== 'string' || !mc(minecraft)) return { ok: false, status: 400, error: 'Bad search.' }
    try {
      return { ok: true, data: await searchMods(modrinth, query.slice(0, 80), minecraft as string) }
    } catch (err) {
      return failed(err)
    }
  })
  ipcMain.handle('pack:versions', async (_e, projectId: unknown, minecraft: unknown) => {
    if (typeof projectId !== 'string' || !/^[A-Za-z0-9]{1,16}$/.test(projectId) || !mc(minecraft)) return { ok: false, status: 400, error: 'Bad project.' }
    try {
      const list = await compatibleVersions(modrinth, projectId, minecraft as string)
      return { ok: true, data: list.slice(0, 40).map((v) => ({ id: v.id, number: v.version_number, type: v.version_type, date: v.date_published ?? null })) }
    } catch (err) {
      return failed(err)
    }
  })
  ipcMain.handle('pack:resolve', async (_e, minecraft: unknown, mods: unknown) => {
    if (!mc(minecraft) || !Array.isArray(mods) || mods.length > 300) return { ok: false, status: 400, error: 'Bad pack.' }
    try {
      return { ok: true, data: await resolvePack(modrinth, minecraft as string, mods as DraftMod[]) }
    } catch (err) {
      return failed(err)
    }
  })
  ipcMain.handle('pack:newest', async (_e, minecraft: unknown, mods: unknown) => {
    if (!mc(minecraft) || !Array.isArray(mods) || mods.length > 300) return { ok: false, status: 400, error: 'Bad pack.' }
    try {
      return { ok: true, data: await newestVersions(modrinth, minecraft as string, mods as { projectId: string; beta?: boolean }[]) }
    } catch (err) {
      return failed(err)
    }
  })
  // A new Minecraft: Mojang's releases, Fabric's loaders, which mods are ready
  ipcMain.handle('pack:minecraft', async () => {
    try {
      const res = await fetch(MOJANG_VERSIONS, { signal: AbortSignal.timeout(15_000) })
      if (!res.ok) return null
      const j = (await res.json()) as { latest: { snapshot?: string }; versions: { id: string; type: string; releaseTime: string }[] }
      const releases = j.versions.filter((v) => v.type === 'release').slice(0, 30).map((v) => ({ id: v.id, type: v.type, releaseTime: v.releaseTime, releasedAt: v.releaseTime }))
      return { releases, snapshot: j.latest.snapshot ?? null }
    } catch {
      return null
    }
  })
  ipcMain.handle('pack:fabric', async (_e, minecraft: unknown) => {
    if (!mc(minecraft)) return null
    try {
      const res = await fetch(fabricLoadersUrl(minecraft as string), { signal: AbortSignal.timeout(15_000) })
      if (res.status === 400 || res.status === 404) return []
      if (!res.ok) return null
      return ((await res.json()) as { loader: { version: string; stable: boolean } }[]).map((x) => ({ version: x.loader.version, stable: x.loader.stable }))
    } catch {
      return null
    }
  })
  ipcMain.handle('pack:readiness', async (_e, minecraft: unknown, mods: unknown) => {
    if (!mc(minecraft) || !Array.isArray(mods) || mods.length > 300) return { ok: false, status: 400, error: 'Bad pack.' }
    try {
      return { ok: true, data: await packReadiness(modrinth, minecraft as string, mods) }
    } catch (err) {
      return failed(err)
    }
  })
  ipcMain.handle('pack:addFile', async () => {
    const pick = await dialog.showOpenDialog(win!, { title: 'Add a config file to the pack', properties: ['openFile'] })
    if (pick.canceled || !pick.filePaths[0]) return null
    const bytes = await readFile(pick.filePaths[0])
    if (bytes.length > MAX_PACK_FILE) return { ok: false, status: 413, error: 'Files of the pack are limited to 1 MB here (configs).' }
    try {
      const res = await fetch(`${SERVER}/pack/files`, {
        method: 'POST',
        signal: AbortSignal.timeout(60_000),
        headers: { 'content-type': 'application/octet-stream', 'user-agent': `Herald/${app.getVersion()}`, ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: bytes,
      })
      const data = (await res.json().catch(() => ({}))) as { sha512: string; size: number; error?: string }
      return res.ok ? { ok: true, data: { name: basename(pick.filePaths[0]), sha512: data.sha512, size: data.size } } : { ok: false, status: res.status, error: data.error ?? `HTTP ${res.status}` }
    } catch {
      return { ok: false, status: 0, error: 'The Herald server cannot be reached. Check your internet connection.' }
    }
  })
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
