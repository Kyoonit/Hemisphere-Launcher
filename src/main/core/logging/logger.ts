import { app } from 'electron'
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { inspect } from 'node:util'

/**
 * Launcher log: everything printed with console.* is also appended to logs/launcher.log (rotated at 2 MB,
 * one previous file kept). Token-like strings are masked as a safety net — tokens are never logged on purpose.
 */

const MAX_BYTES = 2 * 1024 * 1024
export const launcherLogDir = () => join(app.getPath('userData'), 'logs')
export const launcherLogPath = () => join(launcherLogDir(), 'launcher.log')

/** JWTs (Minecraft/Xbox tokens), long base64/hex blobs and "token=..." pairs. */
export function redact(text: string): string {
  return text
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, '[token]')
    .replace(/((?:access|refresh|id)_?token["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, '$1[token]')
    .replace(/\b(M\.[A-Za-z0-9!*$_-]{20,}|[A-Za-z0-9+/_-]{120,}={0,2})/g, '[secret]')
}

export function installFileLogger(): void {
  mkdirSync(launcherLogDir(), { recursive: true })
  const write = (level: string, args: unknown[]) => {
    try {
      const file = launcherLogPath()
      if (existsSync(file) && statSync(file).size > MAX_BYTES) renameSync(file, join(launcherLogDir(), 'launcher.1.log'))
      const line = args.map((a) => (typeof a === 'string' ? a : inspect(a, { depth: 3, breakLength: Infinity }))).join(' ')
      appendFileSync(file, `${new Date().toISOString()} [${level}] ${redact(line)}\n`)
    } catch {
      /* logging must never crash the launcher */
    }
  }
  for (const level of ['log', 'info', 'warn', 'error'] as const) {
    const original = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
      original(...args)
      write(level.toUpperCase(), args)
    }
  }
  console.log(`[launcher] Hemisphere Launcher ${app.getVersion()} started (Electron ${process.versions.electron}, ${process.platform} ${process.arch})`)
}
