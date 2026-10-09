import type { ActivityEntry } from '@herald/api'
import { ROLE_LABEL, type Role } from '@shared/heraldRoles'

const KIND: Record<string, string> = { news: 'news', event: 'event', banner: 'banner', welcome: 'welcome message' }

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
    case 'maintenance.plan':
      return `planned a maintenance (“${a.detail?.message ?? ''}”)`
    case 'maintenance.update':
      return `changed a planned maintenance (“${a.detail?.message ?? ''}”)`
    case 'maintenance.delete':
      return `removed a planned maintenance (“${a.detail?.message ?? ''}”)`
    case 'maintenance.start':
      return `started a maintenance now (“${a.detail?.message ?? ''}”)`
    case 'maintenance.end':
      return 'said the server is back online (maintenance ended)'
    case 'backgrounds.update': {
      const changed = (a.detail?.changed as string[] | undefined) ?? []
      const removed = (a.detail?.removed as string[] | undefined) ?? []
      return `changed the Home backgrounds (${[...changed, ...removed.map((n) => `${n} removed`)].join(', ') || 'no change'})`
    }
    case 'templates.update':
      return 'changed the maintenance message templates'
    case 'restart.update':
      return `changed the daily restart (${a.detail?.time ?? ''} ${a.detail?.timeZone ?? ''})`
  }
  const what = `the ${KIND[a.detail?.kind as string] ?? 'publication'} “${(a.detail?.title as string | undefined) ?? '…'}”`
  switch (a.action) {
    case 'publication.create':
      return `created ${what}`
    case 'publication.edit':
      return `edited ${what}`
    case 'publication.review':
      return `sent ${what} to review`
    case 'publication.ready':
      return `marked ${what} Ready`
    case 'publication.reopen':
      return `reopened ${what}`
    case 'publication.publish':
      return `published ${what}`
    case 'publication.schedule':
      return `scheduled ${what}`
    case 'publication.unpublish':
      return `took ${what} down`
    case 'publication.delete':
      return `moved ${what} to the trash`
    case 'publication.restore':
      return `restored ${what}`
    case 'publication.comment':
      return `commented on ${what}`
    default:
      return a.action
  }
}
