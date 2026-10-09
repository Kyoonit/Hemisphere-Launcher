/** What the preload script exposes to Herald's interface (window.herald). The session token never leaves main. */
import type { Permission, Role } from '@shared/heraldRoles'
import type { FeedBase, ImageRef, MessageTemplate, Publication, PublicationData, PublicationTemplate, Status } from '@shared/heraldPublications'
import type { FeedV2 } from '@shared/feedV2'
import type { OpenedItems } from '@shared/schedule'
import type { Backgrounds } from '@shared/heraldBackgrounds'
import type { PublicSettings } from '@shared/heraldPublic'
import type { ClientManifest, ContentIndex } from '@shared/manifest'
import type { DraftMod, MinecraftRelease, ModReadiness, MrHit, PackProposal, Resolved } from '@shared/heraldPack'

export interface Profile {
  id: string
  name: string
  role: Role
  add: string[]
  remove: string[]
  permissions: Permission[]
  revoked: boolean
  online: boolean
  lastSeen: number | null
  createdAt: number
}

export interface ActivityEntry {
  id: number
  at: number
  action: string
  target: string | null
  who: string | null
  detail: Record<string, unknown> | null
}

export interface SyncState {
  now: number
  me: Profile
  people: Profile[]
  activity: ActivityEntry[]
  /** Changes whenever a publication or a publish job changes */
  contentStamp: string
}

export interface PublishJob {
  id: string
  status: 'queued' | 'publishing' | 'done' | 'failed' | 'superseded'
  error: string | null
  sequence: number | null
  reason: string | null
  who: string | null
  created_at: number
  updated_at: number
  /** When GitHub Actions took it */
  started_at: number | null
  commit_sha: string | null
}

export interface PublicationsState {
  now: number
  publications: Publication[]
  base: FeedBase
  /** What launchers read right now */
  live: { sequence: number; commit: string | null; at: number } | null
  jobs: PublishJob[]
  /** Version of `base`: sent back by the Server tab (a change based on an older one is refused) */
  baseVersion: number
  /** Ready-made publications ("Build contest"…) */
  publicationTemplates: PublicationTemplate[]
  /** Ready-made maintenance messages */
  maintenanceTemplates: MessageTemplate[]
  /** Home pictures by period, and their version (a change based on an older one is refused) */
  backgrounds: Backgrounds
  backgroundsVersion: number
  /** Launcher settings: support link, Discord id, staff code fingerprint (when and by whom it last changed) */
  publicSettings: PublicSettingsState
}

export interface PublicSettingsState {
  settings: PublicSettings
  version: number
  staffCodeAt: number | null
  staffCodeBy: string | null
}

/** GET /pack: the change waiting (if any) and the last ones; where the pack is published */
export interface PackState {
  proposals: PackProposal[]
  contentBase: string
}

/** The pack players have now, read from GitHub (Herald's content repository, else where it was published before) */
export interface OnlinePack {
  index: ContentIndex
  manifest: ClientManifest
  /** Where it was read */
  from: string
}

export interface PackVersion {
  id: string
  number: string
  type: 'release' | 'beta' | 'alpha'
  date: string | null
}

/** What launchers really get now (S11): the feed at the commit the pulse gives, checked like a launcher does */
export interface OnlineState {
  checkedAt: number
  pulse: { sequence: number; commit: string | null } | null
  /** The feed at that commit (null: none, or unreadable: see error) */
  feed: FeedV2 | null
  /** Signature checked with the content key of this environment */
  signed: boolean
  error: string | null
  /** Vaults whose time has come, opened like a launcher opens them */
  opened: OpenedItems
  /** Vault pictures opened (their SHA-512 → bytes) */
  pictures: Record<string, Uint8Array>
  /** Where the feed's files are (pictures in clear) */
  base: string | null
  /** GitHub's plain address serves the same feed (it caches up to 5 min: launchers that missed the pulse read it) */
  branchUpToDate: boolean | null
  /** The mod pack online */
  pack: { clientVersion: string; minecraft: string; sequence: number } | null
}

export interface ActivityPage {
  entries: ActivityEntry[]
  more: boolean
}

export interface PublicationDetail {
  publication: Publication
  versions: { version: number; status: Status; action: string; at: number; who: string | null }[]
  comments: { id: number; text: string; at: number; who: string | null; author: string }[]
}
export type { ImageRef, Publication, PublicationData }

export interface LocalSettings {
  /** IANA zone, or null = this PC's */
  timeZone: string | null
  /** Extra zones shown under every date */
  extraZones: string[]
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string }

export interface HeraldBridge {
  info(): Promise<{ version: string; server: string; staging: boolean }>
  session: {
    current(): Promise<Profile | null>
    signIn(name: string, code: string): Promise<ApiResult<Profile>>
    signOut(): Promise<void>
    /** Fires when the server ends the session (revoked, new code…) */
    onEnded(cb: () => void): () => void
  }
  api<T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<ApiResult<T>>
  settings: { get(): Promise<LocalSettings>; set(patch: Partial<LocalSettings>): Promise<LocalSettings> }
  window: { minimize(): void; toggleMaximize(): void; close(): void }
  copy(text: string): void
  images: { upload(bytes: Uint8Array, width: number, height: number): Promise<ApiResult<ImageRef>>; get(id: string): Promise<Uint8Array | null> }
  update: { state(): Promise<UpdateState>; onState(cb: (s: UpdateState) => void): () => void; install(): void }
  launcher: {
    /** A new staff code: made and fingerprinted on this PC, only the fingerprint is sent; the code comes back once */
    newStaffCode(version: number): Promise<ApiResult<PublicSettingsState & { code: string; job: string }>>
    /** The Discord application behind an id (its name), for "Playing on Hemisphere SMP" */
    checkDiscord(id: string): Promise<{ ok: true; name: string } | { ok: false; reason: 'notApp' | 'network' }>
    /** The launcher version players get today (latest GitHub release) */
    latest(): Promise<string | null>
  }
  /** What launchers really get now (S11) */
  online(): Promise<OnlineState>
  /** Mod pack (S10): Modrinth is read from this PC; the server only keeps the proposals */
  pack: {
    online(contentBase: string): Promise<OnlinePack | null>
    search(query: string, minecraft: string): Promise<ApiResult<MrHit[]>>
    versions(projectId: string, minecraft: string): Promise<ApiResult<PackVersion[]>>
    resolve(minecraft: string, mods: DraftMod[]): Promise<ApiResult<Resolved>>
    newest(minecraft: string, mods: { projectId: string; beta?: boolean }[]): Promise<ApiResult<Record<string, { versionId: string; version: string } | null>>>
    /** Minecraft releases (Mojang), newest first, and the snapshot being tested; null = Mojang unreachable */
    minecraft(): Promise<{ releases: (MinecraftRelease & { type: string; releaseTime: string })[]; snapshot: string | null } | null>
    /** Fabric loaders for a Minecraft version, newest first ([] = Fabric not ready yet; null = unreachable) */
    fabric(minecraft: string): Promise<{ version: string; stable: boolean }[] | null>
    /** Which mods already have a build for this Minecraft */
    readiness(minecraft: string, mods: { id: string; name: string; category: string; source?: { modrinth: { projectId: string; versionId: string } } }[]): Promise<ApiResult<ModReadiness[]>>
    /** Pick a config file on this PC and send it to the server (≤ 1 MB) */
    addFile(): Promise<ApiResult<{ name: string; sha512: string; size: number; url: string; seal: { key: string; sha512: string; size: number } }> | null>
  }
}

export type UpdateState = { phase: 'idle' } | { phase: 'downloading'; version: string } | { phase: 'ready'; version: string }
