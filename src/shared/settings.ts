/** Launcher settings shared by main and renderer. */

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
  /** News ids the player has already seen (opening the News page marks them) */
  seenNews: string[]
  /** Client version whose "What's new" was shown or dismissed */
  seenChangelog: string | null
  /** Install client updates and check files while the launcher is open, so PLAY starts right away */
  backgroundUpdates: boolean
  /** On PCs with two graphics chips: run Minecraft on the high-performance one */
  highPerformanceGpu: boolean
  /** Discord name given in the last problem report (filled in next time) */
  reportDiscord: string
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
  seenNews: [],
  seenChangelog: null,
  backgroundUpdates: true,
  highPerformanceGpu: true,
  reportDiscord: '',
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
