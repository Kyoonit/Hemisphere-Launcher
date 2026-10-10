import type { TourLabels, TourStep } from '@launcher/components/tour/Tour'
import type { Tab } from './components/TitleBar'

/**
 * Herald's guided tour: the same tour as the launcher's (one step at a time, "3 / 12", skip a part, quit with Esc),
 * with only the tabs this profile can open. Offered once per profile on this PC; "Take the tour" in the profile menu
 * shows it again.
 */
type Step = { part: string; id: string; tab?: Tab; target?: string; title: string; body: string }

const STEPS: Step[] = [
  { part: 'Welcome', id: 'welcome', tab: 'home', title: 'Welcome to Herald', body: 'Herald is where the staff make what players see in the launcher: news, events, maintenances, the mod pack, the Patreon catalogue…\nUse “Next” (or →), “Skip this part”, or “Quit the tour” (Esc) at any time.' },
  { part: 'Welcome', id: 'tabs', tab: 'home', target: 'tabs', title: 'The tabs', body: 'Each part of the launcher has its tab. You only see the ones your role allows.' },
  { part: 'Welcome', id: 'bar', tab: 'home', target: 'publish-bar', title: 'On its way to the launchers', body: 'The last change and where it is now: Herald server → GitHub Actions (checked and signed) → GitHub → players’ launchers, with the time so far. Catalogue changes skip GitHub: they reach the launchers straight away.' },
  { part: 'Welcome', id: 'home', tab: 'home', target: 'tab-home', title: 'Home', body: 'What needs attention (publications waiting for a review, about to go live…), what is coming up, who is in Herald now and the latest activity.' },
  { part: 'Tabs', id: 'publications', tab: 'publications', target: 'tab-publications', title: 'Publications', body: 'News, events, banners and the welcome message. Write a draft, send it to review, mark it ready, then publish it now or at a set time. Every version is kept, and the team can comment.' },
  { part: 'Tabs', id: 'preview', tab: 'preview', target: 'tab-preview', title: 'Preview', body: 'The launcher exactly as players will see it, at any date and time: check a scheduled post or event before it goes live.' },
  { part: 'Tabs', id: 'server', tab: 'server', target: 'tab-server', title: 'Server', body: 'Plan a maintenance, start one now in an emergency, say the server is back online, and set the daily restart. Players’ launchers show it all.' },
  { part: 'Tabs', id: 'backgrounds', tab: 'backgrounds', target: 'tab-backgrounds', title: 'Backgrounds', body: 'The pictures behind the launcher’s Home, by period (an event, a season…).' },
  { part: 'Tabs', id: 'pack', tab: 'pack', target: 'tab-pack', title: 'Mod pack', body: 'Propose a new mod pack (or get it ready for a new Minecraft version); another member approves it before it reaches the players.' },
  { part: 'Tabs', id: 'catalogue', tab: 'catalogue', target: 'tab-catalogue', title: 'Catalogue', body: 'The Patreon models and skins: add their files, try them on in the studio, make pictures for Discord, choose a cover, then show them in the launchers with their Patreon link. A leaked texture can be traced to the player who received it.' },
  { part: 'Tabs', id: 'team', tab: 'team', target: 'tab-team', title: 'Team', body: 'The staff’s profiles, roles and permissions, the trash, and the journal of everything done in Herald.' },
  { part: 'You', id: 'profile', target: 'profile', title: 'Your profile', body: 'Your time zone, the launcher’s settings (if your role allows it), this tour again, and signing out.' },
  { part: 'You', id: 'finish', tab: 'home', title: 'You’re ready', body: 'That’s Herald. Take this tour again anytime from your profile menu (top right).' },
]

/** The steps this profile can follow (`allowed`: the tabs it can open) */
export function heraldTour(allowed: (tab: Tab) => boolean, open: (tab: Tab) => void): TourStep[] {
  return STEPS.filter((s) => !s.tab || allowed(s.tab)).map((s) => ({ id: s.id, part: s.part, title: s.title, body: s.body, target: s.target, before: s.tab ? () => open(s.tab!) : undefined }))
}

export const TOUR_LABELS: TourLabels = { next: 'Next', back: 'Back', finish: 'Finish', skipPart: 'Skip this part', quit: 'Quit the tour', counter: (n, total) => `${n} / ${total}` }

const key = (profile: string) => `herald-tour-${profile}`
export const tourDone = (profile: string) => {
  try {
    return localStorage.getItem(key(profile)) === 'done'
  } catch {
    return true
  }
}
export const markTourDone = (profile: string) => {
  try {
    localStorage.setItem(key(profile), 'done')
  } catch {
    /* not kept: offered again next time */
  }
}

const EVENT = 'herald:tour'
export const startTour = () => window.dispatchEvent(new Event(EVENT))
export function onStartTour(cb: () => void): () => void {
  window.addEventListener(EVENT, cb)
  return () => window.removeEventListener(EVENT, cb)
}
