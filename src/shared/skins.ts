/** Skins (launcher 1.4): what an account looks like, for the 3D views on Home and in Settings > Account. */

export interface SkinInfo {
  /** the account (Minecraft UUID without dashes) */
  id: string
  /** the skin as a data: URL (PNG 64×64 or 64×32), checked; Steve when the account has none or can't be asked */
  skin: string
  /** "slim" = Alex-style arms */
  slim: boolean
  /** the cape in use, as a data: URL, or null */
  cape: string | null
  /** true when this is the default skin (offline test account, or Mojang not answering and nothing kept) */
  fallback: boolean
}
