/** Launcher settings shared by main and renderer. */
import type { RestartAlerts } from './restart'

/** Command-line flag of the Windows startup entry: the launcher then starts minimized. */
export const AUTOSTART_ARG = '--autostart'

export interface Settings {
  /** Connect to Hemisphere straight from the title screen (latest client only) */
  autoJoin: boolean
  /** What the launcher window does once Minecraft has started */
  onGameStart: 'hide' | 'keep' | 'close'
  /** 'auto' follows Windows */
  language: string
  /** Max memory for Minecraft in MB; null = recommended for this PC */
  memoryMb: number | null
  /** Game window size when Minecraft starts */
  resolution: Resolution
  /** Where Minecraft, Java and the Hemisphere instance live; null = default folder */
  gameDir: string | null
  /** Custom javaw.exe; null = Java managed by Hemisphere (recommended) */
  javaPath: string | null
  /** Extra JVM arguments (only -X…, -XX:…, -D… allowed) */
  jvmArgs: string
  /** Open the launcher when Windows starts (installed version only) */
  startWithWindows: boolean
  /** The "coming from another launcher?" card on Home was dismissed */
  importPromptDismissed: boolean
  /** The guided tour: offered on Home until it was done or declined (it can be seen again from Settings > Launcher) */
  tour: 'new' | 'done'
  /** News ids the player has already seen (opening the News page marks them) */
  seenNews: string[]
  /** Client version whose "What's new" was shown or dismissed */
  seenChangelog: string | null
  /** Launcher version whose "What's new" was shown or dismissed (null = first start: nothing to show) */
  seenLauncherVersion: string | null
  /** Light interface (no blur, animations or background changes): auto = on modest PCs */
  lightMode: 'auto' | 'on' | 'off'
  /** Speed limit for the launcher's downloads, in MB/s (0 = no limit) */
  downloadLimit: 0 | 2 | 5 | 10
  /** On a metered connection (phone hotspot, 4G), nothing is downloaded in the background */
  saveDataOnMetered: boolean
  /** Bigger text and buttons: the whole interface is zoomed (100, 110 or 125 %) */
  textSize: 100 | 110 | 125
  /** Install client updates and check files while the launcher is open, so PLAY starts right away */
  backgroundUpdates: boolean
  /** On PCs with two graphics chips: run Minecraft on the high-performance one */
  highPerformanceGpu: boolean
  /** Discord name given in the last problem report (filled in next time) */
  reportDiscord: string
  /** Closing the window keeps the launcher in the system tray (off: closing quits) */
  closeToTray: boolean
  /** "Playing on Hemisphere SMP" in the player's Discord status while the game runs */
  discordStatus: boolean
  /** A Windows notification when the server is back after a restart or maintenance */
  notifyServerBack: boolean
  /** Events the player asked to be reminded of (one notification shortly before each) */
  eventReminders: string[]
  /** Notifications around the daily restart (each opt-in) */
  restartAlerts: RestartAlerts
}

export const RESOLUTIONS = ['auto', '1280x720', '1600x900', '1920x1080', '2560x1440', 'fullscreen'] as const
export type Resolution = (typeof RESOLUTIONS)[number]

export const DEFAULT_SETTINGS: Settings = {
  autoJoin: false,
  onGameStart: 'hide',
  language: 'auto',
  memoryMb: null,
  resolution: 'auto',
  gameDir: null,
  javaPath: null,
  jvmArgs: '',
  startWithWindows: false,
  importPromptDismissed: false,
  tour: 'new',
  seenNews: [],
  seenChangelog: null,
  seenLauncherVersion: null,
  lightMode: 'auto',
  downloadLimit: 5,
  saveDataOnMetered: true,
  textSize: 100,
  backgroundUpdates: true,
  highPerformanceGpu: true,
  reportDiscord: '',
  closeToTray: false,
  discordStatus: false,
  notifyServerBack: false,
  eventReminders: [],
  restartAlerts: { before15: false, before1: false, start: false, back: false },
}

/**
 * Extra JVM arguments: only memory/GC tuning (-X…, -XX:…) and system properties (-D…). Anything else
 * (e.g. -javaagent, -cp, quotes, chained commands) is refused, so a copied "tweak" can't run extra code.
 */
const JVM_ARG = /^(-X[a-zA-Z0-9:+=.,_%-]+|-XX:[+-]?[a-zA-Z0-9]+(=[a-zA-Z0-9:+=.,_%-]+)?|-D[a-zA-Z0-9._-]+(=[a-zA-Z0-9:+=.,_%/@-]*)?)$/

export function parseJvmArgs(text: string): { args: string[]; invalid: string[] } {
  const parts = text.trim().split(/\s+/).filter(Boolean)
  return { args: parts.filter((a) => JVM_ARG.test(a)), invalid: parts.filter((a) => !JVM_ARG.test(a)) }
}

/** Extra info the Settings screen needs about this PC. */
/** Non-blocking hints shown under PLAY. value = free GB (lowDisk) or installed GB (lowRam). */
export interface PreflightWarning {
  code: 'lowDisk' | 'lowRam'
  value: number
}

export interface SystemInfo {
  totalMemoryMb: number
  recommendedMemoryMb: number
  maxMemoryMb: number
  defaultGameDir: string
  gameDir: string
  packaged: boolean
  /** Two or more graphics chips (built-in + gaming card) */
  hybridGpu: boolean
  gpuNames: string[]
}
