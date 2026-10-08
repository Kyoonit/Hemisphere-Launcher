/**
 * What the launcher gives Minecraft: its memory and Java's settings. The game's own settings (graphics, view
 * distance…) are the player's: the launcher never changes them.
 */

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
