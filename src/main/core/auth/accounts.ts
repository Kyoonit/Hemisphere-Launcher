import { app, safeStorage } from 'electron'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type { AccountInfo, AccountsState, AuthResult } from '@shared/auth'
import { MS_CLIENT_ID } from './config'
import { AuthError, toAuthCode } from './errors'
import { refreshMsTokens, signInWithBrowser } from './oauth'
import { minecraftSessionFromMs, type MinecraftSession } from './minecraft'
import { offlineUuid } from './offlineUuid'
import { devUnlocked } from '../dev/devTools'

/**
 * Accounts on this PC. On disk (%APPDATA%/Hemisphere Launcher/accounts.json) we keep only the profile
 * and the Microsoft refresh token, encrypted with Windows DPAPI via Electron safeStorage.
 * Minecraft access tokens live in memory only.
 */

const StoredAccountSchema = z.object({
  id: z.string().regex(/^[0-9a-f]{32}$/),
  name: z.string().min(1).max(16),
  kind: z.enum(['microsoft', 'offline']),
  refreshToken: z.string().optional(), // base64 of safeStorage-encrypted bytes
})
const StoreSchema = z.object({
  version: z.literal(1),
  activeId: z.string().nullable(),
  accounts: z.array(StoredAccountSchema),
})
type StoredAccount = z.infer<typeof StoredAccountSchema>

const filePath = () => join(app.getPath('userData'), 'accounts.json')
/**
 * Offline test accounts (no Microsoft sign-in; singleplayer only, the server refuses them): development builds, or the
 * installed launcher once a staff member entered the staff code on this PC (sign-in screen, hidden). Lets staff test
 * every feature before Microsoft/Mojang approve the launcher.
 */
const devOfflineAllowed = () => !app.isPackaged || devUnlocked()

let store: z.infer<typeof StoreSchema> = { version: 1, activeId: null, accounts: [] }
const sessions = new Map<string, MinecraftSession>()
const expired = new Set<string>()
/** Refresh tokens that couldn't be encrypted (no OS keystore): kept for this run only. */
const memoryOnlyTokens = new Map<string, string>()
let onChange: () => void = () => {}

export function onAccountsChanged(cb: () => void): void {
  onChange = cb
}

export async function loadAccounts(): Promise<void> {
  try {
    const parsed = StoreSchema.safeParse(JSON.parse(await readFile(filePath(), 'utf8')))
    if (parsed.success) store = parsed.data
  } catch {
    /* first run */
  }
  // Released builds keep offline test accounts only on a staff PC.
  if (!devOfflineAllowed()) store.accounts = store.accounts.filter((a) => a.kind === 'microsoft')
  if (store.activeId && !store.accounts.some((a) => a.id === store.activeId)) store.activeId = store.accounts[0]?.id ?? null
}

async function save(): Promise<void> {
  const tmp = `${filePath()}.tmp`
  await writeFile(tmp, JSON.stringify(store, null, 2), 'utf8')
  await rename(tmp, filePath())
  onChange()
}

/** The staff code was entered or removed: the sign-in screen shows (or hides) the offline test account. */
export async function onStaffAccessChanged(): Promise<void> {
  if (!devOfflineAllowed() && store.accounts.some((a) => a.kind === 'offline')) {
    store.accounts = store.accounts.filter((a) => a.kind === 'microsoft')
    if (store.activeId && !store.accounts.some((a) => a.id === store.activeId)) store.activeId = store.accounts[0]?.id ?? null
    await save()
  } else onChange()
}

export function getAccountsState(): AccountsState {
  return {
    accounts: store.accounts.map(toInfo),
    activeId: store.activeId,
    devOfflineAllowed: devOfflineAllowed(),
    microsoftConfigured: MS_CLIENT_ID !== '',
  }
}

const toInfo = (a: StoredAccount): AccountInfo => ({
  id: a.id,
  name: a.name,
  kind: a.kind,
  status: expired.has(a.id) ? 'expired' : 'ok',
})

function encryptToken(id: string, token: string): string | undefined {
  if (!safeStorage.isEncryptionAvailable()) {
    memoryOnlyTokens.set(id, token)
    return undefined
  }
  return safeStorage.encryptString(token).toString('base64')
}

function decryptToken(a: StoredAccount): string | null {
  if (memoryOnlyTokens.has(a.id)) return memoryOnlyTokens.get(a.id)!
  if (!a.refreshToken || !safeStorage.isEncryptionAvailable()) return null
  try {
    return safeStorage.decryptString(Buffer.from(a.refreshToken, 'base64'))
  } catch {
    return null
  }
}

/** Full Microsoft sign-in in the browser. Adds (or updates) the account and makes it active. */
export async function signIn(language: string): Promise<AuthResult> {
  try {
    const ms = await signInWithBrowser(language)
    const session = await minecraftSessionFromMs(ms.access_token)
    const { id, name } = session.profile
    const entry: StoredAccount = { id, name, kind: 'microsoft', refreshToken: encryptToken(id, ms.refresh_token) }
    store.accounts = [...store.accounts.filter((a) => a.id !== id), entry]
    store.activeId = id
    sessions.set(id, session)
    expired.delete(id)
    await save()
    return { ok: true, account: toInfo(entry) }
  } catch (err) {
    console.warn('[auth] sign-in failed:', err instanceof Error ? err.message : err)
    return { ok: false, code: toAuthCode(err) }
  }
}

/** Staff/dev only: an offline account to test the launcher before Microsoft approves the app. */
export async function addDevOfflineAccount(name: string): Promise<AuthResult> {
  if (!devOfflineAllowed() || !/^[A-Za-z0-9_]{3,16}$/.test(name)) return { ok: false, code: 'unknown' }
  const entry: StoredAccount = { id: offlineUuid(name), name, kind: 'offline' }
  store.accounts = [...store.accounts.filter((a) => a.id !== entry.id), entry]
  store.activeId = entry.id
  await save()
  return { ok: true, account: toInfo(entry) }
}

export async function switchAccount(id: string): Promise<void> {
  if (!store.accounts.some((a) => a.id === id)) return
  store.activeId = id
  await save()
  void refreshAccount(id)
}

export async function signOut(id: string): Promise<void> {
  store.accounts = store.accounts.filter((a) => a.id !== id)
  sessions.delete(id)
  expired.delete(id)
  memoryOnlyTokens.delete(id)
  if (store.activeId === id) store.activeId = store.accounts[0]?.id ?? null
  await save()
}

/**
 * Renews the Minecraft session from the stored refresh token (silently, at startup and on switch).
 * A revoked/expired Microsoft session marks the account "expired"; network problems are ignored.
 */
export async function refreshAccount(id: string | null = store.activeId): Promise<void> {
  const account = store.accounts.find((a) => a.id === id)
  if (!account || account.kind !== 'microsoft') return
  const session = sessions.get(account.id)
  if (session && session.expiresAt - Date.now() > 10 * 60_000) return

  const refreshToken = decryptToken(account)
  try {
    if (!refreshToken) throw new AuthError('microsoftDenied', 'no stored token')
    const ms = await refreshMsTokens(refreshToken)
    const fresh = await minecraftSessionFromMs(ms.access_token)
    sessions.set(account.id, fresh)
    account.refreshToken = encryptToken(account.id, ms.refresh_token) // Microsoft rotates refresh tokens
    account.name = fresh.profile.name // name changes are picked up automatically
    expired.delete(account.id)
    await save()
  } catch (err) {
    const code = toAuthCode(err)
    if (code === 'network' || code === 'notConfigured') return
    console.warn('[auth] refresh failed:', err instanceof Error ? err.message : err)
    expired.add(account.id)
    onChange()
  }
}

export interface LaunchCredentials {
  name: string
  uuid: string
  accessToken: string
  userType: 'msa' | 'legacy'
}

/** Fresh credentials to start the game with. Throws AuthError('microsoftDenied') if the session can't be renewed. */
export async function getLaunchCredentials(id: string): Promise<LaunchCredentials> {
  const account = store.accounts.find((a) => a.id === id)
  if (!account) throw new AuthError('unknown', 'no such account')
  if (account.kind === 'offline') {
    if (!devOfflineAllowed()) throw new AuthError('unknown', 'offline accounts are dev-only')
    return { name: account.name, uuid: account.id, accessToken: '0', userType: 'legacy' }
  }
  await refreshAccount(id)
  const session = sessions.get(id)
  if (!session || expired.has(id)) throw new AuthError('microsoftDenied', 'session expired')
  return { name: session.profile.name, uuid: session.profile.id, accessToken: session.accessToken, userType: 'msa' }
}
