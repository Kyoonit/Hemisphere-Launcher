import { z } from 'zod'
import { AuthError, requestJson } from './errors'
import { HTTP_TIMEOUT_MS, MC_LOGIN_URL, MC_PROFILE_URL, XBL_AUTH_URL, XSTS_AUTH_URL } from './config'

/** Microsoft access token -> Xbox Live -> XSTS -> Minecraft access token + profile. */

const XboxTokenSchema = z.object({
  Token: z.string(),
  DisplayClaims: z.object({ xui: z.array(z.object({ uhs: z.string() })).min(1) }),
})
const McLoginSchema = z.object({ access_token: z.string().min(1), expires_in: z.number() })
const ProfileSchema = z.object({ id: z.string().regex(/^[0-9a-f]{32}$/i), name: z.string().min(1).max(16) })

export interface MinecraftSession {
  accessToken: string
  expiresAt: number
  profile: { id: string; name: string }
}

/** XSTS error codes: https://wiki.vg/Microsoft_Authentication_Scheme */
const XERR: Record<number, AuthError['code']> = {
  2148916233: 'noXboxProfile',
  2148916235: 'xboxUnavailableRegion',
  2148916236: 'childAccount', // adult verification (South Korea)
  2148916237: 'childAccount',
  2148916238: 'childAccount',
}

const json = (body: unknown): RequestInit & { timeoutMs: number } => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  body: JSON.stringify(body),
  timeoutMs: HTTP_TIMEOUT_MS,
})

export async function minecraftSessionFromMs(msAccessToken: string): Promise<MinecraftSession> {
  // 1. Xbox Live user token
  const xbl = await requestJson(
    XBL_AUTH_URL,
    json({
      Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${msAccessToken}` },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT',
    }),
  )
  const xblToken = XboxTokenSchema.safeParse(xbl.body)
  if (xbl.status !== 200 || !xblToken.success) throw new AuthError('unknown', `xbl ${xbl.status}`)

  // 2. XSTS token for Minecraft services
  const xsts = await requestJson(
    XSTS_AUTH_URL,
    json({
      Properties: { SandboxId: 'RETAIL', UserTokens: [xblToken.data.Token] },
      RelyingParty: 'rp://api.minecraftservices.com/',
      TokenType: 'JWT',
    }),
  )
  if (xsts.status === 401) {
    const xerr = (xsts.body as { XErr?: number } | null)?.XErr ?? 0
    throw new AuthError(XERR[xerr] ?? 'unknown', `xsts XErr ${xerr}`)
  }
  const xstsToken = XboxTokenSchema.safeParse(xsts.body)
  if (xsts.status !== 200 || !xstsToken.success) throw new AuthError('unknown', `xsts ${xsts.status}`)

  // 3. Minecraft access token
  const uhs = xstsToken.data.DisplayClaims.xui[0].uhs
  const mc = await requestJson(MC_LOGIN_URL, json({ identityToken: `XBL3.0 x=${uhs};${xstsToken.data.Token}` }))
  // 403 here means our Azure app is not (yet) allowed to use Minecraft services.
  if (mc.status === 403) throw new AuthError('appNotApproved', 'login_with_xbox 403')
  const mcToken = McLoginSchema.safeParse(mc.body)
  if (mc.status !== 200 || !mcToken.success) throw new AuthError('unknown', `mc login ${mc.status}`)

  // 4. Profile = proof the account owns Java Edition (Game Pass included)
  const profile = await fetchProfile(mcToken.data.access_token)
  return {
    accessToken: mcToken.data.access_token,
    expiresAt: Date.now() + mcToken.data.expires_in * 1000,
    profile,
  }
}

async function fetchProfile(accessToken: string): Promise<{ id: string; name: string }> {
  const res = await requestJson(MC_PROFILE_URL, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
    timeoutMs: HTTP_TIMEOUT_MS,
  })
  if (res.status === 404) throw new AuthError('notOwned')
  const parsed = ProfileSchema.safeParse(res.body)
  if (res.status !== 200 || !parsed.success) throw new AuthError('unknown', `profile ${res.status}`)
  return { id: parsed.data.id.toLowerCase(), name: parsed.data.name }
}
