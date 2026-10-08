/** Launcher settings shared by main and renderer. */
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
export interface SystemInfo {
  totalMemoryMb: number
  recommendedMemoryMb: number
  maxMemoryMb: number
  defaultGameDir: string
  gameDir: string
  packaged: boolean
}
