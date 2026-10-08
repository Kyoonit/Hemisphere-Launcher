import { app, Menu, nativeImage, Notification, Tray, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import type { Feed } from '@shared/feed'
import { LINKS } from '@shared/ipc'
import { localize } from '@shared/manifest'
import { eventEnd, REMINDER_MINUTES } from '@shared/events'
import type { ServerStatus } from '@shared/server'
import type { Settings } from '@shared/settings'
import { getSettings, updateSettings } from '../settings/settings'
import { DiscordPresence } from './discordRpc'

/**
 * Community, quietly: nothing here runs unless the player switched it on.
 *   - tray icon (closing the window keeps the launcher there) with the server status and Open / Play / Quit
 *   - one notification for an event the player asked to be reminded of
 *   - one notification when the server is back after a restart or maintenance
 *   - "Playing on Hemisphere SMP" in Discord while the game runs (needs the staff's Discord application id)
 */

const TEXT = {
  en: {
    open: 'Open the launcher',
    play: 'Play',
    quit: 'Quit',
    online: (n: number | null, max: number | null) => `Online${n !== null ? ` · ${n}${max ? `/${max}` : ''} players` : ''}`,
    offline: 'Offline',
    unknown: 'Status unknown',
    maintenance: 'Maintenance',
    backTitle: 'Hemisphere is back online',
    backBody: 'The server is up again: you can join.',
    eventSoon: (min: number) => `Starts in ${min} min`,
    eventNow: 'Starting now',
    playing: 'Playing on Hemisphere SMP',
    website: 'Hemisphere SMP',
    discord: 'Join the Discord',
  },
  fr: {
    open: 'Ouvrir le launcher',
    play: 'Jouer',
    quit: 'Quitter',
    online: (n: number | null, max: number | null) => `En ligne${n !== null ? ` · ${n}${max ? `/${max}` : ''} joueurs` : ''}`,
    offline: 'Hors ligne',
    unknown: 'Statut inconnu',
    maintenance: 'Maintenance',
    backTitle: 'Hemisphere est de retour',
    backBody: 'Le serveur est de nouveau en ligne : tu peux rejoindre.',
    eventSoon: (min: number) => `Commence dans ${min} min`,
    eventNow: 'Ça commence',
    playing: 'Joue sur Hemisphere SMP',
    website: 'Hemisphere SMP',
    discord: 'Rejoindre le Discord',
  },
}
const lang = () => {
  const l = getSettings().language
  return (l === 'auto' ? app.getLocale() : l).startsWith('fr') ? 'fr' : 'en'
}
const text = () => TEXT[lang()]

export interface CommunityHooks {
  window(): BrowserWindow | null
  feed(): Feed
  /** PLAY from the tray; false when it can't start now (not signed in, already preparing) */
  play(): boolean
}

const icon = () => nativeImage.createFromPath(join(__dirname, '../../resources/icon.png'))

let hooks: CommunityHooks | null = null
let tray: Tray | null = null
let quitting = false
let lastStatus: ServerStatus | null = null
/** when the server went down (offline, restart or maintenance), null = up or unknown */
let downSince: number | null = null
let presence: DiscordPresence | null = null

function show(): void {
  const win = hooks?.window()
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function notify(title: string, body: string): void {
  if (!Notification.isSupported()) return
  const n = new Notification({ title, body, icon: icon(), silent: false })
  n.on('click', show)
  n.show()
}

// ------------------------------------------------------------------------------ tray

function statusLine(): string {
  const t = text()
  if (hooks?.feed().maintenance.active) return `Hemisphere SMP · ${t.maintenance}`
  const s = lastStatus
  return `Hemisphere SMP · ${!s || s.online === null ? t.unknown : s.online ? t.online(s.playersOnline, s.playersMax) : t.offline}`
}

function refreshTray(): void {
  if (!tray) return
  const t = text()
  tray.setToolTip(statusLine())
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: statusLine(), enabled: false },
      { type: 'separator' },
      { label: t.open, click: show },
      {
        label: t.play,
        click: () => {
          if (hooks?.play()) show()
        },
      },
      { type: 'separator' },
      {
        label: t.quit,
        click: () => {
          quitting = true
          app.quit()
        },
      },
    ]),
  )
}

function applyTray(on: boolean): void {
  if (on && !tray) {
    tray = new Tray(icon().resize({ width: 16, height: 16 }))
    tray.on('click', show)
    refreshTray()
  } else if (!on && tray) {
    tray.destroy()
    tray = null
    // nothing left to bring a hidden window back: show it
    const win = hooks?.window()
    if (win && !win.isVisible()) win.show()
  }
}

/** Closing the window hides it in the tray when the player chose so (Quit from the tray really quits). */
export function keepInTrayOnClose(win: BrowserWindow): void {
  win.on('close', (e) => {
    if (quitting || !getSettings().closeToTray || !tray) return
    e.preventDefault()
    win.hide()
  })
}

// ------------------------------------------------------------------------------ notifications

/** Server status from the poller: tray text, and "back online" after a restart or maintenance (if asked for). */
export function onServerStatus(status: ServerStatus): void {
  lastStatus = status
  refreshTray()
  const down = status.online === false || hooks?.feed().maintenance.active === true
  if (down) {
    downSince ??= Date.now()
    return
  }
  if (status.online !== true) return
  // only after a real outage (a missed status check isn't one), and only once
  if (downSince !== null && Date.now() - downSince > 60_000 && getSettings().notifyServerBack) notify(text().backTitle, text().backBody)
  downSince = null
}

/** One notification shortly before each event the player asked for; the reminder is then done. */
async function checkReminders(): Promise<void> {
  const settings = getSettings()
  if (!settings.eventReminders.length || !hooks) return
  const events = hooks.feed().events ?? []
  const now = Date.now()
  const keep: string[] = []
  for (const id of settings.eventReminders) {
    const e = events.find((x) => x.id === id)
    if (!e || eventEnd(e) <= now) continue // gone or over: forget it
    const start = Date.parse(e.start)
    if (now < start - REMINDER_MINUTES * 60_000) {
      keep.push(id)
      continue
    }
    const t = text()
    const min = Math.round((start - now) / 60_000)
    notify(localize(e.title, lang()), [min > 0 ? t.eventSoon(min) : t.eventNow, e.where ? localize(e.where, lang()) : ''].filter(Boolean).join(' · '))
  }
  if (keep.length !== settings.eventReminders.length) await updateSettings({ eventReminders: keep }).catch(() => {})
}

// ------------------------------------------------------------------------------ Discord status

/** The game started: "Playing on Hemisphere SMP" in Discord (if the player turned it on and staff set the app id). */
export function onGameLaunched(minecraft: string | null): void {
  const appId = hooks?.feed().discordAppId
  if (!getSettings().discordStatus || !appId) return
  presence ??= new DiscordPresence(appId)
  const t = text()
  void presence
    .set({
      details: t.playing,
      state: minecraft ? `Minecraft ${minecraft}` : undefined,
      startedAt: Date.now(),
      largeImage: 'logo',
      largeText: 'Hemisphere SMP',
      buttons: [
        { label: t.website, url: LINKS.website },
        { label: t.discord, url: LINKS.discord },
      ],
    })
    .catch(() => {})
}

export function onGameExited(anyRunning: boolean): void {
  if (anyRunning || !presence) return
  void presence
    .set(null)
    .catch(() => {})
    .finally(() => {
      presence?.close()
      presence = null
    })
}

// ------------------------------------------------------------------------------ start

export function startCommunity(h: CommunityHooks): void {
  hooks = h
  app.on('before-quit', () => (quitting = true))
  applyTray(getSettings().closeToTray)
  setInterval(() => void checkReminders(), 30_000).unref()
  void checkReminders()
}

export function onCommunitySettings(s: Settings): void {
  applyTray(s.closeToTray)
  refreshTray() // language may have changed
  if (!s.discordStatus && presence) onGameExited(false)
}
