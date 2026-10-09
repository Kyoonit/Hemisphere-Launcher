/**
 * Herald roles and permissions, shared by the server (which enforces them) and the app (which hides what a profile
 * cannot use). Effective permissions = the role's defaults + the profile's additions − its removals, then the fixed
 * guards. The per-role split below is a FIRST PROPOSAL (the owner decides it later, DECISIONS.md § 19).
 */

export const ROLES = ['owner', 'developer', 'admin', 'moderator', 'lodgeKeeper'] as const
export type Role = (typeof ROLES)[number]
export const ROLE_RANK: Record<Role, number> = { owner: 5, developer: 4, admin: 3, moderator: 2, lodgeKeeper: 1 }
export const ROLE_LABEL: Record<Role, string> = { owner: 'Owner', developer: 'Developer', admin: 'Admin', moderator: 'Moderator', lodgeKeeper: 'Lodge keeper' }

export const PERMISSIONS = [
  'news.write', // create and edit news
  'events.write',
  'publications.approve', // mark a publication "Ready" (it is then locked until reopened)
  'publications.publish', // schedule / publish / unpublish news and events
  'publications.delete',
  'publications.restore', // trash
  'drafts.restricted', // see drafts restricted to admins
  'banner.write',
  'welcome.write',
  'backgrounds.write',
  'maintenance.write', // plan maintenances
  'maintenance.emergency', // start / end a maintenance now
  'restart.write',
  'pack.propose',
  'pack.approve',
  'settings.public', // support link, Discord id
  'settings.staffCode',
  'profiles.manage', // create, revoke, change roles, new codes
  'templates.write',
] as const
export type Permission = (typeof PERMISSIONS)[number]

const ALL = [...PERMISSIONS]
const STAFF_CONTENT: Permission[] = ['news.write', 'events.write', 'publications.approve', 'publications.publish', 'publications.delete', 'publications.restore', 'banner.write', 'welcome.write', 'templates.write']

export const ROLE_DEFAULTS: Record<Role, readonly Permission[]> = {
  owner: ALL,
  developer: ALL,
  admin: [...STAFF_CONTENT, 'drafts.restricted', 'backgrounds.write', 'maintenance.write', 'maintenance.emergency', 'restart.write', 'pack.propose', 'settings.public'],
  moderator: [...STAFF_CONTENT, 'maintenance.emergency'],
  lodgeKeeper: ['news.write', 'events.write'],
}

/** Lodge keepers are not staff: whatever is added to their profile, they never get these. */
export const NEVER_FOR_LODGE_KEEPERS: readonly Permission[] = [
  'maintenance.write', 'maintenance.emergency', 'restart.write', 'pack.propose', 'pack.approve', 'settings.public', 'settings.staffCode', 'profiles.manage', 'backgrounds.write', 'drafts.restricted',
]

export function effectivePermissions(role: Role, add: readonly string[] = [], remove: readonly string[] = []): Permission[] {
  const known = new Set<string>(PERMISSIONS)
  const set = new Set<Permission>(ROLE_DEFAULTS[role])
  for (const p of add) if (known.has(p)) set.add(p as Permission)
  for (const p of remove) if (known.has(p)) set.delete(p as Permission)
  if (role === 'lodgeKeeper') for (const p of NEVER_FOR_LODGE_KEEPERS) set.delete(p)
  return PERMISSIONS.filter((p) => set.has(p))
}

export interface ProfileChange {
  role: Role
  add: string[]
  remove: string[]
}

/**
 * Can `actor` (role + effective permissions) give `target` (current role, or null for a new profile) this change?
 * Fixed guards: only profile managers; only the Owner touches the Owner role; nobody creates a second Owner; nobody
 * gives a role above their own or a permission they do not have themselves.
 */
export function canChangeProfile(actor: { role: Role; permissions: readonly Permission[] }, target: Role | null, next: ProfileChange): string | null {
  if (!actor.permissions.includes('profiles.manage')) return 'You cannot manage profiles.'
  if (target === 'owner' && actor.role !== 'owner') return 'Only the Owner can change the Owner profile.'
  if (next.role === 'owner' && target !== 'owner') return 'There is only one Owner.'
  if (ROLE_RANK[next.role] > ROLE_RANK[actor.role]) return 'You cannot give a role above yours.'
  for (const p of next.add) if (!actor.permissions.includes(p as Permission)) return `You cannot give a permission you do not have (${p}).`
  return null
}
