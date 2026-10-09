/** The editor's "When" for an event: start, length, once or every week, and from when players see it coming. */
import { weekdayIn, WEEKDAYS, type EventTime, type PublicationData } from '@shared/heraldPublications'
import { useStore } from '../store'
import { ZonePicker } from '../components/ui'
import { formatTime, formatWhen, fromWallInput, toWallInput, zoneLabel } from '../time'

const LENGTHS = [15, 30, 45, 60, 90, 120, 180, 240, 360, 720, 1440]
const length = (min: number) => (min < 60 ? `${min} min` : min % 60 ? `${Math.floor(min / 60)} h ${min % 60}` : `${min / 60} h`)
/** Monday first, as staff read a week */
const WEEK = [1, 2, 3, 4, 5, 6, 0]

export function EventWhen({ data, onChange, defaultZone }: { data: PublicationData; onChange(p: Partial<PublicationData>): void; defaultZone: string }) {
  const { settings } = useStore()
  const z = data.schedule.zone || defaultZone
  const ev = data.event!
  const start = Date.parse(ev.start)
  const end = start + ev.durationMin * 60_000
  const set = (patch: Partial<EventTime>) => onChange({ event: { ...ev, ...patch } })
  const announce = data.schedule.from ? Date.parse(data.schedule.from) : null
  const untilDay = ev.repeat?.until ? toWallInput(Date.parse(ev.repeat.until), z).slice(0, 10) : ''

  return (
    <div className="card flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="eyebrow">When</span>
        <div className="w-64">
          <ZonePicker value={z} onPick={(zone) => onChange({ schedule: { ...data.schedule, zone } })} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="w-20 text-gray-300">{ev.repeat ? 'First one' : 'Starts'}</label>
        <input
          type="datetime-local"
          className="field w-auto! py-1.5"
          value={toWallInput(start, z)}
          onChange={(e) => {
            const t = fromWallInput(e.target.value, z)
            if (t === null) return
            // a weekly event on one day follows its first date's day
            const days = ev.repeat && ev.repeat.days.length === 1 ? [weekdayIn(t, z)] : ev.repeat?.days
            set({ start: new Date(t).toISOString(), ...(ev.repeat ? { repeat: { ...ev.repeat, days: days! } } : {}) })
          }}
        />
        <label className="text-gray-300">lasts</label>
        <select className="field w-auto! py-1.5" value={ev.durationMin} onChange={(e) => set({ durationMin: Number(e.target.value) })}>
          {[...new Set([...LENGTHS, ev.durationMin])].sort((a, b) => a - b).map((m) => (
            <option key={m} value={m}>
              {length(m)}
            </option>
          ))}
        </select>
        <span className="text-xs text-gray-400">ends {formatTime(end, z)}{toWallInput(end, z).slice(0, 10) !== toWallInput(start, z).slice(0, 10) ? ' the next day' : ''}</span>
      </div>
      <p className="-mt-1.5 text-xs text-gray-400">{[...new Set([z, ...settings.extraZones])].map((x) => `${formatWhen(start, x)} ${zoneLabel(x)}`).join(' · ')}</p>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="w-20 text-gray-300">Repeats</label>
        <label className="flex items-center gap-1.5">
          <input type="radio" checked={!ev.repeat} onChange={() => set({ repeat: null })} /> Once
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" checked={!!ev.repeat} onChange={() => set({ repeat: { days: [weekdayIn(start, z)], until: null } })} /> Every week
        </label>
        {ev.repeat && (
          <span className="flex gap-1">
            {WEEK.map((d) => {
              const on = ev.repeat!.days.includes(d)
              return (
                <button
                  key={d}
                  type="button"
                  className={`w-10 rounded-md py-1 text-xs font-semibold ${on ? 'bg-green-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
                  onClick={() => set({ repeat: { ...ev.repeat!, days: on ? ev.repeat!.days.filter((x) => x !== d) : [...ev.repeat!.days, d].sort() } })}
                >
                  {WEEKDAYS[d].slice(0, 2)}
                </button>
              )
            })}
          </span>
        )}
      </div>
      {ev.repeat && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="w-20 text-gray-300">Until</label>
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={!ev.repeat.until} onChange={() => set({ repeat: { ...ev.repeat!, until: null } })} /> Taken down
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={!!ev.repeat.until} onChange={() => set({ repeat: { ...ev.repeat!, until: new Date(fromWallInput(`${toWallInput(start + 28 * 86_400_000, z).slice(0, 10)}T23:59`, z)!).toISOString() } })} /> The last one on
          </label>
          {ev.repeat.until && (
            <input
              type="date"
              className="field w-auto! py-1.5"
              value={untilDay}
              onChange={(e) => {
                const t = e.target.value && fromWallInput(`${e.target.value}T23:59`, z)
                if (t) set({ repeat: { ...ev.repeat!, until: new Date(t).toISOString() } })
              }}
            />
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="w-20 text-gray-300">Announced</label>
        <label className="flex items-center gap-1.5">
          <input type="radio" checked={announce === null} onChange={() => onChange({ schedule: { ...data.schedule, from: null } })} /> As soon as it is published
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" checked={announce !== null} onChange={() => onChange({ schedule: { ...data.schedule, from: new Date(Math.max(Date.now() + 3_600_000, start - 7 * 86_400_000)).toISOString() } })} /> From
        </label>
        {announce !== null && (
          <input
            type="datetime-local"
            className="field w-auto! py-1.5"
            value={toWallInput(announce, z)}
            onChange={(e) => {
              const t = fromWallInput(e.target.value, z)
              if (t !== null) onChange({ schedule: { ...data.schedule, from: new Date(t).toISOString() } })
            }}
          />
        )}
      </div>
      <p className="text-xs text-gray-500">
        Times are in {zoneLabel(z)}. Each player sees them in their own time{ev.repeat ? ', and a weekly event keeps its time in this zone when the clocks change' : ''}. Players see the next 4 weeks in their list, can ask for a reminder 15 minutes before and add it to their calendar. Announced later = sent now, locked until then.
      </p>
    </div>
  )
}

/** A button under the text (news and events) */
export function LinkField({ data, onChange }: { data: PublicationData; onChange(p: Partial<PublicationData>): void }) {
  return (
    <div>
      <label className="label">Link (a button, opens the player's browser)</label>
      <input className="field" placeholder="https://…" value={data.linkUrl ?? ''} onChange={(e) => onChange({ linkUrl: e.target.value.trim() ? e.target.value.trim() : null })} />
    </div>
  )
}
