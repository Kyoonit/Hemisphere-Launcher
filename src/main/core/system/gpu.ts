import { app } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

/**
 * Laptops with two graphics chips (built-in + gaming card) often run Java on the weak built-in one, which is the
 * classic "Minecraft runs at 20 FPS on my gaming laptop". Windows has a per-app preference for this (Settings >
 * System > Display > Graphics): we set it to "High performance" for Hemisphere's Java only, never for anything else.
 */
const run = promisify(execFile)
const KEY = 'HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences'
const HIGH_PERFORMANCE = 'GpuPreference=2;'

/** PCI vendor ids that are not real graphics chips (Microsoft Basic Render Driver, remote desktop, unknown). */
const VIRTUAL_VENDORS = new Set([0x0000, 0x1414])
const VENDOR_NAMES: Record<number, string> = { 0x10de: 'NVIDIA', 0x1002: 'AMD', 0x8086: 'Intel' }

export interface GpuDevice {
  vendorId: number
  deviceId: number
  name?: string
}

/** Two or more real graphics chips = the player can benefit from choosing the high-performance one. */
export function isHybridGpu(devices: GpuDevice[]): boolean {
  return devices.filter((d) => !VIRTUAL_VENDORS.has(d.vendorId)).length >= 2
}

let detected: { hybrid: boolean; names: string[] } = { hybrid: false, names: [] }
export const gpuSummary = () => detected

export async function detectGpus(): Promise<void> {
  try {
    const info = (await app.getGPUInfo('complete')) as { gpuDevice?: { vendorId: number; deviceId: number; deviceString?: string; driverVendor?: string }[] }
    const devices: GpuDevice[] = (info.gpuDevice ?? []).map((d) => ({ vendorId: d.vendorId, deviceId: d.deviceId, name: d.deviceString || d.driverVendor }))
    const real = devices.filter((d) => !VIRTUAL_VENDORS.has(d.vendorId))
    detected = { hybrid: isHybridGpu(devices), names: real.map((d) => d.name || VENDOR_NAMES[d.vendorId] || 'GPU') }
    console.log(`[gpu] ${real.length} graphics chip(s): ${detected.names.join(', ') || 'unknown'}`)
  } catch (err) {
    console.warn('[gpu] detection failed:', err)
  }
}

/** Sets (or removes our own) "High performance" preference for this java executable. Windows only, per user. */
export async function applyGpuPreference(javaExe: string, highPerformance: boolean): Promise<void> {
  if (process.platform !== 'win32' || !detected.hybrid) return
  if (highPerformance) {
    await run('reg.exe', ['add', KEY, '/v', javaExe, '/t', 'REG_SZ', '/d', HIGH_PERFORMANCE, '/f'], { windowsHide: true })
    return
  }
  // Only undo what we set: a preference the player chose in Windows' own settings is left alone.
  const current = await run('reg.exe', ['query', KEY, '/v', javaExe], { windowsHide: true }).catch(() => null)
  if (current?.stdout.includes(HIGH_PERFORMANCE)) await run('reg.exe', ['delete', KEY, '/v', javaExe, '/f'], { windowsHide: true })
}
