import { useTranslation } from 'react-i18next'
import { Bell, BellRing, CalendarPlus, ExternalLink, MapPin } from 'lucide-react'
import { eventEnd, eventPhase, upcomingEvents, type HemisphereEvent } from '@shared/events'
import { localize } from '@shared/manifest'
import { useNow, useSettings } from '../hooks'

/** "in 3 h", "tomorrow", "in 4 days" (the player's language). */
export function relativeTime(ms: number, now: number, lang: string): string {
  const diff = ms - now
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' })
  const abs = Math.abs(diff)
  if (abs < 3600_000) return rtf.format(Math.round(diff / 60_000), 'minute')
  if (abs < 24 * 3600_000) return rtf.format(Math.round(diff / 3600_000), 'hour')
  return rtf.format(Math.round(diff / (24 * 3600_000)), 'day')
}

/** News page: the events calendar, soonest first, each in the player's own time. */
export default function Events({ events }: { events: HemisphereEvent[] | undefined }) {
  const { t, i18n } = useTranslation()
  const now = useNow(30_000)
  const [settings] = useSettings()
  const list = upcomingEvents(events, now)
  if (!list.length) return null
  const reminders = new Set(settings?.eventReminders ?? [])

  return (
    <section className="mb-6">
      <h2 className="mb-2 text-xs font-bold tracking-[0.08em] text-gray-400 uppercase">{t('events.title')}</h2>
      <div className="space-y-2">
        {list.slice(0, 6).map((e) => (
          <EventCard key={e.id} event={e} now={now} lang={i18n.language} reminded={reminders.has(e.id)} />
        ))}
      </div>
    </section>
  )
}

function EventCard({ event: e, now, lang, reminded }: { event: HemisphereEvent; now: number; lang: string; reminded: boolean }) {
  const { t } = useTranslation()
  const start = new Date(e.start)
  const end = new Date(eventEnd(e))
  const phase = eventPhase(e, now)
  const sameDay = start.toDateString() === end.toDateString()
  const time = (d: Date) => d.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })
  const when = sameDay
    ? `${start.toLocaleDateString(lang, { weekday: 'long', day: 'numeric', month: 'long' })} · ${time(start)} – ${time(end)}`
    : `${start.toLocaleString(lang, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} – ${end.toLocaleString(lang, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
  const button = 'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors'

  return (
    <article className={`flex flex-wrap items-center gap-4 rounded-xl bg-gray-900/60 px-4 py-3 ring-1 ${phase === 'live' ? 'ring-green-500/60' : 'ring-white/5'}`}>
      {/* date block, in the player's own time */}
      <div className={`grid w-14 flex-none place-items-center rounded-lg py-1.5 text-center ${phase === 'live' ? 'bg-green-600 text-white' : 'bg-gray-800 text-gray-200'}`}>
        <span className="text-[11px] font-bold uppercase">{start.toLocaleDateString(lang, { month: 'short' }).replace('.', '')}</span>
        <span className="text-xl leading-none font-extrabold">{start.getDate()}</span>
        <span className="text-[10.5px] opacity-80">{start.toLocaleDateString(lang, { weekday: 'short' }).replace('.', '')}</span>
      </div>
      <div className="min-w-[220px] flex-1">
        <p className="flex flex-wrap items-center gap-2">
          <b className="text-white">{localize(e.title, lang)}</b>
          {phase === 'live' ? (
            <span className="flex items-center gap-1.5 rounded-full bg-green-900/60 px-2 py-px text-[11px] font-bold text-green-300">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-400" /> {t('events.live')}
            </span>
          ) : (
            <span className={`rounded-full px-2 py-px text-[11px] font-semibold ${phase === 'soon' ? 'bg-sky-900/60 text-sky-300' : 'bg-gray-700/80 text-gray-300'}`}>
              {relativeTime(start.getTime(), now, lang)}
            </span>
          )}
        </p>
        <p className="text-[12.5px] text-gray-400">
          {when} <span className="text-gray-500">({t('events.yourTime')})</span>
        </p>
        {e.where && (
          <p className="mt-0.5 flex items-center gap-1 text-[12.5px] text-gray-300">
            <MapPin size={12} className="text-green-400" /> {localize(e.where, lang)}
          </p>
        )}
        {e.body && <p className="mt-1 line-clamp-2 text-[13px] text-gray-300">{localize(e.body, lang)}</p>}
      </div>
      <div className="flex flex-none flex-wrap gap-1.5">
        {phase !== 'live' && (
          <button
            onClick={() => void window.hemisphere.events.setReminder(e.id, !reminded)}
            aria-pressed={reminded}
            title={reminded ? t('events.reminderOnHint') : t('events.remindHint')}
            className={`${button} ${reminded ? 'bg-green-900/50 text-green-300 ring-1 ring-green-500/60 hover:bg-green-900/70' : 'bg-gray-700/85 text-white hover:bg-gray-600'}`}
          >
            {reminded ? <BellRing size={14} /> : <Bell size={14} />} {reminded ? t('events.reminderOn') : t('events.remind')}
          </button>
        )}
        <button onClick={() => window.hemisphere.events.addToCalendar(e.id)} title={t('events.calendarHint')} className={`${button} bg-gray-700/85 text-white hover:bg-gray-600`}>
          <CalendarPlus size={14} /> {t('events.calendar')}
        </button>
        {e.link && (
          <button onClick={() => window.hemisphere.feed.openLink(e.id)} className={`${button} text-gray-300 hover:bg-gray-700 hover:text-white`}>
            <ExternalLink size={14} /> {localize(e.link.label, lang)}
          </button>
        )}
      </div>
    </article>
  )
}
