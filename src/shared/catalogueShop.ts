/**
 * The catalogue as the launchers see it (launcher 1.4, step 3c): what Herald shows (GET /shop), and an item as a
 * player receives it (GET /shop/<id>): sealed, its textures marked for that player, opened in memory only.
 * Players prove their Minecraft account the way Minecraft servers check it (Mojang's session "join" / "hasJoined"):
 * the launcher never sends its Microsoft or Minecraft token to Herald.
 */
import type { CatalogueAdjust, CatalogueKind, CatalogueSlot } from './heraldCatalogue'
import type { ModelData } from './models'

/** An item shown in the launchers */
export interface ShopItem {
  id: string
  kind: CatalogueKind
  name: string
  description: string
  patreonUrl: string
  tier: string
  category: string
  slot: CatalogueSlot
  slim: boolean
  adjust: CatalogueAdjust
  newUntil: string | null
  /** version of its files: a new one replaces the copy kept by the launcher */
  version: number
  /** its picture (GET /shop/thumb/<id>), or none */
  thumbnail: boolean
  publishedAt: number | null
}

/** What a sealed item holds (JSON) */
export interface ShopBundle {
  format: 1
  id: string
  version: number
  kind: CatalogueKind
  slot: CatalogueSlot
  slim: boolean
  adjust: CatalogueAdjust
  /** models: textures are data: URLs of marked PNGs */
  model?: ModelData
  /** skins: data: URL of the marked PNG */
  skin?: string
}

/** GET /shop/<id>: the sealed item (HMS1 envelope, src/shared/sealed.ts) and its key, both base64 */
export interface ShopDelivery {
  version: number
  sealed: string
  key: string
}

/** POST /player/verify: a player token (sent as "Authorization: Player <token>") */
export interface PlayerSession {
  token: string
  expiresAt: number
  id: string
  name: string
}

/** Key id of an item's envelope */
export const shopKeyId = (id: string, version: number) => `${id}-v${version}`

/** Why an item cannot be opened in the launcher */
export type ShopError = 'needs-microsoft' | 'offline' | 'not-verified' | 'blocked' | 'unknown-item' | 'failed'
export type ShopResult<T> = { ok: true; value: T } | { ok: false; error: ShopError; message?: string }
