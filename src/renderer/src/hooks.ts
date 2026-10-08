import { useEffect, useState } from 'react'
import type { PlaytimeSummary, ServerStatus } from '@shared/server'
import type { Feed } from '@shared/feed'
import type { Settings } from '@shared/settings'

/** Live launcher settings + an update function that returns an error message or null. */
export function useSettings(): [Settings | null, (patch: Partial<Settings>) => Promise<string | null>] {
  const [settings, setSettings] = useState<Settings | null>(null)
  useEffect(() => {
    window.hemisphere.settings.get().then(setSettings)
    return window.hemisphere.settings.onChange(setSettings)
  }, [])
  const update = async (patch: Partial<Settings>) => {
    try {
      setSettings(await window.hemisphere.settings.set(patch))
      return null
    } catch (err) {
      return String(err)
    }
  }
  return [settings, update]
}

/** Window height in CSS pixels, updated on resize. */
export function useWindowHeight(): number {
  const [height, setHeight] = useState(() => window.innerHeight)
  useEffect(() => {
    const onResize = () => setHeight(window.innerHeight)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return height
}

/** Current time, re-rendered every `intervalMs`. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

/** Live server status: first value on mount, then pushed by the main process every minute. */
export function useServerStatus(): ServerStatus | null {
  const [status, setStatus] = useState<ServerStatus | null>(null)
  useEffect(() => {
    let alive = true
    window.hemisphere.server.getStatus().then((s) => alive && setStatus(s))
    const off = window.hemisphere.server.onStatus(setStatus)
    return () => {
      alive = false
      off()
    }
  }, [])
  return status
}

/** Signed staff feed (news, maintenance, restart time); updates live. */
export function useFeed(): Feed | null {
  const [feed, setFeed] = useState<Feed | null>(null)
  useEffect(() => {
    window.hemisphere.feed.get().then(setFeed)
    return window.hemisphere.feed.onChange(setFeed)
  }, [])
  return feed
}

export function usePlaytime(): PlaytimeSummary | null {
  const [playtime, setPlaytime] = useState<PlaytimeSummary | null>(null)
  useEffect(() => {
    const load = () => void window.hemisphere.playtime.get().then(setPlaytime)
    load()
    return window.hemisphere.playtime.onChange(load)
  }, [])
  return playtime
}

/** 4_380_000 -> { h: 1, m: 13 } */
export function splitDuration(ms: number): { h: number; m: number } {
  const totalMin = Math.floor(ms / 60_000)
  return { h: Math.floor(totalMin / 60), m: totalMin % 60 }
}
