/**
 * Graphics presets for Minecraft's options.txt, so the game runs smoothly on the player's PC. Only these lines are
 * written (every other setting stays as the player left it); the game reads them when it starts.
 */
export const GRAPHICS_PRESETS = ['low', 'balanced', 'high'] as const
export type GraphicsPreset = (typeof GRAPHICS_PRESETS)[number]

export const PRESET_OPTIONS: Record<GraphicsPreset, Record<string, string>> = {
  low: {
    renderDistance: '6',
    simulationDistance: '5',
    particles: '2', // minimal
    entityDistanceScaling: '0.75',
    biomeBlendRadius: '0',
    entityShadows: 'false',
    renderClouds: '"false"',
    mipmapLevels: '0',
    graphicsMode: '0', // fast
  },
  balanced: {
    renderDistance: '10',
    simulationDistance: '8',
    particles: '1', // decreased
    entityDistanceScaling: '1.0',
    biomeBlendRadius: '1',
    entityShadows: 'true',
    renderClouds: '"fast"',
    mipmapLevels: '2',
    graphicsMode: '1', // fancy
  },
  high: {
    renderDistance: '16',
    simulationDistance: '12',
    particles: '0', // all
    entityDistanceScaling: '1.0',
    biomeBlendRadius: '2',
    entityShadows: 'true',
    renderClouds: '"true"',
    mipmapLevels: '4',
    graphicsMode: '1',
  },
}

/** Lines only changed when the file already has them (their format changes between Minecraft versions). */
const ONLY_IF_PRESENT = new Set(['graphicsMode'])

/** options.txt with the preset's lines replaced (or added at the end); everything else is kept. */
export function withPreset(text: string, preset: GraphicsPreset): string {
  let out = text
  for (const [key, value] of Object.entries(PRESET_OPTIONS[preset])) {
    const line = new RegExp(`^${key}:.*$`, 'm')
    if (line.test(out)) out = out.replace(line, () => `${key}:${value}`)
    else if (!ONLY_IF_PRESENT.has(key)) out = `${out}${out && !out.endsWith('\n') ? '\n' : ''}${key}:${value}\n`
  }
  return out
}

export interface PcProfile {
  ramGb: number
  threads: number
  /** only an Intel graphics chip (built into the processor) */
  integratedGpu: boolean
  recommended: GraphicsPreset
}

/** low: 8 GB of RAM or less, or 4 threads or fewer · balanced: up to 16 GB, or built-in graphics · high: the rest */
export function recommendPreset(ramGb: number, threads: number, integratedGpu: boolean): GraphicsPreset {
  if (ramGb < 8.6 || threads <= 4) return 'low'
  if (ramGb < 16.6 || integratedGpu) return 'balanced'
  return 'high'
}

/**
 * Memory for Minecraft when the player leaves it on automatic: the recommendation for the PC, but never more than
 * what's free right now minus 1.5 GB for Windows (other programs open), and never under 2 GB.
 */
export function autoMemoryMb(recommendedMb: number, freeMb: number): number {
  const room = Math.floor((freeMb - 1536) / 512) * 512
  return Math.max(2048, Math.min(recommendedMb, room))
}

/** The official launcher's garbage collector settings, unless the player chose a collector in their own JVM arguments. */
export const G1_ARGS = ['-XX:+UnlockExperimentalVMOptions', '-XX:+UseG1GC', '-XX:G1NewSizePercent=20', '-XX:G1ReservePercent=20', '-XX:MaxGCPauseMillis=50', '-XX:G1HeapRegionSize=32M']
export const withGcArgs = (custom: string[]): string[] => (custom.some((a) => /^-XX:\+Use\w+GC$/.test(a)) ? custom : [...G1_ARGS, ...custom.filter((a) => a !== '-XX:+UnlockExperimentalVMOptions')])
