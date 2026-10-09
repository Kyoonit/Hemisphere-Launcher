import { useStore } from '../store'
import { ZonePicker } from '../components/ui'
import { formatDay, formatTime, offsetOf, pcZone, zoneLabel, zoneName } from '../time'

/** Only for this staff member, on this PC: the zone every date is shown in, and the zones shown next to it. */
export default function MySettings() {
  const { settings, zone, saveSettings } = useStore()
  // Example: a news appearing next Tuesday at 18:00 in my zone
  const sample = (() => {
    const d = new Date()
    d.setDate(d.getDate() + ((9 - d.getDay()) % 7 || 7))
    d.setHours(18, 0, 0, 0)
    const shift = new Date(d.toLocaleString('en-US', { timeZone: zone })).getTime() - new Date(d.toLocaleString('en-US', { timeZone: pcZone() })).getTime()
    return d.getTime() - shift
  })()
  return (
    <div className="max-w-[560px] animate-fade">
      <div className="eyebrow">Settings</div>
      <h1 className="mb-5 text-[26px] font-extrabold text-white">My time zone</h1>
      <div className="card">
        <label className="label">Show every time in</label>
        <div className="mb-1 flex gap-2">
          <button className={`btn btn-sm ${settings.timeZone === null ? 'btn-primary' : 'btn-ghost'}`} onClick={() => void saveSettings({ timeZone: null })}>
            My PC ({zoneLabel(pcZone())})
          </button>
        </div>
        <ZonePicker value={settings.timeZone} placeholder="Or choose another zone (UTC, a city…)" onPick={(z) => void saveSettings({ timeZone: z })} />
        <p className="mt-1.5 text-xs text-gray-400">Every date in Herald follows it. Players always see times in their own zone.</p>

        <label className="label mt-5">Also show the time for players in</label>
        <div className="mb-2 flex flex-wrap gap-2">
          {settings.extraZones.map((z) => (
            <span key={z} className="flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-900 py-1 pr-1 pl-3 text-sm">
              <b className="font-semibold text-white">{zoneName(z)}</b>
              <span className="text-xs text-gray-400">{offsetOf(z, sample)}</span>
              <button className="grid size-6 place-items-center rounded text-gray-400 hover:bg-gray-700 hover:text-white" onClick={() => void saveSettings({ extraZones: settings.extraZones.filter((x) => x !== z) })} aria-label={`Remove ${zoneName(z)}`}>
                ✕
              </button>
            </span>
          ))}
          {!settings.extraZones.length && <span className="text-sm text-gray-400">None: only your own time is shown.</span>}
        </div>
        {settings.extraZones.length < 6 && (
          <div className="max-w-[300px]">
            <ZonePicker value={null} placeholder="＋ Add a time zone…" onPick={(z) => !settings.extraZones.includes(z) && void saveSettings({ extraZones: [...settings.extraZones, z] })} />
          </div>
        )}
        <div className="mt-4 rounded-lg bg-gray-900 p-3 text-sm">
          <div className="mb-1 text-xs text-gray-400">Example · a news appearing {formatDay(sample, zone)} at 18:00 (your time)</div>
          <b className="text-white">
            {formatDay(sample, zone)} {formatTime(sample, zone)}
          </b>{' '}
          <span className="text-gray-400">· {zoneLabel(zone)}</span>
          <div className="mt-0.5 text-xs text-gray-400">{settings.extraZones.map((z) => `${zoneName(z)} ${formatTime(sample, z)}${formatDay(sample, z) !== formatDay(sample, zone) ? ` (${formatDay(sample, z)})` : ''}`).join(' · ')}</div>
        </div>
      </div>
    </div>
  )
}
