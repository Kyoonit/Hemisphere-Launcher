import { describe, expect, it } from 'vitest'
import { canChangeProfile, effectivePermissions, NEVER_FOR_LODGE_KEEPERS } from '../src/shared/heraldRoles'
import { hashCode, newCode, normalizeCode } from '../herald/server/src/accounts'

describe('Herald roles', () => {
  it('Owner and Developer can do everything; Lodge keepers write news and events only', () => {
    expect(effectivePermissions('owner')).toContain('profiles.manage')
    expect(effectivePermissions('developer')).toContain('settings.staffCode')
    expect(effectivePermissions('lodgeKeeper')).toEqual(['news.write', 'events.write'])
  })

  it('per-profile additions and removals, but Lodge keepers never get staff powers', () => {
    expect(effectivePermissions('moderator', ['restart.write'])).toContain('restart.write')
    expect(effectivePermissions('admin', [], ['maintenance.emergency'])).not.toContain('maintenance.emergency')
    const lk = effectivePermissions('lodgeKeeper', [...NEVER_FOR_LODGE_KEEPERS, 'publications.publish'])
    for (const p of NEVER_FOR_LODGE_KEEPERS) expect(lk).not.toContain(p)
    expect(lk).toContain('publications.publish')
    expect(effectivePermissions('admin', ['not.a.permission'])).not.toContain('not.a.permission')
  })

  it('fixed guards on profile changes', () => {
    const owner = { role: 'owner' as const, permissions: effectivePermissions('owner') }
    const dev = { role: 'developer' as const, permissions: effectivePermissions('developer') }
    const admin = { role: 'admin' as const, permissions: effectivePermissions('admin', ['profiles.manage']) }
    expect(canChangeProfile(owner, null, { role: 'admin', add: [], remove: [] })).toBeNull()
    expect(canChangeProfile(dev, null, { role: 'owner', add: [], remove: [] })).toMatch(/only one Owner/)
    expect(canChangeProfile(dev, 'owner', { role: 'owner', add: [], remove: [] })).toMatch(/Only the Owner/)
    expect(canChangeProfile(admin, null, { role: 'developer', add: [], remove: [] })).toMatch(/above yours/)
    expect(canChangeProfile(admin, null, { role: 'moderator', add: ['pack.approve'], remove: [] })).toMatch(/do not have/)
    expect(canChangeProfile({ role: 'admin', permissions: effectivePermissions('admin') }, null, { role: 'moderator', add: [], remove: [] })).toMatch(/cannot manage/)
  })
})

describe('profile codes', () => {
  it('are random, readable, and compared without dashes or case', async () => {
    const a = newCode()
    expect(a).toMatch(/^[2-9A-HJKMNP-Z]{5}(-[2-9A-HJKMNP-Z]{5}){3}$/)
    expect(newCode()).not.toBe(a)
    expect(normalizeCode(a.toLowerCase().replace(/-/g, ' '))).toBe(a.replace(/-/g, ''))
    expect(await hashCode('pepper', a)).toBe(await hashCode('pepper', a.toLowerCase()))
    expect(await hashCode('pepper', a)).not.toBe(await hashCode('other pepper', a))
  })
})
