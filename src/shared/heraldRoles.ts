/**
 * Herald roles and permissions, shared by the server (which enforces them) and the app (which hides what a profile
 * cannot use). Effective permissions = the role's defaults + the profile's additions − its removals, then the fixed
 * guards. Owner, Developer and Admins have every permission from the start (owner's decision, S12); the Developer is
 * technical access, not part of the staff hierarchy (Team shows it apart), its rank only protects it from changes.
 * Exception (owner's decision, 1.4): downloading the original model files of the catalogue is the Owner's; only the
 * Owner or a Developer can give it, and only to Admins.
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
  'catalogue.write', // add and edit catalogue items (models, skins) and their files
  'catalogue.publish', // show an item in the launchers, or hide it
  'catalogue.delete', // delete an item for good
  'catalogue.export', // download the original files (Owner; Admins only when the Owner or a Developer gives it)
] as const
export type Permission = (typeof PERMISSIONS)[number]

const ALL = [...PERMISSIONS]
/** Downloading the originals: anyone who has them can copy everything */
export const ORIGINALS: Permission = 'catalogue.export'
const ALL_BUT_ORIGINALS = ALL.filter((p) => p !== ORIGINALS)
const STAFF_CONTENT: Permission[] = ['news.write', 'events.write', 'publications.approve', 'publications.publish', 'publications.delete', 'publications.restore', 'banner.write', 'welcome.write', 'templates.write']

export const ROLE_DEFAULTS: Record<Role, readonly Permission[]> = {
  owner: ALL,
  developer: ALL_BUT_ORIGINALS,
  admin: ALL_BUT_ORIGINALS,
  moderator: [...STAFF_CONTENT, 'maintenance.emergency', 'catalogue.write'],
  lodgeKeeper: ['news.write', 'events.write'],
}

/** Lodge keepers are not staff: whatever is added to their profile, they never get these. */
export const NEVER_FOR_LODGE_KEEPERS: readonly Permission[] = [
  'maintenance.write', 'maintenance.emergency', 'restart.write', 'pack.propose', 'pack.approve', 'settings.public', 'settings.staffCode', 'profiles.manage', 'backgrounds.write', 'drafts.restricted',
  'catalogue.write', 'catalogue.publish', 'catalogue.delete', 'catalogue.export',
]

export function effectivePermissions(role: Role, add: readonly string[] = [], remove: readonly string[] = []): Permission[] {
  const known = new Set<string>(PERMISSIONS)
  const set = new Set<Permission>(ROLE_DEFAULTS[role])
  for (const p of add) if (known.has(p)) set.add(p as Permission)
  for (const p of remove) if (known.has(p)) set.delete(p as Permission)
  if (role === 'lodgeKeeper') for (const p of NEVER_FOR_LODGE_KEEPERS) set.delete(p)
  if (role !== 'owner' && role !== 'admin') set.delete(ORIGINALS)
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
 * changes a profile above their own, gives a role above their own or a permission they do not have themselves.
 */
export function canChangeProfile(actor: { role: Role; permissions: readonly Permission[] }, target: Role | null, next: ProfileChange): string | null {
  if (!actor.permissions.includes('profiles.manage')) return 'You cannot manage profiles.'
  if (target === 'owner' && actor.role !== 'owner') return 'Only the Owner can change the Owner profile.'
  if (next.role === 'owner' && target !== 'owner') return 'There is only one Owner.'
  if (target && ROLE_RANK[target] > ROLE_RANK[actor.role]) return 'You cannot change a profile above yours.'
  if (ROLE_RANK[next.role] > ROLE_RANK[actor.role]) return 'You cannot give a role above yours.'
  for (const p of next.add) {
    if (p === ORIGINALS) {
      if (actor.role !== 'owner' && actor.role !== 'developer') return 'Only the Owner or a Developer can give the download of original files.'
      if (next.role !== 'admin') return 'The download of original files can only be given to Admins.'
      continue
    }
    if (!actor.permissions.includes(p as Permission)) return `You cannot give a permission you do not have (${p}).`
  }
  return null
}
