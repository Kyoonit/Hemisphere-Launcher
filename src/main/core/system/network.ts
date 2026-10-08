import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { Transform, type TransformCallback } from 'node:stream'
import { promisify } from 'node:util'
import type { NetworkSavings } from '@shared/performance'
import { getSettings } from '../settings/settings'

/**
 * Being gentle with the player's connection:
 *  - metered connections (phone hotspot, 4G: Windows' "metered connection") get no background downloads;
 *  - an optional speed limit for the launcher's own downloads (Settings > Launcher);
 *  - a count of what was saved (Developer tab > Performance).
 */

const run = promisify(execFile)
const POWERSHELL = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
const COST_SCRIPT =
  '$p=[Windows.Networking.Connectivity.NetworkInformation,Windows.Networking.Connectivity,ContentType=WindowsRuntime]::GetInternetConnectionProfile(); if($p){[string]$p.GetConnectionCost().NetworkCostType}else{"None"}'

let metered: { value: boolean; at: number } | null = null
/** Windows says the connection is metered (Fixed/Variable cost). Asked at most every 5 minutes; false when unknown. */
export async function isMetered(): Promise<boolean> {
  if (process.platform !== 'win32') return false
  if (metered && Date.now() - metered.at < 5 * 60_000) return metered.value
  const out = await run(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', COST_SCRIPT], { windowsHide: true, timeout: 10_000 }).then((r) => r.stdout.trim(), () => '')
  metered = { value: out === 'Fixed' || out === 'Variable', at: Date.now() }
  return metered.value
}

/** Background downloads (updates prepared ahead, launcher update) wait for a normal connection when asked to. */
export async function backgroundDownloadsAllowed(): Promise<boolean> {
  if (!getSettings().saveDataOnMetered) return true
  const m = await isMetered()
  if (m) console.log('[network] metered connection: background downloads wait')
  return !m
}

// ------------------------------------------------------------------------------ speed limit

/** One budget for all the launcher's downloads together (a token bucket refilled every 100 ms). */
let tokens = 0
let refilledAt = Date.now()
const limitBytes = () => getSettings().downloadLimit * 1024 * 1024
function take(want: number): number {
  const limit = limitBytes()
  if (!limit) return want
  const now = Date.now()
  tokens = Math.min(limit / 4, tokens + ((now - refilledAt) / 1000) * limit) // at most a quarter second of burst
  refilledAt = now
  const got = Math.min(want, Math.floor(tokens))
  tokens -= got
  return got
}

/** A stream step that slows a download down to the speed limit (no limit: passes through). */
export function throttle(): Transform {
  return new Transform({
    transform(chunk: Buffer, _enc, done: TransformCallback) {
      const push = (offset: number) => {
        if (offset >= chunk.length) return done()
        const n = take(chunk.length - offset)
        if (n > 0) this.push(chunk.subarray(offset, offset + n))
        if (offset + n >= chunk.length) return done()
        setTimeout(() => push(offset + n), 50)
      }
      push(0)
    },
  })
}

/** xmcl (Minecraft, libraries, assets) can't be slowed per byte: with a limit, fewer files at once. */
export const xmclConcurrency = () =>
  getSettings().downloadLimit ? { assetsDownloadConcurrency: 4, librariesDownloadConcurrency: 2 } : { assetsDownloadConcurrency: 16, librariesDownloadConcurrency: 8 }

// ------------------------------------------------------------------------------ savings

const savings: NetworkSavings = { notModified: 0, notModifiedBytes: 0, reusedFiles: 0, reusedBytes: 0 }
/** A file the server said hadn't changed (we sent its ETag): `bytes` = the size we didn't download again. */
export function savedNotModified(bytes: number): void {
  savings.notModified++
  savings.notModifiedBytes += bytes
}
/** Minecraft files taken from another launcher on this PC instead of downloading them. */
export function savedReused(files: number, bytes: number): void {
  savings.reusedFiles += files
  savings.reusedBytes += bytes
}
export const networkSavings = (): NetworkSavings => ({ ...savings })
