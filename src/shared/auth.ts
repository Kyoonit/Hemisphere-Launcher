/** Account and sign-in types shared by main and renderer. Tokens never cross into the renderer. */

export type AccountKind = 'microsoft' | 'offline'

export interface AccountInfo {
  /** Minecraft UUID without dashes */
  id: string
  name: string
  kind: AccountKind
  /** expired = Microsoft session no longer valid, player must sign in again */
  status: 'ok' | 'expired'
}

export interface AccountsState {
  accounts: AccountInfo[]
  activeId: string | null
  /** Dev builds only: offline test accounts allowed (never in released builds) */
  devOfflineAllowed: boolean
  /** False until a Microsoft app registration (client ID) is configured */
  microsoftConfigured: boolean
}

export type AuthErrorCode =
  | 'cancelled'
  | 'timeout'
  | 'network'
  | 'notConfigured' // no Azure client ID in this build
  | 'microsoftDenied' // user refused consent / Microsoft returned an error
  | 'noXboxProfile' // Microsoft account has no Xbox profile yet
  | 'childAccount' // must be added to a family by an adult
  | 'xboxUnavailableRegion'
  | 'appNotApproved' // Minecraft services rejected our app registration (pending Microsoft approval)
  | 'notOwned' // account does not own Minecraft: Java Edition
  | 'unknown'

export type AuthResult = { ok: true; account: AccountInfo } | { ok: false; code: AuthErrorCode }
