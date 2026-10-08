/**
 * Developer tab: pretend situations on top of the real data, to look at and stress-test every screen. Always there in
 * development builds; in the installed launcher only after a staff member enters the staff code (Settings > Advanced),
 * on that PC. Everything it does is local and pretend: nothing reaches the server or other players.
 */

/**
 * The staff code's scrypt fingerprint (never the code itself). Staff can switch to another code without a launcher
 * update: "staffCode" in the signed feed (npm run staff-code).
 */
export const STAFF_CODE = { salt: '336346ae39989f4a89171f788028b588', hash: '7ae5e5f1d21abb2404b85d4a0464173ee4dbb33834555c66802f77986206ad92ec969ca3b7ad8cfbc92f25c7d053619a7b590ced3f83810c7320e2340241288d' }
export const STAFF_CODE_SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 }

/** What the page needs to know about the tab. */
export interface DevAccess {
  /** a development build: the tab is always there */
  devBuild: boolean
  /** the staff code was entered on this PC */
  unlocked: boolean
  state: DevState | null
}
/** seconds = how long before the next try is allowed (like Windows' sign-in: each wrong code waits longer) */
export type DevUnlockResult = { ok: true } | { ok: false; reason: 'wrong' | 'wait'; seconds: number }

/** Wait after the 1st, 2nd… wrong code, in seconds (the last one repeats). */
export const UNLOCK_WAITS = [3, 5, 10, 30, 60, 120, 300]

export interface DevState {
  /** a live event, one starting in 16 minutes (its reminder fires about a minute later), one in 3 days */
  sampleEvents: boolean
  maintenance: boolean
  /** daily restart: soon = in 3 minutes, now = restarting */
  restart: 'real' | 'soon' | 'now'
  /** extra unread news items (the red badge, "9+") */
  extraNews: number
  /** few = 3 players, busy = 30 listed of 137, full = 420/420 */
  server: 'real' | 'few' | 'busy' | 'full' | 'offline' | 'unknown'
  launcherUpdate: 'real' | 'downloading' | 'ready' | 'error'
  preflight: boolean
  /** your own Discord application id, to try the Discord status before staff publish theirs */
  discordAppId: string
  /** when the sample events / restart were switched on (their times are relative to it) */
  base: number
}

export const DEFAULT_DEV: DevState = {
  sampleEvents: false,
  maintenance: false,
  restart: 'real',
  extraNews: 0,
  server: 'real',
  launcherUpdate: 'real',
  preflight: false,
  discordAppId: '',
  base: 0,
}

export const DEV_ACTIONS = [
  'crash',
  'crash:many',
  'crash:memory',
  'error:network',
  'error:java',
  'error:disk',
  'error:busy',
  'error:sessionExpired',
  'error:content',
  'progress',
  'background',
  'clearError',
  'notify:back',
  'restart:simulate',
  'notify:event',
  'notify:all',
  'discord:test',
  'discord:clear',
  'shots:add',
  'shots:remove',
  'reset:seen',
  'window:960x600',
  'window:1120x700',
  'window:1600x900',
  'open:data',
  'release:test',
  'recap:sample',
  'ui:reload',
  'ui:devtools',
  'zoom:0.9',
  'zoom:1',
  'zoom:1.1',
  'zoom:1.25',
] as const
export type DevAction = (typeof DEV_ACTIONS)[number]
