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

/** A skin in the wardrobe: kept in the library, or worn before by an account (history). */
export interface WardrobeSkin {
  /** SHA-256 of the PNG: the same picture is kept once */
  hash: string
  /** given by the player (library); empty in the history */
  name: string
  slim: boolean
  /** the PNG as a data: URL */
  skin: string
  /** imported from a file, copied from a player by name, or worn by this account */
  source: 'file' | 'player' | 'worn'
  /** added (library) or last worn (history), ms */
  at: number
}

export interface OwnedCape {
  id: string
  /** Mojang's name for it ("Migrator", "Pan"…) */
  name: string
  active: boolean
  /** the texture as a data: URL */
  cape: string
}

export interface Wardrobe {
  library: WardrobeSkin[]
  /** skins the active account wore, newest first */
  history: WardrobeSkin[]
  /** capes the account owns; null when they can't be known (offline account, Mojang not reachable) */
  capes: OwnedCape[] | null
  /** a signed-in Microsoft account: its skin and cape can be changed */
  canChange: boolean
}

export type WardrobeError = 'notSkin' | 'noPlayer' | 'network' | 'signedOut' | 'tooMany' | 'refused' | 'full'
export type WardrobeResult = { ok: true; wardrobe: Wardrobe; added?: string } | { ok: false; error: WardrobeError | 'cancelled' }
