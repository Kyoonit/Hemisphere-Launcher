import { app, BrowserWindow, session } from 'electron'
import { availableParallelism, totalmem } from 'node:os'
import type { LowEndInfo, PerfSnapshot } from '@shared/performance'

/**
 * How much the launcher itself costs: memory and CPU per process, and what it downloads (Developer tab > Performance),
 * plus the "modest PC" check behind the light interface.
 */

/** 8 GB of RAM or less (Windows reports a bit under 8), or 4 CPU threads or fewer. */
export function lowEndInfo(): LowEndInfo {
  const ramGb = Math.round((totalmem() / 1024 ** 3) * 10) / 10
  const threads = availableParallelism()
  return { lowEnd: ramGb < 8.6 || threads <= 4, ramGb, threads }
}

/** Chromium features a launcher never uses (a spare page process, casting, autofill servers): less memory and traffic. */
export function trimChromium(): void {
  app.commandLine.appendSwitch('disable-features', 'SpareRendererForSitePerProcess,MediaRouter,DialMediaRouteProvider,AutofillServerCommunication,OptimizationHints')
}

// ------------------------------------------------------------------------------ network meter

const started = Date.now()
const sources = new Map<string, { requests: number; bytes: number }>()
function count(url: string, bytes: number): void {
  let host = 'other'
  try {
    host = new URL(url).host || 'other'
  } catch {
    /* not a URL */
  }
  const s = sources.get(host) ?? { requests: 0, bytes: 0 }
  s.requests++
  s.bytes += Number.isFinite(bytes) && bytes > 0 ? bytes : 0
  sources.set(host, s)
}

/**
 * Counts what the launcher downloads, per site: the main process's fetch() (feed, status, mods, updates) and the page's
 * requests (player heads, icons). Sizes come from Content-Length (a few servers don't send it: counted as requests).
 */
export function installNetMeter(): void {
  const original = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const res = await original(input, init)
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    count(url, Number(res.headers.get('content-length')))
    return res
  }
  app.whenReady().then(() => {
    session.defaultSession.webRequest.onCompleted({ urls: ['http://*/*', 'https://*/*'] }, (d) => {
      if (d.fromCache) return
      const length = Object.entries(d.responseHeaders ?? {}).find(([k]) => k.toLowerCase() === 'content-length')?.[1]?.[0]
      count(d.url, Number(length))
    })
  })
}

export function perfSnapshot(windowOpen: boolean): PerfSnapshot {
  const processes = app.getAppMetrics().map((m) => ({
    type: m.type,
    name: m.name ?? m.serviceName ?? '',
    memoryMb: Math.round((m.memory.privateBytes ?? m.memory.workingSetSize) / 1024),
    cpu: Math.round(m.cpu.percentCPUUsage * 10) / 10,
  }))
  return {
    processes,
    totalMb: processes.reduce((n, p) => n + p.memoryMb, 0),
    network: [...sources.entries()].map(([host, s]) => ({ host, ...s })).sort((a, b) => b.bytes - a.bytes || b.requests - a.requests),
    since: started,
    windowOpen,
  }
}

// ------------------------------------------------------------------------------ graphics process

const gpuTrims: number[] = []
/**
 * Once the window is closed to free memory, Chromium's graphics process still holds its pictures (about 150 MB).
 * Ending it gives them back: Chromium starts a fresh, small one right away, and the window draws normally when it
 * reopens. At most twice an hour: Chromium turns graphics acceleration off after repeated restarts.
 */
export function trimGpuProcess(): void {
  if (BrowserWindow.getAllWindows().length > 0) return
  const now = Date.now()
  while (gpuTrims.length && now - gpuTrims[0] > 60 * 60_000) gpuTrims.shift()
  if (gpuTrims.length >= 2) return
  const gpu = app.getAppMetrics().find((m) => m.type === 'GPU')
  if (!gpu) return
  gpuTrims.push(now)
  try {
    process.kill(gpu.pid)
    console.log('[perf] graphics process restarted to free its memory (window closed)')
  } catch {
    /* already gone */
  }
}
