import { join } from 'node:path'
import { app } from 'electron'
import { getSettings } from '../settings/settings'

/** What to install. Comes from the signed client manifest (content/clients/<version>/manifest.json). */
export interface GameTarget {
  minecraft: string
  fabricLoader: string
}

/** Default game folder (inside the launcher's data folder). */
export const defaultGameDir = () => app.getPath('userData')

/** Folder layout: the default folder, or the one chosen in Settings > Installation. */
export function gamePaths() {
  const root = getSettings().gameDir ?? defaultGameDir()
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
