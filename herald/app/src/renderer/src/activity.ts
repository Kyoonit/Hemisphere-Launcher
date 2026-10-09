import type { ActivityEntry } from '@herald/api'
import { ROLE_LABEL, type Role } from '@shared/heraldRoles'

/** One readable line per journal entry. */
export function describe(a: ActivityEntry): string {
  const name = (a.detail?.name as string | undefined) ?? 'a profile'
  const role = a.detail?.role ? ROLE_LABEL[a.detail.role as Role] : null
  switch (a.action) {
    case 'session.signin':
      return 'signed in'
    case 'session.signout':
      return 'signed out'
    case 'profile.bootstrap':
      return `was created as ${role}`
    case 'profile.create':
      return `created the profile ${name} (${role})`
    case 'profile.update':
      return `changed the profile ${name} (${role})`
    case 'profile.revoke':
      return `revoked ${name}`
    case 'profile.restore':
      return `restored ${name}`
    case 'profile.newCode':
      return `gave ${name} a new code`
    case 'profile.locked':
      return `${name} was locked after 5 wrong codes`
    default:
      return a.action
  }
}
