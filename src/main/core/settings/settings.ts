import { app } from 'electron'
import { readFileSync } from 'node:fs'
import { rename, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { z } from 'zod'
import { DEFAULT_SETTINGS, RESOLUTIONS, parseJvmArgs, type Settings } from '@shared/settings'

/** settings.json in the launcher's data folder. */

const fields = {
  autoJoin: z.boolean(),
  onGameStart: z.enum(['hide', 'keep', 'close']),
  language: z.string().regex(/^(auto|[a-z]{2})$/),
  memoryMb: z.number().int().min(1024).max(65536).nullable(),
  resolution: z.enum(RESOLUTIONS),
  gameDir: z.string().refine(isAbsolute, 'must be an absolute path').nullable(),
  javaPath: z.string().refine((p) => isAbsolute(p) && /javaw?\.exe$/i.test(p), 'must be a java.exe or javaw.exe').nullable(),
  jvmArgs: z.string().max(1000).refine((s) => parseJvmArgs(s).invalid.length === 0, 'unsupported JVM argument'),
  startWithWindows: z.boolean(),
  importPromptDismissed: z.boolean(),
}

/** Loading: a bad or unknown value falls back to its default, field by field (never breaks the launcher). */
const D = DEFAULT_SETTINGS
const LoadSchema = z.object({
  autoJoin: fields.autoJoin.catch(D.autoJoin),
  onGameStart: fields.onGameStart.catch(D.onGameStart),
  language: fields.language.catch(D.language),
  memoryMb: fields.memoryMb.catch(D.memoryMb),
  resolution: fields.resolution.catch(D.resolution),
  gameDir: fields.gameDir.catch(D.gameDir),
  javaPath: fields.javaPath.catch(D.javaPath),
  jvmArgs: fields.jvmArgs.catch(D.jvmArgs),
  startWithWindows: fields.startWithWindows.catch(D.startWithWindows),
  importPromptDismissed: fields.importPromptDismissed.catch(D.importPromptDismissed),
})
/** Updating: invalid values are rejected with an error the UI can show. */
const UpdateSchema = z.object(fields)

const file = () => join(app.getPath('userData'), 'settings.json')
let current: Settings | null = null
let onChange: (s: Settings) => void = () => {}

export function onSettingsChanged(cb: (s: Settings) => void): void {
  onChange = cb
}

export function getSettings(): Settings {
  if (!current) {
    try {
      current = LoadSchema.parse({ ...DEFAULT_SETTINGS, ...JSON.parse(readFileSync(file(), 'utf8')) })
    } catch {
      current = { ...DEFAULT_SETTINGS }
    }
  }
  return current
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = UpdateSchema.parse({ ...getSettings(), ...patch })
  if (next.startWithWindows !== getSettings().startWithWindows && app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: next.startWithWindows })
  }
  current = next
  const tmp = `${file()}.tmp`
  await writeFile(tmp, JSON.stringify(current, null, 2))
  await rename(tmp, file())
  onChange(current)
  return current
}
