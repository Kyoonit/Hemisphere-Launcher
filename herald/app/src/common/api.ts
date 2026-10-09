/** What the preload script exposes to Herald's interface (window.herald). The session token never leaves main. */
import type { Permission, Role } from '@shared/heraldRoles'
import type { FeedBase, ImageRef, Publication, PublicationData, Status } from '@shared/heraldPublications'

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
}

export interface PublicationsState {
  now: number
  publications: Publication[]
  base: FeedBase
  /** What launchers read right now */
  live: { sequence: number; commit: string | null; at: number } | null
  jobs: PublishJob[]
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
}

export type UpdateState = { phase: 'idle' } | { phase: 'downloading'; version: string } | { phase: 'ready'; version: string }
