import { join } from 'node:path'
import { app } from 'electron'

/**
 * What to install. Pinned and tested; moves to the remote client manifest in Phase 8.
 * Minecraft 26.3 + Fabric 0.19.5 + Mojang's Java (java-runtime-epsilon, Java 25) were verified in the Phase 3 spike.
 */
export const TARGET = {
  minecraft: '26.3',
  fabricLoader: '0.19.5',
} as const

/** Folder layout under %APPDATA%/Hemisphere Launcher (location becomes configurable in Phase 13). */
export function gamePaths() {
  const root = app.getPath('userData')
  return {
    root,
    /** Shared Minecraft files: versions/, libraries/, assets/ */
    minecraft: join(root, 'minecraft'),
    /** Managed Java runtimes, one folder per Mojang component */
    runtime: join(root, 'runtime'),
    /** The Hemisphere game folder: saves, options.txt, mods, logs… */
    instance: join(root, 'instance'),
    /** What was installed last time, to skip work on the next launch */
    stateFile: join(root, 'install-state.json'),
  }
}
