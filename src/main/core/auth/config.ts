/**
 * Microsoft app registration. The client ID is public (not a secret): it identifies the launcher to Microsoft.
 * Set it in `.env` as MAIN_VITE_MS_CLIENT_ID — see docs/MICROSOFT_AUTH.md.
 */
export const MS_CLIENT_ID: string = import.meta.env?.MAIN_VITE_MS_CLIENT_ID ?? ''

export const MS_AUTHORIZE_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize'
export const MS_TOKEN_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token'
export const MS_SCOPE = 'XboxLive.signin offline_access'

export const XBL_AUTH_URL = 'https://user.auth.xboxlive.com/user/authenticate'
export const XSTS_AUTH_URL = 'https://xsts.auth.xboxlive.com/xsts/authorize'
export const MC_LOGIN_URL = 'https://api.minecraftservices.com/authentication/login_with_xbox'
export const MC_PROFILE_URL = 'https://api.minecraftservices.com/minecraft/profile'

export const SIGN_IN_TIMEOUT_MS = 5 * 60_000
export const HTTP_TIMEOUT_MS = 15_000
