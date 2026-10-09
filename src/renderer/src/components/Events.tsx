import { useTranslation } from 'react-i18next'
import type { HemisphereEvent } from '@shared/events'
import { useNow, useSettings } from '../hooks'
import { EventList } from './feed/EventCards'

export { relativeTime } from './feed/EventCards'

/** News page: the events calendar, soonest first, each in the player's own time (reminder, calendar file, link). */
export default function Events({ events }: { events: HemisphereEvent[] | undefined }) {
  const { i18n } = useTranslation()
  const now = useNow(30_000)
  const [settings] = useSettings()
  return (
    <EventList
      events={events}
      now={now}
      lang={i18n.language}
      reminders={new Set(settings?.eventReminders ?? [])}
      onReminder={(id, on) => void window.hemisphere.events.setReminder(id, on)}
      onCalendar={(id) => window.hemisphere.events.addToCalendar(id)}
      onLink={(id) => window.hemisphere.feed.openLink(id)}
    />
  )
}
