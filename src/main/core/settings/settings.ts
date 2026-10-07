import { app } from 'electron'
import { readFileSync } from 'node:fs'
import { rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { DEFAULT_SETTINGS, type Settings } from '@shared/settings'

/** settings.json in the launcher's data folder. Unknown/invalid values fall back to defaults, field by field. */

const Schema = z.object({
  autoJoin: z.boolean().catch(DEFAULT_SETTINGS.autoJoin),
  onGameStart: z.enum(['hide', 'keep', 'close']).catch(DEFAULT_SETTINGS.onGameStart),
  language: z.string().regex(/^(auto|[a-z]{2})$/).catch(DEFAULT_SETTINGS.language),
})

const file = () => join(app.getPath('userData'), 'settings.json')
let current: Settings | null = null
let onChange: (s: Settings) => void = () => {}

export function onSettingsChanged(cb: (s: Settings) => void): void {
  onChange = cb
}

export function getSettings(): Settings {
  if (!current) {
    try {
      current = Schema.parse({ ...DEFAULT_SETTINGS, ...JSON.parse(readFileSync(file(), 'utf8')) })
    } catch {
      current = { ...DEFAULT_SETTINGS }
    }
  }
  return current
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  current = Schema.parse({ ...getSettings(), ...patch })
  const tmp = `${file()}.tmp`
  await writeFile(tmp, JSON.stringify(current, null, 2))
  await rename(tmp, file())
  onChange(current)
  return current
}
