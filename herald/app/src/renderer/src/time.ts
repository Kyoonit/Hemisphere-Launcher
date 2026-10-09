/** Time zones and dates, always in the staff member's chosen zone (My settings). */

export const pcZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone

/** Every IANA zone the system knows, grouped by region, plus UTC and fixed offsets UTC−12 … UTC+14. */
export function zoneGroups(): [string, string[]][] {
  let all: string[] = []
  try {
    all = Intl.supportedValuesOf('timeZone')
  } catch {
    all = ['Europe/Paris', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Australia/Sydney', 'Asia/Tokyo']
  }
  const groups = new Map<string, string[]>()
  for (const z of all) {
    const g = z.includes('/') ? z.split('/')[0] : 'Other'
    groups.set(g, [...(groups.get(g) ?? []), z])
  }
  const fixed = Array.from({ length: 27 }, (_, i) => i - 12).filter((n) => n !== 0).map((n) => `Etc/GMT${n > 0 ? '-' : '+'}${Math.abs(n)}`)
  const order = ['UTC', 'Europe', 'America', 'Asia', 'Australia', 'Africa', 'Pacific', 'Atlantic', 'Indian', 'Antarctica', 'Arctic', 'Other']
  groups.set('UTC', ['UTC', ...fixed])
  return order.filter((g) => groups.has(g)).map((g) => [g, groups.get(g)!])
}

/** "UTC+2" style offset of a zone at an instant. */
export function offsetOf(zone: string, at = Date.now()): string {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' }).formatToParts(at).find((p) => p.type === 'timeZoneName')
    return (part?.value ?? 'GMT').replace('GMT', 'UTC').replace(/^UTC$/, 'UTC+0')
  } catch {
    return ''
  }
}

/** "Europe/Paris" → "Paris"; fixed offsets are spelled out. */
export const zoneName = (zone: string) => (zone.startsWith('Etc/GMT') ? `UTC${zone[7] === '-' ? '+' : '−'}${zone.slice(8)} (fixed)` : zone.split('/').pop()!.replace(/_/g, ' '))
export const zoneLabel = (zone: string) => (zone.startsWith('Etc/GMT') ? zoneName(zone) : zone.replace(/_/g, ' '))

export const formatTime = (at: number, zone: string) => new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false }).format(at)
export const formatDay = (at: number, zone: string) => new Intl.DateTimeFormat('en-GB', { timeZone: zone, weekday: 'short', day: 'numeric', month: 'short' }).format(at)
export const formatLong = (at: number, zone: string) => new Intl.DateTimeFormat('en-GB', { timeZone: zone, weekday: 'long', day: 'numeric', month: 'long' }).format(at)

/** "seen 2 h ago" */
export function ago(at: number | null, now = Date.now()): string {
  if (!at) return 'never signed in'
  const m = Math.round((now - at) / 60_000)
  if (m < 2) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  return d === 1 ? 'yesterday' : `${d} days ago`
}
