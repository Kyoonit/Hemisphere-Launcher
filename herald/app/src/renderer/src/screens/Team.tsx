import { useEffect, useState } from 'react'
import type { Profile } from '@herald/api'
import { effectivePermissions, ORIGINALS, PERMISSIONS, ROLE_DEFAULTS, ROLE_LABEL, ROLE_RANK, ROLES, NEVER_FOR_LODGE_KEEPERS, type Permission, type Role } from '@shared/heraldRoles'
import { useStore } from '../store'
import { Avatar, Modal } from '../components/ui'
import { Journal, Trash } from './Journal'
import { ago } from '../time'

/** The staff, top to bottom; the Developer is apart (technical access, not part of the staff) */
const GROUPS: { role: Role; title: string; note?: string }[] = [
  { role: 'owner', title: 'Owner' },
  { role: 'admin', title: 'Admins' },
  { role: 'moderator', title: 'Moderators' },
  { role: 'lodgeKeeper', title: 'Lodge keepers', note: 'not staff: articles and events only' },
]
const APART: { role: Role; title: string; note?: string }[] = [{ role: 'developer', title: 'Developers', note: 'technical access to Herald and the launcher, not part of the staff' }]

export default function Team({ onOpen }: { onOpen(id: string): void }) {
  const { sync, can, refresh } = useStore()
  const manage = can('profiles.manage')
  const [view, setView] = useState<'people' | 'activity' | 'trash'>('people')
  const [all, setAll] = useState<Profile[] | null>(null)
  const [editing, setEditing] = useState<Profile | null>(null)
  const [creating, setCreating] = useState(false)
  const [code, setCode] = useState<{ name: string; code: string } | null>(null)

  const load = async () => {
    if (!manage) return
    const res = await window.herald.api<Profile[]>('GET', '/profiles')
    if (res.ok) setAll(res.data)
  }
  useEffect(() => {
    void load()
  }, [manage, sync?.people.length])

  const people = all ?? sync?.people ?? []
  const now = sync?.now ?? Date.now()
  const done = async () => {
    await Promise.all([load(), refresh()])
  }

  return (
    <div className="animate-fade">
      <div className="mb-4 flex items-end">
        <div>
          <div className="eyebrow">Hemisphere staff</div>
          <h1 className="text-[26px] font-extrabold text-white">Team</h1>
        </div>
        {manage && (
          <button className="btn btn-primary ml-auto" onClick={() => setCreating(true)}>
            ＋ New profile
          </button>
        )}
      </div>
      <div className="mb-4 flex gap-1 border-b border-gray-700">
        {(['people', 'activity', 'trash'] as const).map((v) => (
          <button key={v} className={`-mb-px border-b-2 px-3.5 py-2 text-sm font-semibold capitalize ${view === v ? 'border-green-400 text-white' : 'border-transparent text-gray-400'}`} onClick={() => setView(v)}>
            {v}
          </button>
        ))}
      </div>

      {view === 'people' &&
        [...GROUPS, ...APART, ...(manage ? [{ role: null, title: 'Revoked', note: 'cannot sign in; can be restored, or deleted for good' }] : [])].map((g) => {
          // revoked profiles: only for profile managers (never Lodge keepers)
          const list = people.filter((p) => (g.role === null ? p.revoked && manage : p.role === g.role && !p.revoked))
          if (!list.length) return null
          return (
            <section key={g.title} className={`mb-5 ${APART.some((a) => a.title === g.title) ? 'mt-8 border-t border-gray-700 pt-5' : ''}`}>
              <h3 className="mb-2 text-xs font-bold tracking-widest text-gray-400 uppercase">
                {g.title} {list.length > 1 && `· ${list.length}`} {g.note && <span className="font-normal tracking-normal normal-case">· {g.note}</span>}
              </h3>
              <div className="grid grid-cols-4 gap-2.5">
                {list.map((p) => (
                  <button key={p.id} className={`flex items-center gap-2.5 rounded-lg bg-gray-800 px-3 py-2.5 text-left ${manage ? 'hover:bg-gray-700' : 'cursor-default'} ${p.revoked ? 'opacity-60' : ''}`} onClick={() => manage && setEditing(p)}>
                    <Avatar name={p.name} />
                    <span className="min-w-0">
                      <b className="block truncate text-[13.5px] text-white">{p.name}</b>
                      <span className="block truncate text-xs text-gray-400">{p.online ? 'online' : p.lastSeen ? `seen ${ago(p.lastSeen, now)}` : 'never signed in'}</span>
                    </span>
                    <span className={`ml-auto size-2 shrink-0 rounded-full ${p.online ? 'bg-green-400' : 'bg-gray-600'}`} />
                  </button>
                ))}
              </div>
            </section>
          )
        })}

      {view === 'activity' && <Journal onOpen={onOpen} />}
      {view === 'trash' && <Trash onOpen={onOpen} />}

      {creating && <NewProfile onClose={() => setCreating(false)} onCreated={(name, c) => (setCreating(false), setCode({ name, code: c }), void done())} />}
      {editing && <EditProfile profile={editing} onClose={() => setEditing(null)} onChanged={() => (setEditing(null), void done())} onCode={(c) => (setEditing(null), setCode({ name: editing.name, code: c }))} />}
      {code && <CodeShown {...code} onClose={() => setCode(null)} />}
    </div>
  )
}

/** Roles this profile may give (never above its own; the Owner role is never given). */
function givableRoles(actor: Role): Role[] {
  return (['admin', 'moderator', 'lodgeKeeper', 'developer'] as Role[]).filter((r) => ROLES.includes(r) && ROLE_RANK[r] <= ROLE_RANK[actor])
}

function NewProfile({ onClose, onCreated }: { onClose(): void; onCreated(name: string, code: string): void }) {
  const { me } = useStore()
  const [name, setName] = useState('')
  const [role, setRole] = useState<Role>('moderator')
  const [error, setError] = useState<string | null>(null)
  const create = async () => {
    const res = await window.herald.api<{ id: string; code: string }>('POST', '/profiles', { name, role })
    if (res.ok) onCreated(name.trim(), res.data.code)
    else setError(res.error)
  }
  return (
    <Modal title="New profile" onClose={onClose}>
      <label className="label">Name</label>
      <input className="field mb-3" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
      <label className="label">Role</label>
      <select className="field" value={role} onChange={(e) => setRole(e.target.value as Role)}>
        {givableRoles(me.role).map((r) => (
          <option key={r} value={r}>
            {ROLE_LABEL[r]}
          </option>
        ))}
      </select>
      <p className="mt-2 text-xs text-gray-400">
        {role === 'admin' ? 'Admins have every permission (but downloading original catalogue files, which only the Owner or a Developer can give).' : 'Permissions can be adjusted after creation.'} {role === 'developer' && 'Developers have technical access, apart from the staff.'} A code is generated and shown once.
      </p>
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={!name.trim()} onClick={() => void create()}>
          Create
        </button>
      </div>
    </Modal>
  )
}

function EditProfile({ profile, onClose, onChanged, onCode }: { profile: Profile; onClose(): void; onChanged(): void; onCode(code: string): void }) {
  const { me } = useStore()
  const [role, setRole] = useState<Role>(profile.role)
  const [perms, setPerms] = useState<Set<Permission>>(new Set(profile.permissions))
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const self = profile.id === me.id
  const locked = (profile.role === 'owner' && me.role !== 'owner') || ROLE_RANK[profile.role] > ROLE_RANK[me.role]
  const defaults = new Set<string>(ROLE_DEFAULTS[role])
  const forbidden = (p: Permission) => (role === 'lodgeKeeper' && NEVER_FOR_LODGE_KEEPERS.includes(p)) || (p === ORIGINALS && role !== 'admin' && role !== 'owner')
  // original catalogue files: the Owner's; only the Owner or a Developer gives them, only to Admins
  const cannotGive = (p: Permission) => (p === ORIGINALS ? (me.role !== 'owner' && me.role !== 'developer') || role !== 'admin' : !me.permissions.includes(p) && !perms.has(p))

  const save = async (patch: Record<string, unknown>) => {
    const res = await window.herald.api<Profile>('PATCH', `/profiles/${profile.id}`, patch)
    if (res.ok) onChanged()
    else setError(res.error)
  }
  const saveRoleAndPerms = () => {
    const add = [...perms].filter((p) => !defaults.has(p))
    const remove = [...defaults].filter((p) => !perms.has(p as Permission))
    void save({ role, add, remove })
  }
  const remove = async () => {
    const res = await window.herald.api('POST', `/profiles/${profile.id}/delete`)
    if (res.ok) onChanged()
    else (setDeleting(false), setError(res.error))
  }
  const newCode = async () => {
    const res = await window.herald.api<{ code: string }>('POST', `/profiles/${profile.id}/code`)
    if (res.ok) onCode(res.data.code)
    else setError(res.error)
  }

  return (
    <Modal title={profile.name} onClose={onClose}>
      <label className="label">Role</label>
      <select
        className="field mb-3"
        value={role}
        disabled={self || locked}
        onChange={(e) => {
          const r = e.target.value as Role
          setRole(r)
          setPerms(new Set(effectivePermissions(r)))
        }}
      >
        {(profile.role === 'owner' ? ['owner' as Role] : givableRoles(me.role)).map((r) => (
          <option key={r} value={r}>
            {ROLE_LABEL[r]}
          </option>
        ))}
      </select>
      <label className="label">Permissions ({ROLE_LABEL[role]} defaults, adjusted for this person)</label>
      <div className="mb-3 grid max-h-52 grid-cols-2 gap-x-3 gap-y-1 overflow-auto rounded-md border border-gray-700 p-2 text-xs">
        {PERMISSIONS.map((p) => (
          <label key={p} className={`flex items-center gap-1.5 ${forbidden(p) ? 'opacity-40' : ''}`}>
            <input
              type="checkbox"
              disabled={locked || forbidden(p) || cannotGive(p)}
              checked={perms.has(p) && !forbidden(p)}
              onChange={(e) => {
                const next = new Set(perms)
                if (e.target.checked) next.add(p)
                else next.delete(p)
                setPerms(next)
              }}
            />
            <span className={defaults.has(p) ? 'text-gray-200' : 'text-amber-400'}>{p}</span>
          </label>
        ))}
      </div>
      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {!self && !locked && (profile.revoked ? (
          <>
            <button className="btn btn-sm" onClick={() => void save({ revoked: false })}>
              Restore
            </button>
            <button className="btn btn-sm btn-danger" onClick={() => setDeleting(true)}>
              Delete for good
            </button>
          </>
        ) : (
          <button className="btn btn-sm btn-danger" onClick={() => void save({ revoked: true })}>
            Revoke
          </button>
        ))}
        {!locked && (
          <button className="btn btn-sm" onClick={() => void newCode()}>
            New code
          </button>
        )}
        <span className="ml-auto" />
        <button className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={locked} onClick={saveRoleAndPerms}>
          Save
        </button>
      </div>
      {deleting && (
        <Modal title={`Delete ${profile.name} for good?`} onClose={() => setDeleting(false)}>
          <p className="mb-4 text-sm text-gray-300">
            The profile is deleted for good: it cannot be restored, and the name {profile.name} can be given to a new profile. What {profile.name} did stays in the journal
            under this name.
          </p>
          <div className="flex justify-end gap-2">
            <button className="btn btn-ghost" onClick={() => setDeleting(false)}>
              Cancel
            </button>
            <button className="btn btn-danger" onClick={() => void remove()}>
              Delete {profile.name}
            </button>
          </div>
        </Modal>
      )}
    </Modal>
  )
}

function CodeShown({ name, code, onClose }: { name: string; code: string; onClose(): void }) {
  const [copied, setCopied] = useState(false)
  return (
    <Modal title={`${name} can now sign in`}>
      <p className="text-sm text-gray-300">
        This code is shown <b className="text-white">only once</b>. Send it to {name} privately.
      </p>
      <div className="my-4 rounded-lg border border-dashed border-green-600 bg-gray-950 p-3.5 text-center font-mono text-xl tracking-[0.12em] text-green-300 select-text">{code}</div>
      <div className="flex justify-end gap-2">
        <button className="btn" onClick={() => (window.herald.copy(code), setCopied(true))}>
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
        <button className="btn btn-primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  )
}
