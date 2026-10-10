/**
 * Herald, main process. Holds the session token (encrypted by Windows with safeStorage, never given to the page) and
 * talks to the Herald server for the interface. Local settings (time zones) stay on this PC.
 */
import { app, BrowserWindow, clipboard, ClipboardItem, dialog, ipcMain, nativeImage, safeStorage, shell } from 'electron'
import { createDecipheriv, createHash, createPublicKey, randomBytes, scrypt, verify } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { ApiResult, LocalSettings, Profile, TraceResult } from '@herald/api'
import { allowedFileName, MAX_FILE_BYTES, MAX_FILES, MAX_FILES_BYTES, type CatalogueItem } from '@shared/heraldCatalogue'
import { installUpdate, startUpdater, updateState } from './updater'
import { staffCodeFrom } from '@shared/heraldPublic'
import { STAFF_CODE_SCRYPT } from '@shared/dev'
import { CONTENT_BASE, ClientManifestSchema, ContentIndexSchema, PACK_BASES } from '@shared/manifest'
import { FEED_V2_SEALED_PATH, FeedV2Schema, VaultItemSchemas, type FeedV2 } from '@shared/feedV2'
import { fromB64, keyIdOf, unseal, type SealedDocument } from '@shared/sealed'
import type { OpenedItems } from '@shared/schedule'
import { CONTENT_PUBLIC_KEY } from '../../../../src/main/core/remote/publicKey'
import TEST_PUBLIC_KEY from '../../../server/test-public-key.txt?raw'
import { compatibleVersions, fabricLoadersUrl, MAX_PACK_FILE, modrinthGetter, MOJANG_VERSIONS, newestVersions, packReadiness, resolvePack, searchMods, type DraftMod } from '@shared/heraldPack'

/** The production server (releases); a test build points elsewhere with MAIN_VITE_HERALD_SERVER (staging, local). */
const PRODUCTION = 'https://herald.hemisphere-launcher.workers.dev'
const SERVER = (import.meta.env?.MAIN_VITE_HERALD_SERVER || PRODUCTION).replace(/\/$/, '')
// A test build keeps its own session and settings: a staging token never replaces the production one
if (SERVER !== PRODUCTION) app.setPath('userData', `${app.getPath('userData')}-test`)
/** Mojang's default skin (Steve), for the catalogue studio */
const STEVE = '31f477eb1a7beee631c2ca64d06f8f68fa93a3386d04452ab27f43acdf1b60cb'
/** Only these server routes can be called from the interface. */
const ALLOWED = [
  /^\/me$/,
  /^\/sync$/,
  /^\/profiles$/,
  /^\/profiles\/p-[a-z0-9-]{1,20}(\/code|\/delete)?$/,
  /^\/publications$/,
  /^\/publications\/[nebw]-[a-z0-9]{12}(\/(status|publish|unpublish|delete|restore|comments|editing|versions\/\d{1,6}))?$/,
  /^\/publish$/,
  /^\/backgrounds$/,
  /^\/settings\/public$/,
  /^\/settings\/history\/(backgrounds|public|templates\.publications)$/,
  /^\/templates\/publications$/,
  /^\/activity(\?[a-z0-9=&._-]{0,200})?$/,
  /^\/pack(\/proposals)?$/,
  /^\/pack\/proposals\/k-[a-z0-9]{10}\/(approve|reject|withdraw)$/,
  /^\/server\/(templates|maintenances|maintenance-now|back-online|restart|history)$/,
  /^\/server\/maintenances\/m-[a-z0-9]{10}\/delete$/,
  /^\/stats\?range=(day|week|month)&zone=[\w%.+-]{1,96}$/,
  /^\/catalogue$/,
  /^\/catalogue\/blocked$/,
  /^\/catalogue\/players\/[0-9a-f]{32}\/block$/,
  // (original files: only through catalogue:saveOriginal, which saves them where the person chooses)
  /^\/catalogue\/c-[a-z0-9]{10}(\/(files|version|status|thumbnail|delete))?(\?version=\d{1,6})?$/,
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

async function call<T>(method: string, path: string, body?: unknown, timeoutMs = 20_000): Promise<ApiResult<T>> {
  try {
    const res = await fetch(SERVER + path, {
      method,
      signal: AbortSignal.timeout(timeoutMs),
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
  // Sealed content (S12): opened like a launcher opens it, with the key the Herald server gives while it is online
  const fetchBytes = async (url: string) => {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000), cache: 'no-store' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return new Uint8Array(await res.arrayBuffer())
  }
  const openSealed = async (bytes: Uint8Array): Promise<SealedDocument> => {
    const id = keyIdOf(bytes)
    if (!id) throw new Error('not a sealed file')
    const res = await fetch(`${SERVER}/content-key/${id}`, { signal: AbortSignal.timeout(15_000), cache: 'no-store' })
    const body = (await res.json().catch(() => ({}))) as { key?: string }
    if (!res.ok || !body.key) throw new Error(res.status === 410 ? 'its key was replaced (an older copy)' : `its key is not given (HTTP ${res.status})`)
    return JSON.parse(new TextDecoder().decode(await unseal(bytes, fromB64(body.key)))) as SealedDocument
  }
  const openFile = async (url: string, f: { sha512: string; size: number; key: string }) => {
    const bytes = await fetchBytes(url)
    if (createHash('sha512').update(bytes).digest('hex') !== f.sha512) throw new Error('file does not match')
    return Buffer.from(await unseal(bytes, fromB64(f.key)))
  }
  ipcMain.handle('pack:online', async (_e, base: unknown) => {
    // Herald's content repository first (sealed), then where the pack was published before (in clear, until it moves)
    const bases = [...new Set([...(typeof base === 'string' && (PACK_BASES as readonly string[]).includes(base) ? [base] : []), CONTENT_BASE])]
    for (const from of bases) {
      try {
        let text: string
        let manifestBytes: Buffer
        if (from === CONTENT_BASE) {
          text = Buffer.from(await fetchBytes(from + 'index.json')).toString('utf8')
          manifestBytes = Buffer.from(await fetchBytes(from + ContentIndexSchema.parse(JSON.parse(text)).latest.manifest))
        } else {
          const doc = await openSealed(await fetchBytes(from + 'index.bin'))
          text = doc.doc
          const entry = doc.files?.[ContentIndexSchema.parse(JSON.parse(text)).latest.manifest]
          if (!entry) continue
          manifestBytes = await openFile(from + entry.path, entry)
        }
        const index = ContentIndexSchema.parse(JSON.parse(text))
        if (createHash('sha512').update(manifestBytes).digest('hex') !== index.latest.sha512) continue
        return { index, manifest: ClientManifestSchema.parse(JSON.parse(manifestBytes.toString('utf8'))), from }
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
      const data = (await res.json().catch(() => ({}))) as { sha512: string; size: number; url: string; seal: { key: string; sha512: string; size: number }; error?: string }
      return res.ok ? { ok: true, data: { name: basename(pick.filePaths[0]), sha512: data.sha512, size: data.size, url: data.url, seal: data.seal } } : { ok: false, status: res.status, error: data.error ?? `HTTP ${res.status}` }
    } catch {
      return { ok: false, status: 0, error: 'The Herald server cannot be reached. Check your internet connection.' }
    }
  })
  // ---------------------------------------------------------------- catalogue (launcher 1.4)
  // New files for an item (its next version): picked here, sent to the server, never kept on this PC
  ipcMain.handle('catalogue:addFiles', async (_e, id: unknown) => {
    if (typeof id !== 'string' || !/^c-[a-z0-9]{10}$/.test(id)) return { ok: false, status: 400, error: 'Unknown item.' }
    const pick = await dialog.showOpenDialog(win!, { title: 'Model files (.bbmodel, or .json with its .png) or a skin (.png)', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Blockbench / Minecraft model, skin', extensions: ['bbmodel', 'json', 'png'] }] })
    if (pick.canceled || !pick.filePaths.length) return null
    if (pick.filePaths.length > MAX_FILES) return { ok: false, status: 400, error: `${MAX_FILES} files at most.` }
    const files: { name: string; data: string }[] = []
    let total = 0
    for (const path of pick.filePaths) {
      const size = (await stat(path)).size
      total += size
      if (size > MAX_FILE_BYTES || total > MAX_FILES_BYTES) return { ok: false, status: 413, error: 'These files are too big (4 MB each, 8 MB together).' }
      files.push({ name: basename(path), data: (await readFile(path)).toString('base64') })
    }
    return call<CatalogueItem>('POST', `/catalogue/${id}/files`, { files }, 120_000)
  })
  // The original files (Owner, or Admins given it): saved in the folder the person chooses, the download is in the journal
  ipcMain.handle('catalogue:saveOriginal', async (_e, id: unknown, version: unknown) => {
    if (typeof id !== 'string' || !/^c-[a-z0-9]{10}$/.test(id) || !Number.isInteger(version)) return { ok: false, status: 400, error: 'Unknown item.' }
    const pick = await dialog.showOpenDialog(win!, { title: 'Save the original files in…', properties: ['openDirectory', 'createDirectory'] })
    if (pick.canceled || !pick.filePaths[0]) return null
    const res = await call<{ version: number; files: { name: string; data: string }[] }>('GET', `/catalogue/${id}/original?version=${version}`, undefined, 120_000)
    if (!res.ok) return res
    let saved = 0
    for (const f of res.data.files) {
      if (!allowedFileName(f.name)) continue
      let target = join(pick.filePaths[0], f.name)
      for (let i = 2; existsSync(target); i++) target = join(pick.filePaths[0], f.name.replace(/(\.[a-z]+)$/i, ` (${i})$1`))
      await writeFile(target, Buffer.from(f.data, 'base64'))
      saved++
    }
    return { ok: true, data: { saved, folder: pick.filePaths[0] } }
  })
  // A texture found elsewhere (a leak): who it was given to, from the mark hidden in it. Picked here, sent, not kept.
  ipcMain.handle('catalogue:trace', async () => {
    const pick = await dialog.showOpenDialog(win!, { title: 'A texture found elsewhere (PNG, as found)', properties: ['openFile'], filters: [{ name: 'PNG picture', extensions: ['png'] }] })
    if (pick.canceled || !pick.filePaths[0]) return null
    if ((await stat(pick.filePaths[0])).size > MAX_FILE_BYTES) return { ok: false, status: 413, error: 'This picture is too big (4 MB at most).' }
    return call<TraceResult>('POST', '/catalogue/trace', { data: (await readFile(pick.filePaths[0])).toString('base64') }, 60_000)
  })
  // Studio pictures (to share on Discord): saved as PNG, or copied to paste straight into a message
  ipcMain.handle('catalogue:saveImage', async (_e, bytes: unknown, name: unknown) => {
    if (!(bytes instanceof Uint8Array) || bytes.length > 32 * 1024 * 1024) return false
    const safe = (typeof name === 'string' ? name : 'Hemisphere').replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'Hemisphere'
    const pick = await dialog.showSaveDialog(win!, { title: 'Save the picture', defaultPath: `${safe}.png`, filters: [{ name: 'PNG', extensions: ['png'] }] })
    if (pick.canceled || !pick.filePath) return false
    await writeFile(pick.filePath, bytes)
    return true
  })
  ipcMain.handle('catalogue:copyImage', async (_e, bytes: unknown) => {
    if (!(bytes instanceof Uint8Array) || bytes.length > 32 * 1024 * 1024 || nativeImage.createFromBuffer(Buffer.from(bytes)).isEmpty()) return false
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(bytes)], { type: 'image/png' }) })])
    return true
  })
  // Who wears it in the studio: any player's skin (Mojang, public), textures from Mojang's texture server only
  ipcMain.handle('catalogue:player', async (_e, name: unknown) => {
    if (typeof name !== 'string' || !/^[A-Za-z0-9_]{1,16}$/.test(name)) return null
    try {
      const get = (url: string) => fetch(url, { signal: AbortSignal.timeout(15_000) })
      const texture = async (url?: string) => {
        const hash = url ? /^https?:\/\/textures\.minecraft\.net\/texture\/([0-9a-f]{16,80})$/.exec(url)?.[1] : null
        if (!hash) return null
        const res = await get(`https://textures.minecraft.net/texture/${hash}`)
        const bytes = Buffer.from(await res.arrayBuffer())
        return res.ok && bytes.length < 512 * 1024 && bytes.subarray(1, 4).toString('ascii') === 'PNG' ? `data:image/png;base64,${bytes.toString('base64')}` : null
      }
      // Steve: Mojang's default skin
      if (name.toLowerCase() === 'steve') return { name: 'Steve', skin: await texture(`https://textures.minecraft.net/texture/${STEVE}`), slim: false, cape: null }
      const who = await get(`https://api.mojang.com/users/profiles/minecraft/${name}`)
      if (!who.ok) return null
      const { id, name: real } = (await who.json()) as { id: string; name: string }
      if (!/^[0-9a-f]{32}$/.test(id)) return null
      const profile = (await (await get(`https://sessionserver.mojang.com/session/minecraft/profile/${id}`)).json()) as { properties?: { name: string; value: string }[] }
      const value = profile.properties?.find((p) => p.name === 'textures')?.value
      const tex = value ? (JSON.parse(Buffer.from(value, 'base64').toString('utf8')).textures as { SKIN?: { url: string; metadata?: { model?: string } }; CAPE?: { url: string } }) : {}
      const skin = await texture(tex.SKIN?.url ?? `https://textures.minecraft.net/texture/${STEVE}`)
      return skin ? { name: real, skin, slim: tex.SKIN?.metadata?.model === 'slim', cape: await texture(tex.CAPE?.url) } : null
    } catch {
      return null
    }
  })
  // What launchers really get now: the feed at the pulse's commit, its signature, the vaults whose time has come
  ipcMain.handle('online:state', async () => {
    const staging = SERVER.includes('staging') || SERVER.includes('127.0.0.1')
    const key = createPublicKey({ key: Buffer.from((staging ? TEST_PUBLIC_KEY : CONTENT_PUBLIC_KEY).trim(), 'base64'), format: 'der', type: 'spki' })
    const out = { checkedAt: Date.now(), pulse: null, feed: null, signed: false, error: null, opened: {}, pictures: {}, base: null, branchUpToDate: null, pack: null } as {
      checkedAt: number; pulse: { sequence: number; commit: string | null } | null; feed: FeedV2 | null; signed: boolean; error: string | null; opened: OpenedItems; pictures: Record<string, Uint8Array>; base: string | null; branchUpToDate: boolean | null; pack: { clientVersion: string; minecraft: string; sequence: number } | null
    }
    try {
      const pulse = (await (await fetch(`${SERVER}/pulse`, { signal: AbortSignal.timeout(15_000), cache: 'no-store' })).json()) as { sequence: number; commit: string | null; repo: string; dir: string }
      out.pulse = { sequence: pulse.sequence, commit: pulse.commit }
      const branch = `https://raw.githubusercontent.com/${pulse.repo}/main/${pulse.dir}/`
      const base = pulse.commit && /^[0-9a-f]{40}$/.test(pulse.commit) ? `https://raw.githubusercontent.com/${pulse.repo}/${pulse.commit}/${pulse.dir}/` : branch
      out.base = base
      // The mod pack online (sealed in Herald's repository, else still where it was before)
      try {
        const doc = await openSealed(await fetchBytes(branch + 'index.bin')).catch(async () => ({ doc: Buffer.from(await fetchBytes(CONTENT_BASE + 'index.json')).toString('utf8') }) as SealedDocument)
        const index = ContentIndexSchema.parse(JSON.parse(doc.doc))
        out.pack = { clientVersion: index.latest.clientVersion, minecraft: index.latest.minecraft, sequence: index.sequence }
      } catch {
        // no pack readable
      }
      const sealed = await fetchBytes(base + FEED_V2_SEALED_PATH).catch(() => null)
      if (!sealed) throw new Error('no feed published at that commit yet')
      // GitHub's plain address: the same file as the pulse's commit, or an older one still cached (up to 5 minutes)
      out.branchUpToDate = await fetchBytes(branch + FEED_V2_SEALED_PATH).then((b) => keyIdOf(b) === keyIdOf(sealed)).catch(() => null)
      const doc = await openSealed(sealed)
      out.signed = verify(null, Buffer.from(doc.doc, 'utf8'), key, Buffer.from(doc.sig, 'base64'))
      if (!out.signed) throw new Error('the signature does not match: launchers refuse this feed')
      const feed = FeedV2Schema.parse(JSON.parse(doc.doc))
      out.feed = feed
      // Pictures of the items shown: sealed, opened with the key the feed gives
      for (const f of [...feed.news.flatMap((n) => (n.imageFile ? [n.imageFile] : [])), ...feed.backgrounds.map((b) => b.image)]) {
        if (!f.seal || out.pictures[f.sha512]) continue
        const plain = await openFile(base + f.path, f.seal).catch(() => null)
        if (plain && createHash('sha512').update(plain).digest('hex') === f.sha512) out.pictures[f.sha512] = new Uint8Array(plain)
      }
      // Vaults whose time has come (by the server clock): opened with their key, like a launcher at that instant
      for (const v of feed.vaults.filter((x) => Date.parse(x.opensAt) <= Date.now())) {
        try {
          const keyB64 = feed.vaultKeys[v.id] ?? ((await (await fetch(`${SERVER}/vault-key/${v.id}`, { cache: 'no-store' })).json()) as { key?: string }).key
          if (!keyB64) continue
          const open = async (file: { path: string; sha512: string }) => {
            const enc = Buffer.from(await fetchBytes(base + file.path))
            if (createHash('sha512').update(enc).digest('hex') !== file.sha512) throw new Error('file does not match the feed')
            const d = createDecipheriv('aes-256-gcm', Buffer.from(keyB64, 'base64'), enc.subarray(0, 12))
            d.setAuthTag(enc.subarray(enc.length - 16))
            return Buffer.concat([d.update(enc.subarray(12, enc.length - 16)), d.final()])
          }
          const plain = await open(v.file)
          if (createHash('sha256').update(plain).digest('hex') !== v.plainSha256) continue
          const item = VaultItemSchemas[v.kind].parse(JSON.parse(plain.toString('utf8'))) as Record<string, unknown>
          ;((out.opened as Record<string, unknown[]>)[v.kind] ??= []).push(item)
          const pic = (item.imageFile ?? item.image) as { sha512: string } | undefined
          if (v.image && pic) {
            const bytesPic = await open(v.image)
            if (createHash('sha512').update(bytesPic).digest('hex') === pic.sha512) out.pictures[pic.sha512] = new Uint8Array(bytesPic)
          }
        } catch {
          // a vault that cannot be opened stays closed, as in a launcher
        }
      }
    } catch (err) {
      out.error = err instanceof Error ? err.message : String(err)
    }
    return out
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
