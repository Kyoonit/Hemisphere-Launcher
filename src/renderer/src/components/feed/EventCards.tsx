/**
 * The events, as players see them: the News page list and the Home server panel's next-event line. Pure pieces (data in,
 * callbacks out), shared with Herald's preview; the launcher wires the buttons (components/Events.tsx, ServerPanel).
 */
import { useTranslation } from 'react-i18next'
import { Bell, BellRing, CalendarDays, CalendarPlus, ExternalLink, MapPin } from 'lucide-react'
import { eventEnd, eventPhase, upcomingEvents, type HemisphereEvent } from '@shared/events'
import { localize } from '@shared/manifest'

/** "in 3 h", "tomorrow", "in 4 days" (the player's language). */
export function relativeTime(ms: number, now: number, lang: string): string {
  const diff = ms - now
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' })
  const abs = Math.abs(diff)
  if (abs < 3600_000) return rtf.format(Math.round(diff / 60_000), 'minute')
  if (abs < 24 * 3600_000) return rtf.format(Math.round(diff / 3600_000), 'hour')
  return rtf.format(Math.round(diff / (24 * 3600_000)), 'day')
}

export interface EventActions {
  reminders?: Set<string>
  onReminder?(id: string, on: boolean): void
  onCalendar?(id: string): void
  onLink?(id: string): void
}

/** News page: the events calendar, soonest first, each in the player's own time. */
export function EventList({ events, now, lang, timeZone, ...actions }: { events: HemisphereEvent[] | undefined; now: number; lang: string; timeZone?: string } & EventActions) {
  const { t } = useTranslation()
  const list = upcomingEvents(events, now)
  if (!list.length) return null
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-xs font-bold tracking-[0.08em] text-gray-400 uppercase">{t('events.title')}</h2>
      <div className="space-y-2">
        {list.slice(0, 6).map((e) => (
          <EventCard key={e.id} event={e} now={now} lang={lang} timeZone={timeZone} reminded={actions.reminders?.has(e.id) ?? false} {...actions} />
        ))}
      </div>
    </section>
  )
}

function EventCard({ event: e, now, lang, timeZone, reminded, onReminder, onCalendar, onLink }: { event: HemisphereEvent; now: number; lang: string; timeZone?: string; reminded: boolean } & EventActions) {
  const { t } = useTranslation()
  const start = new Date(e.start)
  const end = new Date(eventEnd(e))
  const phase = eventPhase(e, now)
  const z = timeZone ? { timeZone } : {}
  const day = (d: Date) => d.toLocaleDateString('en-CA', z)
  const sameDay = day(start) === day(end)
  const time = (d: Date) => d.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit', ...z })
  const when = sameDay
    ? `${start.toLocaleDateString(lang, { weekday: 'long', day: 'numeric', month: 'long', ...z })} · ${time(start)} – ${time(end)}`
    : `${start.toLocaleString(lang, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', ...z })} – ${end.toLocaleString(lang, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', ...z })}`
  const button = 'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors'

  return (
    <article className={`flex flex-wrap items-center gap-4 rounded-xl bg-gray-900/60 px-4 py-3 ring-1 ${phase === 'live' ? 'ring-green-500/60' : 'ring-white/5'}`}>
      {/* date block, in the player's own time */}
      <div className={`grid w-14 flex-none place-items-center rounded-lg py-1.5 text-center ${phase === 'live' ? 'bg-green-600 text-white' : 'bg-gray-800 text-gray-200'}`}>
        <span className="text-[11px] font-bold uppercase">{start.toLocaleDateString(lang, { month: 'short', ...z }).replace('.', '')}</span>
        <span className="text-xl leading-none font-extrabold">{start.toLocaleDateString('en-US', { day: 'numeric', ...z })}</span>
        <span className="text-[10.5px] opacity-80">{start.toLocaleDateString(lang, { weekday: 'short', ...z }).replace('.', '')}</span>
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
            onClick={() => onReminder?.(e.id, !reminded)}
            aria-pressed={reminded}
            title={reminded ? t('events.reminderOnHint') : t('events.remindHint')}
            className={`${button} ${reminded ? 'bg-green-900/50 text-green-300 ring-1 ring-green-500/60 hover:bg-green-900/70' : 'bg-gray-700/85 text-white hover:bg-gray-600'}`}
          >
            {reminded ? <BellRing size={14} /> : <Bell size={14} />} {reminded ? t('events.reminderOn') : t('events.remind')}
          </button>
        )}
        <button onClick={() => onCalendar?.(e.id)} title={t('events.calendarHint')} className={`${button} bg-gray-700/85 text-white hover:bg-gray-600`}>
          <CalendarPlus size={14} /> {t('events.calendar')}
        </button>
        {e.link && (
          <button onClick={() => onLink?.(e.id)} className={`${button} text-gray-300 hover:bg-gray-700 hover:text-white`}>
            <ExternalLink size={14} /> {localize(e.link.label, lang)}
          </button>
        )}
      </div>
    </article>
  )
}

/** Home's server panel: the next event within a week (or the one happening now) */
export function NextEvent({ events, now, onOpen }: { events: HemisphereEvent[] | undefined; now: number; onOpen?(): void }) {
  const { t, i18n } = useTranslation()
  const next = upcomingEvents(events, now).find((e) => Date.parse(e.start) - now < 7 * 24 * 3600_000)
  if (!next) return null
  const live = eventPhase(next, now) === 'live'
  return (
    <button
      onClick={onOpen}
      title={localize(next.title, i18n.language)}
      className={`mt-2.5 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[12.5px] transition-colors ${live ? 'bg-green-900/45 text-green-100 hover:bg-green-900/60' : 'bg-gray-900/55 text-gray-300 hover:bg-gray-800/80'}`}
    >
      <CalendarDays size={15} className="flex-none text-green-400" />
      <span className="min-w-0 flex-1 truncate">
        <b className="font-semibold text-white">{localize(next.title, i18n.language)}</b>
      </span>
      <span className="flex-none text-[11.5px] text-gray-400">{live ? t('events.live') : relativeTime(Date.parse(next.start), now, i18n.language)}</span>
    </button>
  )
}
