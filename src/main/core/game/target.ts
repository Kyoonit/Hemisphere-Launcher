import { join } from 'node:path'
import { app } from 'electron'

/** What to install. Comes from the signed client manifest (content/clients/<version>/manifest.json). */
export interface GameTarget {
  minecraft: string
  fabricLoader: string
}

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
