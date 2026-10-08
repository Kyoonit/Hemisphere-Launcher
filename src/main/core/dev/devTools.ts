import { app, nativeImage, shell, type BrowserWindow } from 'electron'
import { scrypt, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DEFAULT_DEV, STAFF_CODE, STAFF_CODE_SCRYPT, type DevAction, type DevState, type DevUnlockResult } from '@shared/dev'
import type { HemisphereEvent } from '@shared/events'
import type { Feed, NewsItem } from '@shared/feed'
import type { GameState } from '@shared/game'
import type { LauncherUpdateState } from '@shared/launcherUpdate'
import type { ServerStatus } from '@shared/server'
import type { PreflightWarning } from '@shared/settings'
import { gamePaths } from '../game/target'

/**
 * The Developer tab's pretend layer: development builds, or the installed launcher once the staff code was entered on
 * this PC. Otherwise every function returns its input untouched. Settings live in userData/dev-tools.json.
 */
let unlocked = false
export const devEnabled = () => !app.isPackaged || unlocked
export const devUnlocked = () => unlocked

const file = () => join(app.getPath('userData'), 'dev-tools.json')
let state: DevState = { ...DEFAULT_DEV }
let sampleShots: string[] = []
try {
  if (existsSync(file())) {
    const saved = JSON.parse(readFileSync(file(), 'utf8')) as { state?: Partial<DevState>; sampleShots?: string[]; unlocked?: boolean }
    unlocked = saved.unlocked === true
    state = { ...DEFAULT_DEV, ...saved.state }
    sampleShots = saved.sampleShots ?? []
  }
} catch {
  /* fresh */
}
const save = () => writeFile(file(), JSON.stringify({ state, sampleShots, unlocked }, null, 2)).catch(() => {})

export const getDevState = (): DevState => state

// ------------------------------------------------------------------------------ staff code

let failures = 0
let waitUntil = 0

/** Unlocks the tab on this PC when the code matches (the feed's staff code if staff set one, else the built-in one). */
export async function unlockDev(code: unknown, feedCode?: { salt: string; hash: string }): Promise<DevUnlockResult> {
  if (Date.now() < waitUntil) return { ok: false, reason: 'wait', seconds: Math.ceil((waitUntil - Date.now()) / 1000) }
  const target = feedCode ?? STAFF_CODE
  const typed = typeof code === 'string' ? code.trim().toUpperCase().slice(0, 64) : ''
  const derived = await new Promise<Buffer>((resolve, reject) =>
    scrypt(typed, target.salt, STAFF_CODE_SCRYPT.keylen, { N: STAFF_CODE_SCRYPT.N, r: STAFF_CODE_SCRYPT.r, p: STAFF_CODE_SCRYPT.p }, (err, key) => (err ? reject(err) : resolve(key))),
  )
  if (typed && timingSafeEqual(derived, Buffer.from(target.hash, 'hex'))) {
    unlocked = true
    failures = 0
    await save()
    console.log('[dev] Developer tab unlocked on this PC')
    return { ok: true }
  }
  failures++
  if (failures >= 5) {
    waitUntil = Date.now() + 30_000 * 2 ** Math.min(4, failures - 5) // 30 s, then longer
    return { ok: false, reason: 'wait', seconds: Math.ceil((waitUntil - Date.now()) / 1000) }
  }
  return { ok: false, reason: 'wrong' }
}

/** Locks the tab again on this PC (installed launcher) and switches every pretend situation off. */
export async function lockDev(): Promise<void> {
  unlocked = false
  state = { ...DEFAULT_DEV }
  await save()
}

/** Changes some switches; times of sample events and restarts start from now. */
export async function setDevState(patch: Partial<DevState>): Promise<DevState> {
  if (!devEnabled()) return state
  const restarts = (patch.sampleEvents && !state.sampleEvents) || (patch.restart && patch.restart !== state.restart)
  state = { ...state, ...patch, extraNews: Math.max(0, Math.min(15, Math.round(patch.extraNews ?? state.extraNews))), ...(restarts ? { base: Date.now() } : {}) }
  await save()
  return state
}

// ------------------------------------------------------------------------------ the pretend layer

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')

function sampleEvents(base: number): HemisphereEvent[] {
  return [
    { id: 'dev-live', title: { en: 'Spawn party', fr: 'Fête au spawn' }, body: { en: 'Fireworks and music at spawn. Everyone welcome!', fr: 'Feux d’artifice et musique au spawn. Tout le monde est bienvenu !' }, start: iso(base - 30 * 60e3), end: iso(base + 90 * 60e3), where: { en: 'Spawn' } },
    { id: 'dev-soon', title: { en: 'Elytra race', fr: 'Course d’élytres' }, body: { en: 'Fly the ring course, fastest time wins.', fr: 'Traverse le parcours d’anneaux, le meilleur temps gagne.' }, start: iso(base + 16 * 60e3), where: { en: '/warp race' } },
    {
      id: 'dev-later',
      title: { en: 'Build contest: castles', fr: 'Concours de construction : châteaux' },
      body: { en: 'Build the best castle in 3 hours. Prizes for the top 3!', fr: 'Construis le plus beau château en 3 heures. Des prix pour le top 3 !' },
      start: iso(base + 3 * 86400e3),
      end: iso(base + 3 * 86400e3 + 3 * 3600e3),
      where: { en: '/warp contest' },
      link: { label: { en: 'Rules', fr: 'Règles' }, url: 'https://hemispheresurvival.club/rules' },
    },
  ]
}

function extraNews(n: number): NewsItem[] {
  const categories = ['update', 'event', 'server', 'community'] as const
  const today = new Date().toISOString().slice(0, 10)
  return Array.from({ length: n }, (_, i) => ({
    id: `dev-news-${i + 1}`,
    date: today,
    category: categories[i % 4],
    title: { en: `Test news #${i + 1}`, fr: `Actu de test n°${i + 1}` },
    body: { en: 'A news item from the Developer tab, to test the unread badge and the news layout.', fr: 'Une actu du menu Développeur, pour tester le badge non lu et la mise en page.' },
  }))
}

/** The time of day `msFromNow` from now, in this PC's time zone (for a pretend daily restart). */
function restartAt(base: number, msFromNow: number) {
  const d = new Date(base + msFromNow)
  return { time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, durationMin: 10 }
}

export function devFeed(feed: Feed): Feed {
  if (!devEnabled()) return feed
  const s = state
  return {
    ...feed,
    maintenance: s.maintenance ? { active: true, message: { en: 'Developer tab: pretend maintenance.', fr: 'Menu Développeur : maintenance pour de faux.' }, until: iso(Date.now() + 2 * 3600e3) } : feed.maintenance,
    restart: s.restart === 'soon' ? restartAt(s.base, 3 * 60e3) : s.restart === 'now' ? restartAt(s.base, -60e3) : feed.restart,
    news: [...extraNews(s.extraNews), ...feed.news],
    events: s.sampleEvents ? [...sampleEvents(s.base), ...(feed.events ?? [])] : feed.events,
    discordAppId: s.discordAppId || feed.discordAppId,
  }
}

const NAMES = ['Steve', 'Alex', 'Notch', 'Kyo', 'Isildur', 'Noah', 'Luna', 'Max', 'Zoe', 'Leo', 'Mia', 'Hugo']
export function devStatus(status: ServerStatus | null): ServerStatus | null {
  if (!devEnabled() || state.server === 'real') return status
  const base: ServerStatus = status ?? { online: null, playersOnline: null, playersMax: null, version: null, players: [], latencyMs: null, fetchedAt: Date.now() }
  if (state.server === 'offline') return { ...base, online: false, playersOnline: null, players: [], latencyMs: null, fetchedAt: Date.now() }
  if (state.server === 'unknown') return { ...base, online: null, playersOnline: null, players: [], latencyMs: null, fetchedAt: Date.now() }
  const listed = state.server === 'few' ? 3 : 30
  const players = Array.from({ length: listed }, (_, i) => ({ name: `${NAMES[i % NAMES.length]}_${String(i * 7 + 3).padStart(2, '0')}`, uuid: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}` }))
  const online = state.server === 'few' ? 3 : state.server === 'full' ? 420 : 137
  return { ...base, online: true, playersOnline: online, playersMax: 420, players, latencyMs: base.latencyMs ?? 42, version: base.version ?? '26.3', fetchedAt: Date.now() }
}

export function devUpdate(s: LauncherUpdateState): LauncherUpdateState {
  if (!devEnabled()) return s
  switch (state.launcherUpdate) {
    case 'downloading':
      return { phase: 'downloading', version: '9.9.9', ratio: 0.42 }
    case 'ready':
      return { phase: 'ready', version: '9.9.9' }
    case 'error':
      return { phase: 'error', message: 'Developer tab: pretend update error' }
    default:
      return s
  }
}

export const devPreflight = (w: PreflightWarning[]): PreflightWarning[] =>
  devEnabled() && state.preflight
    ? [
        { code: 'lowDisk', value: 1.4 },
        { code: 'lowRam', value: 4 },
      ]
    : w

// ------------------------------------------------------------------------------ actions

export interface DevActionHooks {
  window(): BrowserWindow | null
  /** closes the window to free memory, as when Minecraft starts */
  release(): void
  /** a pretend "session over" recap on Home */
  sampleRecap(): void
  gameState(patch: Partial<GameState>): void
  notify(kind: 'back' | 'event' | 'warn15' | 'warn1' | 'start'): void
  discord(on: boolean): Promise<'ok' | 'noAppId' | 'noDiscord' | 'invalidId' | 'failed'>
  resetSeen(): Promise<void>
  /** warn15 → warn1 → server down → back, over about 40 s (notifications follow the restart alerts settings) */
  simulateRestart(): Promise<void>
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function runDevAction(action: DevAction, h: DevActionHooks): Promise<string> {
  if (!devEnabled()) return 'not available'
  switch (action) {
    case 'crash':
      h.gameState({
        phase: 'idle',
        error: {
          code: 'crashed',
          detail: 'Developer tab: pretend crash',
          suspects: ['sodium', 'iris'],
          incompatible: [{ name: 'Jade', version: '26.3.5', needs: 'Minecraft 26.4' }],
        },
      })
      return 'crash card shown on Home'
    case 'crash:memory':
      h.gameState({ phase: 'idle', error: { code: 'crashed', detail: 'Developer tab: pretend out of memory', outOfMemory: { memoryMb: 4096 } } })
      return 'out-of-memory crash card shown on Home'
    case 'crash:many':
      h.gameState({
        phase: 'idle',
        error: {
          code: 'crashed',
          detail: 'Developer tab: pretend crash, many mods',
          suspects: ['sodium', 'iris', 'lithium', 'modmenu', 'xaeros-minimap', 'voicechat'],
          incompatible: ['Jade', 'Xaero’s Minimap', 'Simple Voice Chat', 'Mod Menu', 'Lithium', 'Entity Culling', 'Zoomify', 'AppleSkin'].map((name, i) => ({ name, version: `26.3.${i + 1}`, needs: i % 2 ? 'Fabric Loader 0.19' : 'Minecraft 26.4' })),
        },
      })
      return 'crash card with 8 incompatible mods shown on Home'
    case 'clearError':
      h.gameState({ error: null, phase: 'idle', progress: null, activity: null, background: false })
      return 'cleared'
    case 'progress': {
      const stages = ['account', 'minecraft', 'java', 'fabric', 'mods', 'launching'] as const
      for (const stage of stages)
        for (let r = 0; r <= 1; r += 0.25) {
          h.gameState({ phase: 'preparing', activity: 'play', progress: { stage, ratio: stage === 'account' || stage === 'launching' ? null : r, detail: stage === 'mods' ? `Sodium · ${Math.round(r * 4) + 1}/5` : undefined } })
          await wait(350)
        }
      h.gameState({ phase: 'idle', activity: null, progress: null })
      return 'progress shown'
    }
    case 'background':
      h.gameState({ background: true, progress: { stage: 'mods', ratio: 0.5 } })
      await wait(6000)
      h.gameState({ background: false, progress: null })
      return 'background preparation shown'
    case 'restart:simulate':
      void h.simulateRestart()
      return 'restart: 15 min and 1 min warnings now, server down for 25 s, then back (Home and notifications)'
    case 'notify:all':
      for (const kind of ['back', 'event', 'warn15', 'warn1', 'start'] as const) {
        h.notify(kind)
        await wait(2500)
      }
      return 'every notification sent, 2.5 s apart (restart ones follow your restart alerts settings)'
    case 'recap:sample':
      h.sampleRecap()
      h.gameState({}) // Home looks for a recap when the game state changes
      return 'session recap shown on Home (1 h 23 min, 4 screenshots)'
    case 'release:test':
      // as when Minecraft starts: the page closes to free its memory; a notification a little later reopens it
      setTimeout(() => h.release(), 1500)
      setTimeout(() => h.notify('event'), 15_000)
      return 'the window closes in 1.5 s to free its memory; click the notification (in 15 s) or the tray icon to bring it back'
    case 'ui:reload':
      h.window()?.webContents.reloadIgnoringCache()
      return 'reloaded'
    case 'ui:devtools':
      h.window()?.webContents.openDevTools({ mode: 'detach' })
      return 'DevTools opened'
    case 'notify:back':
    case 'notify:event':
      h.notify(action === 'notify:back' ? 'back' : 'event')
      return 'notification sent'
    case 'discord:test': {
      const r = await h.discord(true)
      return {
        ok: 'Discord status set: look at your profile in Discord (it shows while this launcher runs)',
        noAppId: 'No Discord application id: enter yours above (or staff publish theirs in the feed)',
        noDiscord: 'Discord isn’t running on this PC (the desktop app, not the browser): open it and try again',
        invalidId: 'Discord says this isn’t an application id: copy the “Application ID” from discord.com/developers/applications',
        failed: 'Discord didn’t accept the status (see the launcher log)',
      }[r]
    }
    case 'discord:clear':
      await h.discord(false)
      return 'Discord status cleared'
    case 'shots:add':
      return addSampleShots()
    case 'shots:remove':
      return removeSampleShots()
    case 'reset:seen':
      await h.resetSeen()
      return 'news, “What’s new” and the import card will show again'
    case 'open:data':
      await shell.openPath(app.getPath('userData'))
      return 'opened'
    default:
      if (action.startsWith('error:')) {
        h.gameState({ phase: 'idle', error: { code: action.slice(6) as never, detail: 'Developer tab: pretend error' } })
        return 'error shown on Home'
      }
      if (action.startsWith('zoom:')) {
        h.window()?.webContents.setZoomFactor(Number(action.slice(5)))
        return `interface zoom ${Math.round(Number(action.slice(5)) * 100)} %`
      }
      if (action.startsWith('window:')) {
        const [w, hgt] = action.slice(7).split('x').map(Number)
        const win = h.window()
        if (win) {
          if (win.isMaximized()) win.unmaximize()
          win.setSize(w, hgt)
          win.center()
        }
        return `window ${w}×${hgt}`
      }
      return 'unknown action'
  }
}

/** Six sample screenshots over three days (grouping, viewer, copy, delete), each a colour with a band. */
async function addSampleShots(): Promise<string> {
  const dir = join(gamePaths().instance, 'screenshots')
  await mkdir(dir, { recursive: true })
  const colours = [
    [46, 139, 87],
    [70, 130, 180],
    [205, 133, 63],
    [106, 90, 205],
    [205, 92, 92],
    [0, 139, 139],
  ]
  const now = Date.now()
  const offsets = [5, 40, 90, 26 * 60, 27 * 60, 5 * 24 * 60] // minutes ago
  const pad = (n: number) => String(n).padStart(2, '0')
  for (const [i, [r, g, b]] of colours.entries()) {
    const w = 960
    const hgt = 540
    const px = Buffer.alloc(w * hgt * 4)
    for (let y = 0; y < hgt; y++)
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4
        const band = y > hgt * 0.62 && y < hgt * 0.74
        const shade = 0.75 + (0.25 * x) / w
        px[o] = Math.round((band ? 240 : b) * shade) // BGRA
        px[o + 1] = Math.round((band ? 240 : g) * shade)
        px[o + 2] = Math.round((band ? 240 : r) * shade)
        px[o + 3] = 255
      }
    const d = new Date(now - offsets[i] * 60e3)
    const name = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}.png`
    await writeFile(join(dir, name), nativeImage.createFromBitmap(px, { width: w, height: hgt }).toPNG())
    if (!sampleShots.includes(name)) sampleShots.push(name)
  }
  await save()
  return '6 sample screenshots added'
}

async function removeSampleShots(): Promise<string> {
  const dir = join(gamePaths().instance, 'screenshots')
  for (const name of sampleShots) await rm(join(dir, name), { force: true })
  const n = sampleShots.length
  sampleShots = []
  await save()
  return `${n} sample screenshots removed`
}

/** Is this a Discord application id (with rich presence)? Discord's public endpoint gives its name. */
export async function checkDiscordAppId(id: string): Promise<{ ok: true; name: string } | { ok: false; reason: 'notApp' | 'network' }> {
  if (!/^\d{17,20}$/.test(id)) return { ok: false, reason: 'notApp' }
  try {
    const res = await fetch(`https://discord.com/api/v10/applications/${id}/rpc`, { signal: AbortSignal.timeout(8000) })
    if (res.status === 404 || res.status === 400) return { ok: false, reason: 'notApp' }
    if (!res.ok) return { ok: false, reason: 'network' }
    const body = (await res.json()) as { name?: unknown }
    return { ok: true, name: typeof body.name === 'string' ? body.name.slice(0, 64) : id }
  } catch {
    return { ok: false, reason: 'network' }
  }
}
