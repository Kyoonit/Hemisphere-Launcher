import { useEffect, useState } from 'react'
import type { PlaytimeSummary, ServerStatus } from '@shared/server'
import type { Feed } from '@shared/feed'

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
