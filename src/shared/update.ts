/**
 * What PLAY should offer, from the signed index and what's installed (pure function).
 *
 *  - nothing installed, or already on the latest client       -> PLAY
 *  - newer client for the SAME Minecraft version             -> PLAY (updates silently: small, tested by staff)
 *  - newer client for a NEW Minecraft version                -> "UPDATE TO 26.4" + grey "Play on 26.3"
 *    ("Play on…" only if the installed client is the previous one, so its manifest is still published; it never
 *    auto-joins the server)
 */

export interface ClientRefLite {
  clientVersion: string
  minecraft: string
}

export interface InstalledClient {
  clientVersion: string
  minecraft: string
}

export type UpdateDecision =
  | { kind: 'upToDate' }
  | { kind: 'silent'; from: string; to: string }
  | { kind: 'major'; latestMinecraft: string; installedMinecraft: string; canPlayPrevious: boolean }

export function decideUpdate(index: { latest: ClientRefLite; previous: ClientRefLite | null }, installed: InstalledClient | null): UpdateDecision {
  if (!installed || installed.clientVersion === index.latest.clientVersion) return { kind: 'upToDate' }
  if (installed.minecraft === index.latest.minecraft) return { kind: 'silent', from: installed.clientVersion, to: index.latest.clientVersion }
  return {
    kind: 'major',
    latestMinecraft: index.latest.minecraft,
    installedMinecraft: installed.minecraft,
    canPlayPrevious: index.previous?.clientVersion === installed.clientVersion,
  }
}
