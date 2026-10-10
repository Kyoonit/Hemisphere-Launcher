/**
 * Changes that reach the launchers straight from the Herald server, without GitHub (the catalogue): the bar under the
 * title bar shows them travelling too (screens/PublishJobs.tsx).
 */
export interface DirectChange {
  what: string
  /** what the launchers show once it arrived ("In the launchers’ catalogue", "Out of the launchers’ catalogue") */
  done: string
  at: number
}

const EVENT = 'herald:direct-change'

export function announceDirect(what: string, done: string): void {
  window.dispatchEvent(new CustomEvent<DirectChange>(EVENT, { detail: { what, done, at: Date.now() } }))
}

export function onDirectChange(cb: (c: DirectChange) => void): () => void {
  const listener = (e: Event) => cb((e as CustomEvent<DirectChange>).detail)
  window.addEventListener(EVENT, listener)
  return () => window.removeEventListener(EVENT, listener)
}
