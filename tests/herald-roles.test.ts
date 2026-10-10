import { describe, expect, it } from 'vitest'
import { canChangeProfile, effectivePermissions, NEVER_FOR_LODGE_KEEPERS, ORIGINALS, PERMISSIONS } from '../src/shared/heraldRoles'
import { hashCode, newCode, normalizeCode } from '../herald/server/src/accounts'

describe('Herald roles', () => {
  it('Owner, Developer and Admins can do everything; Lodge keepers write news and events only', () => {
    expect(effectivePermissions('owner')).toContain('profiles.manage')
    expect(effectivePermissions('developer')).toContain('settings.staffCode')
    expect(effectivePermissions('admin')).toEqual(PERMISSIONS.filter((p) => p !== ORIGINALS))
    expect(effectivePermissions('owner')).toEqual([...PERMISSIONS])
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
    const admin = { role: 'admin' as const, permissions: effectivePermissions('admin') }
    expect(canChangeProfile(owner, null, { role: 'admin', add: [], remove: [] })).toBeNull()
    expect(canChangeProfile(dev, null, { role: 'owner', add: [], remove: [] })).toMatch(/only one Owner/)
    expect(canChangeProfile(dev, 'owner', { role: 'owner', add: [], remove: [] })).toMatch(/Only the Owner/)
    expect(canChangeProfile(admin, null, { role: 'developer', add: [], remove: [] })).toMatch(/above yours/)
    expect(canChangeProfile(admin, null, { role: 'moderator', add: ['pack.approve'], remove: [] })).toBeNull()
    expect(canChangeProfile({ role: 'admin', permissions: effectivePermissions('admin', [], ['pack.approve']) }, null, { role: 'moderator', add: ['pack.approve'], remove: [] })).toMatch(/do not have/)
    expect(canChangeProfile({ role: 'moderator', permissions: effectivePermissions('moderator') }, null, { role: 'moderator', add: [], remove: [] })).toMatch(/cannot manage/)
    // a profile above one's own is never changed (revoked, deleted, new code): an Admin and the Developer's profile
    expect(canChangeProfile(admin, 'developer', { role: 'developer', add: [], remove: [] })).toMatch(/profile above yours/)
    expect(canChangeProfile(admin, 'moderator', { role: 'admin', add: [], remove: [] })).toBeNull()
  })

  it('original catalogue files: the Owner; Admins only when the Owner or a Developer gives it', () => {
    const owner = { role: 'owner' as const, permissions: effectivePermissions('owner') }
    const dev = { role: 'developer' as const, permissions: effectivePermissions('developer') }
    const admin = { role: 'admin' as const, permissions: effectivePermissions('admin', [ORIGINALS]) }
    expect(effectivePermissions('developer')).not.toContain(ORIGINALS)
    expect(effectivePermissions('admin', [ORIGINALS])).toContain(ORIGINALS)
    expect(effectivePermissions('moderator', [ORIGINALS])).not.toContain(ORIGINALS) // only Admins can hold it
    expect(canChangeProfile(owner, 'admin', { role: 'admin', add: [ORIGINALS], remove: [] })).toBeNull()
    expect(canChangeProfile(dev, 'admin', { role: 'admin', add: [ORIGINALS], remove: [] })).toBeNull() // gives it without having it
    expect(canChangeProfile(admin, 'admin', { role: 'admin', add: [ORIGINALS], remove: [] })).toMatch(/Only the Owner or a Developer/)
    expect(canChangeProfile(owner, 'moderator', { role: 'moderator', add: [ORIGINALS], remove: [] })).toMatch(/only be given to Admins/)
    expect(effectivePermissions('lodgeKeeper', ['catalogue.write'])).not.toContain('catalogue.write')
    expect(effectivePermissions('moderator')).toContain('catalogue.write')
    expect(effectivePermissions('moderator')).not.toContain('catalogue.publish')
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
