import type { TFunction } from 'i18next'
import type { Section } from '../../screens/Settings'
import type { TourLabels, TourStep } from './Tour'

/** How the tour moves around the launcher (App's navigation) */
export interface TourNav {
  home(): void
  news(): void
  content(): void
  screenshots(): void
  settings(section: Section): void
}

/** part · step id · element (data-tour) · where it is */
const STEPS: [part: string, id: string, target: string | null, open: ((nav: TourNav) => void) | null][] = [
  ['home', 'welcome', null, (n) => n.home()],
  ['home', 'play', 'play', (n) => n.home()],
  ['home', 'sets', 'sets', (n) => n.home()],
  ['home', 'server', 'server', (n) => n.home()],
  ['home', 'playtime', 'playtime', (n) => n.home()],
  ['home', 'skin', 'skin', (n) => n.home()],
  ['home', 'links', 'links', (n) => n.home()],
  ['home', 'newsPeek', 'news-peek', (n) => n.home()],
  ['tabs', 'tabs', 'tabs', (n) => n.home()],
  ['tabs', 'news', 'news-tabs', (n) => n.news()],
  ['tabs', 'content', 'content-tabs', (n) => n.content()],
  ['tabs', 'screenshots', 'tab-screenshots', (n) => n.screenshots()],
  ['tabs', 'account', 'account', (n) => n.home()],
  ['settings', 'game', 'settings-game', (n) => n.settings('game')],
  ['settings', 'skins', 'settings-account', (n) => n.settings('account')],
  ['settings', 'installation', 'settings-installation', (n) => n.settings('installation')],
  ['settings', 'finish', null, (n) => n.home()],
]

export function launcherTour(t: TFunction, nav: TourNav): TourStep[] {
  return STEPS.map(([part, id, target, open]) => ({
    id,
    part: t(`tour.parts.${part}`),
    title: t(`tour.steps.${id}.title`),
    body: t(`tour.steps.${id}.body`),
    target: target ?? undefined,
    before: open ? () => open(nav) : undefined,
  }))
}

export const LAUNCHER_TOUR_STEPS = STEPS.length

export const tourLabels = (t: TFunction): TourLabels => ({
  next: t('tour.next'),
  back: t('tour.back'),
  finish: t('tour.finish'),
  skipPart: t('tour.skipPart'),
  quit: t('tour.quit'),
  counter: (n, total) => t('tour.counter', { n, total }),
})

/** Starts the tour from anywhere (Home's card, Settings > Launcher): App shows it */
const EVENT = 'hemisphere:tour'
export const startTour = () => window.dispatchEvent(new Event(EVENT))
export function onStartTour(cb: () => void): () => void {
  window.addEventListener(EVENT, cb)
  return () => window.removeEventListener(EVENT, cb)
}
