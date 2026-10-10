/**
 * The web pages the launcher shows inside itself (a <webview>, needs internet): the server's BlueMap and the website's
 * rules. Each one has its own storage and only ever shows its own addresses (main/security.ts checks every load).
 */
import { BLUEMAP } from './server'

export type WebPageKey = 'map' | 'rules'

const SITE = 'https://hemispheresurvival.club'

export const WEB_PAGES: Record<WebPageKey, { url: string; partition: string; allows(url: URL): boolean }> = {
  map: { url: `${BLUEMAP.url}/`, partition: 'persist:bluemap', allows: (u) => u.origin === new URL(BLUEMAP.url).origin },
  // the rules only (their tabs change inside the page): not the rest of the website
  rules: { url: `${SITE}/rules`, partition: 'persist:site', allows: (u) => u.origin === SITE && /^\/rules(\/|$)/.test(u.pathname) },
}

/** The page an address belongs to, for a <webview> of that storage (null: not allowed) */
export function webPageFor(partition: string, url: string): WebPageKey | null {
  try {
    const u = new URL(url)
    return (Object.keys(WEB_PAGES) as WebPageKey[]).find((k) => WEB_PAGES[k].partition === partition && WEB_PAGES[k].allows(u)) ?? null
  } catch {
    return null
  }
}
