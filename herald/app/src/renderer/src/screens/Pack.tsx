/**
 * Mod pack (S10): what players install with the launcher. The pack online (read from GitHub), the change waiting for
 * an approval, and the editor. Modrinth is read from this PC; a change is sent whole (the next client) and published
 * only once ANOTHER member with "approve" has approved it. Published versions never change: every change is a new
 * version (patch: updates, minor: new mods, major: new Minecraft).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { OnlinePack, PackState, PackVersion } from '@herald/api'
import { CONTENT_BASE, MOD_CATEGORIES, type ClientManifest, type ExtraFile, type Localized, type ModEntry } from '@shared/manifest'
import { bumpKind, compareVersions, hasChanges, MOD_CATEGORY_LABEL, newerReleases, nextVersion, packChanges, packFileUrl, pickLoader, SEMVER, type ModReadiness, type DraftMod, type MrHit, type PackChanges, type PackProposal, type Resolved } from '@shared/heraldPack'
import { ClientManifestSchema } from '@shared/manifest'
import { useStore } from '../store'
import { Modal } from '../components/ui'
import { formatBytes } from '../pictures'
import { formatWhen } from '../time'

const OPEN: PackProposal['status'][] = ['proposed', 'approved', 'failed']
const STATUS: Record<PackProposal['status'], [string, string]> = {
  proposed: ['Waiting for an approval', 'text-amber-300'],
  approved: ['Approved: publishing', 'text-green-300'],
  published: ['Published', 'text-green-400'],
  rejected: ['Rejected', 'text-red-300'],
  withdrawn: ['Withdrawn', 'text-gray-400'],
  replaced: ['Replaced by a newer proposal', 'text-gray-400'],
  failed: ['Publishing refused', 'text-red-300'],
}

export default function Pack() {
  const { sync, can, me, zone } = useStore()
  const [pack, setPack] = useState<PackState | null>(null)
  const [online, setOnline] = useState<OnlinePack | null | undefined>(undefined)
  const [editing, setEditing] = useState<PackProposal | 'new' | null>(null)
  /** Prepare the pack for this Minecraft (from the "new Minecraft" card) */
  const [target, setTarget] = useState<string | null>(null)
  const [mc, setMc] = useState<McInfo | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => void window.herald.pack.minecraft().then(setMc), [])
  const stamp = sync?.contentStamp
  const reload = async () => {
    const res = await window.herald.api<PackState>('GET', '/pack')
    if (res.ok) setPack(res.data)
    else setError(res.error)
  }
  useEffect(() => void reload(), [stamp]) // eslint-disable-line react-hooks/exhaustive-deps
  // The pack online: again when a change gets published
  const published = pack?.proposals.find((p) => p.status === 'published')?.id
  useEffect(() => {
    if (pack) void window.herald.pack.online(pack.contentBase).then(setOnline)
  }, [pack?.contentBase, published]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!pack) return <div className="text-gray-400">{error ?? 'Loading…'}</div>
  const open = pack.proposals.find((p) => OPEN.includes(p.status)) ?? null
  const past = pack.proposals.filter((p) => !OPEN.includes(p.status))

  if (editing && online) return <Editor online={online} contentBase={pack.contentBase} from={editing === 'new' ? null : editing} mc={mc ?? null} target={editing === 'new' ? target : null} onClose={() => (setEditing(null), setTarget(null), void reload())} />

  return (
    <div className="animate-fade max-w-5xl">
      <div className="mb-4 flex items-center gap-3">
        <div>
          <div className="eyebrow">What players install with the launcher</div>
          <h1 className="text-[26px] font-extrabold text-white">Mod pack</h1>
        </div>
        {can('pack.propose') && !open && (
          <button className="btn btn-primary ml-auto" disabled={!online} onClick={() => setEditing('new')}>
            Propose a change
          </button>
        )}
      </div>
      {error && <p className="mb-3 rounded-lg border border-red-400/30 bg-red-600/10 px-3 py-2 text-sm text-red-300">{error}</p>}
      {open && <ProposalCard p={open} online={online ?? null} mine={open.proposedBy === me.id} onEdit={() => setEditing(open)} onDone={(s) => (s ? setPack(s) : void reload())} />}
      {online && <MinecraftCard online={online} mc={mc} canPrepare={can('pack.propose') && !open} onPrepare={(v) => (setTarget(v), setEditing('new'))} />}
      <OnlineCard online={online} />
      {past.length > 0 && (
        <div className="card mt-4">
          <div className="eyebrow mb-2">Last changes</div>
          {past.map((p) => (
            <div key={p.id} className="flex items-baseline gap-3 border-t border-white/5 py-2 text-sm first:border-0">
              <b className="w-16 text-white">{p.clientVersion}</b>
              <span className={`w-48 ${STATUS[p.status][1]}`}>{STATUS[p.status][0]}</span>
              <span className="min-w-0 flex-1 truncate text-gray-300" title={p.note}>
                {p.note}
              </span>
              <span className="text-xs text-gray-500">
                {p.proposedByName ?? '?'}
                {p.decidedByName && p.status !== 'withdrawn' ? ` → ${p.decidedByName}` : ''} · {formatWhen(p.updatedAt, zone)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

type McInfo = { releases: { id: string; type: string; releaseTime: string }[]; snapshot: string | null }
const daysAgo = (iso: string) => {
  const d = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000)
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`
}

/**
 * A new Minecraft: what is ready for it (Fabric, each mod on Modrinth), and the pack prepared for it in one click.
 * Players' launchers then show "Update to <version>" (they can still play the old version on their own).
 */
function MinecraftCard({ online, mc, canPrepare, onPrepare }: { online: OnlinePack; mc: McInfo | null | undefined; canPrepare: boolean; onPrepare(version: string): void }) {
  const current = online.manifest.minecraft
  const newer = mc ? newerReleases(mc.releases, current) : []
  const [target, setTarget] = useState<string | null>(null)
  const version = target ?? newer[0]?.id ?? null
  const [fabric, setFabric] = useState<{ version: string; stable: boolean }[] | null | undefined>(undefined)
  const [mods, setMods] = useState<ModReadiness[] | null>(null)
  const [checking, setChecking] = useState(false)
  const [checkedAt, setCheckedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const check = async () => {
    if (!version) return
    setChecking(true)
    setError(null)
    const [f, r] = await Promise.all([window.herald.pack.fabric(version), window.herald.pack.readiness(version, online.manifest.mods)])
    setChecking(false)
    setFabric(f)
    if (r.ok) setMods(r.data)
    else setError(r.error)
    setCheckedAt(Date.now())
  }
  useEffect(() => {
    setMods(null)
    setFabric(undefined)
    void check()
  }, [version]) // eslint-disable-line react-hooks/exhaustive-deps

  if (mc === undefined) return null
  if (mc === null) return <div className="card mb-4 text-sm text-gray-400">Mojang cannot be reached: new Minecraft versions cannot be checked right now.</div>
  if (!version)
    return (
      <div className="card mb-4 flex items-center gap-3 py-3! text-sm">
        <span className="size-2 rounded-full bg-green-400" />
        <span className="text-gray-300">
          The pack is on <b className="text-white">Minecraft {current}</b>, the latest release.
          {mc.snapshot && <span className="text-gray-500"> Mojang is testing the next one ({mc.snapshot}): it will show here as soon as it is released.</span>}
        </span>
      </div>
    )

  const release = newer.find((n) => n.id === version)!
  const fabricReady = !!fabric && fabric.length > 0
  const loader = fabric ? pickLoader(fabric) : null
  const ready = mods?.filter((m) => m.status === 'release') ?? []
  const beta = mods?.filter((m) => m.status === 'beta') ?? []
  const missing = mods?.filter((m) => m.status === 'none') ?? []
  const names = (list: ModReadiness[]) => list.map((m) => `${m.name}${m.library ? ' (library)' : ''}`).join(', ')
  return (
    <div className="card mb-4 border-amber-400/30!">
      <div className="flex flex-wrap items-baseline gap-3">
        <div className="eyebrow text-amber-300!">New Minecraft</div>
        <span className="text-xl font-bold text-white">Minecraft {version} is out</span>
        <span className="text-sm text-gray-400">
          released {daysAgo(release.releasedAt)} · the pack is on {current}
        </span>
        {newer.length > 1 && (
          <select className="field ml-auto w-40!" value={version} onChange={(e) => setTarget(e.target.value)}>
            {newer.map((n) => (
              <option key={n.id} value={n.id}>
                Minecraft {n.id}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="mt-3 grid grid-cols-[200px_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
        <span className="text-gray-400">Fabric</span>
        <span>{fabric === undefined ? <span className="text-gray-400">Checking…</span> : fabric === null ? <span className="text-gray-400">cannot be reached</span> : fabricReady ? <span className="text-green-300">✓ ready (loader {loader})</span> : <span className="text-red-300">✗ not ready for {version} yet: nothing can be prepared before it is</span>}</span>
        <span className="text-gray-400">Mods ready</span>
        <span>
          {!mods ? (
            <span className="text-gray-400">{checking ? 'Checking each mod on Modrinth…' : (error ?? '…')}</span>
          ) : (
            <>
              <b className={missing.length ? 'text-amber-200' : 'text-green-300'}>
                {ready.length + beta.length} of {mods.length}
              </b>
              <span className="ml-3 inline-block h-1.5 w-48 overflow-hidden rounded-full bg-gray-700 align-middle">
                <span className="block h-full bg-green-500" style={{ width: `${(100 * (ready.length + beta.length)) / Math.max(1, mods.length)}%` }} />
              </span>
            </>
          )}
        </span>
        {beta.length > 0 && (
          <>
            <span className="text-gray-400">Only a beta so far</span>
            <span className="text-amber-200">{names(beta)}</span>
          </>
        )}
        {missing.length > 0 && (
          <>
            <span className="text-gray-400">Not ready yet</span>
            <span className="text-red-300">{names(missing)}</span>
          </>
        )}
      </div>
      <p className="mt-3 text-xs text-gray-400">
        Mods not ready yet: wait for their update (check again in a few days), or leave them out of the pack. Publish when the server runs {version}: players' launchers then show “Update to {version}”.
      </p>
      <div className="mt-3 flex items-center gap-2">
        <button className="btn btn-primary" disabled={!canPrepare || !fabricReady || !mods} title={!canPrepare ? 'A change is already waiting, or you cannot propose changes' : ''} onClick={() => onPrepare(version)}>
          Prepare the pack for {version}
        </button>
        <button className="btn btn-ghost" disabled={checking} onClick={() => void check()}>
          Check again
        </button>
        {checkedAt && <span className="text-xs text-gray-500">checked {new Date(checkedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>}
      </div>
    </div>
  )
}

function OnlineCard({ online }: { online: OnlinePack | null | undefined }) {
  const [all, setAll] = useState(false)
  if (online === undefined) return <div className="card text-sm text-gray-400">Reading the pack online…</div>
  if (online === null) return <div className="card text-sm text-amber-200">The pack online cannot be read (no internet?). Changes can be prepared once it can.</div>
  const m = online.manifest
  const size = m.mods.reduce((s, x) => s + x.file.size, 0)
  const mods = all ? m.mods : m.mods.filter((x) => x.category !== 'library')
  return (
    <div className="card">
      <div className="flex items-baseline gap-3">
        <div className="eyebrow">Online now</div>
        <span className="text-xs text-gray-500">{online.from === CONTENT_BASE ? 'from the launcher repository (before Herald)' : 'from the content repository'}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm text-gray-300">
        <span>
          <b className="text-xl text-white">Hemisphere Client {m.clientVersion}</b>
        </span>
        <span>Minecraft {m.minecraft}</span>
        <span>Fabric {m.loader.version}</span>
        <span>
          {m.mods.length} mods · {formatBytes(size)}
        </span>
        {online.index.previous && <span>Players on {online.index.previous.clientVersion} {online.index.previousCanJoin ? 'can still join' : 'cannot join'}</span>}
      </div>
      <table className="mt-3 w-full text-sm">
        <tbody>
          {mods.map((x) => (
            <tr key={x.id} className="border-t border-white/5">
              <td className="py-1.5 font-semibold text-white">{x.name}</td>
              <td className="text-gray-400">{x.version}</td>
              <td className="text-gray-400">{MOD_CATEGORY_LABEL[x.category]}</td>
              <td className="text-gray-400">{x.defaultEnabled ? 'On for new players' : 'Off by default'}</td>
              <td className="text-gray-500">{x.recommended ? 'Recommended' : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="mt-2 text-xs text-green-400 hover:underline" onClick={() => setAll(!all)}>
        {all ? 'Hide the libraries' : `Show the ${m.mods.length - mods.length} libraries too`}
      </button>
    </div>
  )
}

/** What a change does, in lines a reviewer can check. */
function ChangesList({ c }: { c: PackChanges }) {
  const lines: [string, string][] = [
    ...(c.minecraft ? ([['Minecraft', `${c.minecraft[0]} → ${c.minecraft[1]}`]] as [string, string][]) : []),
    ...(c.loader ? ([['Fabric', `${c.loader[0]} → ${c.loader[1]}`]] as [string, string][]) : []),
    ...c.added.map((m) => ['Added', `${m.name} ${m.version}${m.category === 'library' ? ' (library)' : ''}`] as [string, string]),
    ...c.removed.map((m) => ['Removed', `${m.name}`] as [string, string]),
    ...c.updated.map((u) => ['Updated', `${u.mod.name} ${u.from} → ${u.mod.version}`] as [string, string]),
    ...c.settings.map((s) => ['Changed', `${s.mod.name}: ${s.what.join(', ')}`] as [string, string]),
    ...c.files.added.map((f) => ['File added', f] as [string, string]),
    ...c.files.changed.map((f) => ['File changed', f] as [string, string]),
    ...c.files.removed.map((f) => ['File removed', f] as [string, string]),
  ]
  if (!lines.length) return <p className="text-sm text-gray-400">No change compared with the pack online.</p>
  const color: Record<string, string> = { Added: 'text-green-300', Removed: 'text-red-300', 'File removed': 'text-red-300', 'File added': 'text-green-300' }
  return (
    <div className="text-sm">
      {lines.map(([what, text], i) => (
        <div key={i} className="flex gap-3 py-0.5">
          <span className={`w-24 shrink-0 font-semibold ${color[what] ?? 'text-amber-200'}`}>{what}</span>
          <span className="text-gray-200">{text}</span>
        </div>
      ))}
      <div className="mt-1 text-xs text-gray-500">
        Download size: {formatBytes(c.size[0])} → {formatBytes(c.size[1])}
      </div>
    </div>
  )
}

function ProposalCard({ p, online, mine, onEdit, onDone }: { p: PackProposal; online: OnlinePack | null; mine: boolean; onEdit(): void; onDone(s: PackState | null): void }) {
  const { can, zone } = useStore()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState(false)
  const [why, setWhy] = useState('')
  const changes = useMemo(() => packChanges(online?.manifest ?? null, p.manifest), [online, p.manifest])
  const stale = online && online.index.latest.sha512 !== p.basedOn.sha512 && p.status !== 'approved'
  const act = async (action: 'approve' | 'reject' | 'withdraw', body?: unknown) => {
    setBusy(true)
    setError(null)
    const res = await window.herald.api<PackState>('POST', `/pack/proposals/${p.id}/${action}`, body)
    setBusy(false)
    if (!res.ok) return setError(res.error)
    setRejecting(false)
    onDone(res.data)
  }
  const waiting = p.status === 'proposed' || p.status === 'failed'
  return (
    <div className="card mb-4 border-amber-400/25!">
      <div className="flex items-baseline gap-3">
        <div className="eyebrow">Change waiting</div>
        <span className={`text-sm font-semibold ${STATUS[p.status][1]}`}>{STATUS[p.status][0]}</span>
      </div>
      <div className="mt-1 text-xl font-bold text-white">
        Hemisphere Client {p.basedOn.clientVersion} → {p.clientVersion}
      </div>
      <p className="mt-1 text-sm text-gray-300">
        “{p.note}” — {p.proposedByName ?? '?'}, {formatWhen(p.proposedAt, zone)}
        {p.decidedByName && p.status === 'approved' && <> · approved by {p.decidedByName}</>}
      </p>
      {p.status === 'failed' && p.decisionNote && <p className="mt-2 rounded-lg border border-red-400/30 bg-red-600/10 px-3 py-2 text-sm text-red-300">{p.decisionNote}</p>}
      {stale && <p className="mt-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-200">The pack online changed since this proposal was made: it would be refused. Withdraw it and make the change again.</p>}
      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-5">
        <div>
          <div className="label">Changes</div>
          <ChangesList c={changes} />
        </div>
        <div>
          <div className="label">“What's new” shown to players</div>
          {p.manifest.changelog?.length ? (
            <ul className="list-disc pl-5 text-sm text-gray-200">
              {p.manifest.changelog.map((l, i) => (
                <li key={i}>
                  {l.en}
                  {l.fr && <span className="text-gray-500"> · {l.fr}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-500">None.</p>
          )}
          {changes.minecraft && <p className="mt-2 text-sm text-gray-300">Players still on {p.basedOn.clientVersion} {p.previousCanJoin ? 'can still join the server' : 'cannot join the server any more'}.</p>}
        </div>
      </div>
      {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {waiting && can('pack.approve') && !mine && (
          <button className="btn btn-primary" disabled={busy || !!stale} onClick={() => void act('approve')}>
            {p.status === 'failed' ? 'Try publishing again' : 'Approve and publish'}
          </button>
        )}
        {waiting && can('pack.approve') && !mine && (
          <button className="btn btn-ghost" disabled={busy} onClick={() => setRejecting(true)}>
            Reject
          </button>
        )}
        {waiting && mine && <span className="text-sm text-gray-400">Another member who can approve the pack must approve it.</span>}
        {waiting && mine && (
          <button className="btn btn-ghost ml-auto" disabled={busy || !online} onClick={onEdit}>
            Change it
          </button>
        )}
        {waiting && (mine || can('pack.approve')) && (
          <button className={`btn btn-ghost ${mine ? '' : 'ml-auto'}`} disabled={busy} onClick={() => void act('withdraw')}>
            Withdraw
          </button>
        )}
      </div>
      {rejecting && (
        <Modal title="Reject this change?" onClose={() => setRejecting(false)}>
          <label className="label">Why (shown to who proposed it)</label>
          <textarea className="field mb-4 h-24" maxLength={300} value={why} onChange={(e) => setWhy(e.target.value)} autoFocus />
          <div className="flex justify-end gap-2">
            <button className="btn btn-ghost" onClick={() => setRejecting(false)}>
              Cancel
            </button>
            <button className="btn btn-danger" disabled={!why.trim() || busy} onClick={() => void act('reject', { note: why })}>
              Reject
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ the editor

interface Draft {
  clientVersion: string
  minecraft: string
  fabricLoader: string
  previousCanJoin: boolean
  changelog: Localized[]
  mods: DraftMod[]
  files: Omit<ExtraFile, 'url'>[]
  note: string
}

const toDraftMod = (m: ModEntry): DraftMod => ({ projectId: m.source!.modrinth.projectId, versionId: m.source!.modrinth.versionId, category: m.category, recommended: m.recommended, defaultEnabled: m.defaultEnabled, description: m.description })

function Editor({ online, contentBase, from, mc, target, onClose }: { online: OnlinePack; contentBase: string; from: PackProposal | null; mc: McInfo | null; target: string | null; onClose(): void }) {
  const start = from?.manifest ?? online.manifest
  const [draft, setDraft] = useState<Draft>(() => ({
    clientVersion: from?.clientVersion ?? '',
    minecraft: start.minecraft,
    fabricLoader: start.loader.version,
    previousCanJoin: from?.previousCanJoin ?? online.index.previousCanJoin,
    changelog: from?.manifest.changelog ?? [],
    mods: start.mods.filter((m) => m.source).map(toDraftMod),
    files: start.files.map(({ url: _u, ...f }) => f),
    note: from?.note ?? '',
  }))
  const [versionTouched, setVersionTouched] = useState(Boolean(from))
  const [resolved, setResolved] = useState<Resolved | null>(null)
  const [resolving, setResolving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [updates, setUpdates] = useState<Record<string, { versionId: string; version: string } | null> | null>(null)
  /** Mods with no build yet for the Minecraft chosen (project ids) */
  const [notReady, setNotReady] = useState<{ projectId: string; name: string }[]>([])
  const [loaders, setLoaders] = useState<{ version: string; stable: boolean }[] | null | undefined>(undefined)
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }))
  const setMod = (projectId: string, patch: Partial<DraftMod>) => set({ mods: draft.mods.map((m) => (m.projectId === projectId ? { ...m, ...patch } : m)) })

  // Fabric's loaders for the Minecraft chosen
  useEffect(() => {
    setLoaders(undefined)
    void window.herald.pack.fabric(draft.minecraft).then(setLoaders)
  }, [draft.minecraft])

  /** Another Minecraft: every mod moved to its newest build for it, Fabric's newest stable loader, what is not ready listed */
  const moveTo = async (version: string) => {
    setBusy(`Moving every mod to Minecraft ${version}…`)
    setUpdates(null)
    const mods = resolved?.mods ?? start.mods
    const [r, f] = await Promise.all([window.herald.pack.readiness(version, mods), window.herald.pack.fabric(version)])
    setBusy(null)
    if (!r.ok) return setError(r.error)
    const found = new Map(r.data.filter((m) => m.versionId).map((m) => [m.projectId, m.versionId!]))
    const loader = f ? pickLoader(f) : null
    setNotReady(r.data.filter((m) => !m.versionId).map((m) => ({ projectId: m.projectId, name: m.name })))
    set({
      minecraft: version,
      ...(loader ? { fabricLoader: loader } : {}),
      mods: draft.mods.map((m) => (found.has(m.projectId) ? { ...m, versionId: found.get(m.projectId)! } : m)),
      ...(version !== online.manifest.minecraft ? { previousCanJoin: false } : { previousCanJoin: online.index.previousCanJoin }),
      ...(draft.changelog.length || version === online.manifest.minecraft ? {} : { changelog: [{ en: `Hemisphere now plays on Minecraft ${version}`, fr: `Hemisphere passe à Minecraft ${version}` }] }),
    })
  }
  useEffect(() => {
    if (target) void moveTo(target)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Read the choices again on Modrinth (files, libraries, conflicts) whenever they change
  const key = JSON.stringify([draft.minecraft, draft.mods])
  const asked = useRef('')
  useEffect(() => {
    if (!/^[0-9][0-9a-z.\-]{0,31}$/.test(draft.minecraft)) return
    const t = window.setTimeout(async () => {
      asked.current = key
      setResolving(true)
      const res = await window.herald.pack.resolve(draft.minecraft, draft.mods)
      if (asked.current !== key) return
      setResolving(false)
      if (!res.ok) return setError(res.error)
      setError(null)
      setResolved(res.data)
      // Libraries the mods need become part of the pack
      if (res.data.added.length) set({ mods: [...draft.mods, ...res.data.mods.filter((m) => res.data.added.includes(m.id)).map(toDraftMod)] })
    }, 500)
    return () => window.clearTimeout(t)
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  const manifest: ClientManifest | null = resolved
    ? {
        schema: 1,
        clientVersion: draft.clientVersion,
        createdAt: new Date().toISOString(),
        minecraft: draft.minecraft,
        loader: { type: 'fabric', version: draft.fabricLoader },
        mods: resolved.mods,
        files: draft.files.map((f) => ({ ...f, url: packFileUrl(contentBase, draft.clientVersion, f.path) })),
        ...(draft.changelog.length ? { changelog: draft.changelog.map((l) => Object.fromEntries(Object.entries(l).filter(([, v]) => v.trim()))) as Localized[] } : {}),
      }
    : null
  const changes = useMemo(() => (manifest ? packChanges(online.manifest, manifest) : null), [online, resolved, draft.files, draft.minecraft, draft.fabricLoader]) // eslint-disable-line react-hooks/exhaustive-deps
  const suggested = changes ? nextVersion(online.manifest.clientVersion, bumpKind(changes)) : ''
  useEffect(() => {
    if (!versionTouched && suggested) set({ clientVersion: suggested })
  }, [suggested, versionTouched]) // eslint-disable-line react-hooks/exhaustive-deps

  const problems = [
    ...(resolved?.problems ?? []),
    ...(!SEMVER.test(draft.clientVersion) ? ['The version must look like 1.2.3'] : compareVersions(draft.clientVersion, online.manifest.clientVersion) <= 0 ? [`The version must be higher than ${online.manifest.clientVersion}`] : []),
    ...(changes && !hasChanges(changes) ? ['Nothing changes compared with the pack online'] : []),
    ...(!draft.note.trim() ? ['Say why (shown to whoever approves)'] : []),
    ...draft.changelog.flatMap((l, i) => (!l.en.trim() ? [`“What's new” line ${i + 1}: the English text is missing`] : [])),
    ...(loaders && loaders.length === 0 ? [`Fabric does not support Minecraft ${draft.minecraft} yet`] : loaders && !loaders.some((l) => l.version === draft.fabricLoader) ? [`Fabric Loader ${draft.fabricLoader} does not exist for Minecraft ${draft.minecraft}`] : []),
  ]
  const check = manifest ? ClientManifestSchema.safeParse(manifest) : null
  if (check && !check.success) problems.push(...check.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`))

  const send = async () => {
    if (!manifest) return
    setBusy('Sending…')
    const res = await window.herald.api<PackState>('POST', '/pack/proposals', {
      manifest,
      basedOn: { sequence: online.index.sequence, clientVersion: online.index.latest.clientVersion, sha512: online.index.latest.sha512 },
      previousCanJoin: draft.previousCanJoin,
      note: draft.note,
      ...(from ? { replaces: from.id } : {}),
    })
    setBusy(null)
    if (!res.ok) return setError(res.error)
    onClose()
  }
  const checkUpdates = async () => {
    setBusy('Looking for updates on Modrinth…')
    const res = await window.herald.pack.newest(draft.minecraft, (resolved?.mods ?? []).map((m) => ({ projectId: m.source!.modrinth.projectId, beta: !/^\d+(\.\d+)*$/.test(m.version) && /beta|alpha|rc|pre/i.test(m.version) })))
    setBusy(null)
    if (!res.ok) return setError(res.error)
    setUpdates(res.data)
  }
  const available = updates ? draft.mods.filter((m) => updates[m.projectId] && updates[m.projectId]!.versionId !== m.versionId) : []
  const nameOf = (projectId: string) => resolved?.mods.find((m) => m.source?.modrinth.projectId === projectId)?.name ?? projectId

  return (
    <div className="animate-fade max-w-5xl">
      <div className="mb-4 flex items-center gap-3">
        <div>
          <div className="eyebrow">{from ? 'Changing your proposal' : 'New change of the mod pack'}</div>
          <h1 className="text-[26px] font-extrabold text-white">
            Hemisphere Client {online.manifest.clientVersion} → {draft.clientVersion || '?'}
          </h1>
        </div>
        <div className="ml-auto flex gap-2">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!!busy || resolving || problems.length > 0} title={problems.join('\n')} onClick={() => void send()}>
            Send for approval
          </button>
        </div>
      </div>
      {error && <p className="mb-3 rounded-lg border border-red-400/30 bg-red-600/10 px-3 py-2 text-sm text-red-300">{error}</p>}
      {busy && <p className="mb-3 text-sm text-gray-300">{busy}</p>}

      <div className="grid grid-cols-[minmax(0,1fr)_320px] gap-5">
        <div className="flex flex-col gap-4">
          <div className="card">
            <div className="mb-2 flex items-center gap-3">
              <div className="eyebrow">Mods</div>
              {resolving && <span className="text-xs text-gray-400">Checking on Modrinth…</span>}
              <button className="btn btn-sm ml-auto" disabled={!resolved || !!busy} onClick={() => void checkUpdates()}>
                Check for updates
              </button>
            </div>
            {notReady.some((n) => draft.mods.some((m) => m.projectId === n.projectId)) && (
              <div className="mb-3 rounded-lg border border-red-400/25 bg-red-600/5 px-3 py-2 text-sm">
                <div className="text-red-200">
                  Not ready for Minecraft {draft.minecraft} yet: <b>{notReady.filter((n) => draft.mods.some((m) => m.projectId === n.projectId)).map((n) => n.name).join(', ')}</b>
                </div>
                <div className="mt-1 text-xs text-gray-400">Wait for their update (cancel, and check again from the Mod pack tab in a few days), or leave them out of this version.</div>
                <button className="btn btn-sm mt-2" onClick={() => set({ mods: draft.mods.filter((m) => !notReady.some((n) => n.projectId === m.projectId)) })}>
                  Leave them out of the pack
                </button>
              </div>
            )}
            {updates && (
              <div className="mb-3 rounded-lg bg-gray-900/60 px-3 py-2 text-sm">
                {available.length === 0 ? (
                  <span className="text-gray-300">Every mod is up to date for Minecraft {draft.minecraft}.</span>
                ) : (
                  <>
                    <div className="mb-1 flex items-center">
                      <span className="text-gray-200">{available.length} update{available.length === 1 ? '' : 's'} available</span>
                      <button className="btn btn-sm btn-primary ml-auto" onClick={() => (set({ mods: draft.mods.map((m) => (updates[m.projectId] ? { ...m, versionId: updates[m.projectId]!.versionId } : m)) }), setUpdates(null))}>
                        Update all
                      </button>
                    </div>
                    {available.map((m) => (
                      <div key={m.projectId} className="flex items-center gap-2 py-0.5 text-gray-300">
                        {nameOf(m.projectId)} → {updates[m.projectId]!.version}
                        <button className="ml-auto text-xs text-green-400 hover:underline" onClick={() => setMod(m.projectId, { versionId: updates[m.projectId]!.versionId })}>
                          Update
                        </button>
                      </div>
                    ))}
                  </>
                )}
                {Object.entries(updates).some(([, v]) => v === null) && (
                  <div className="mt-1 text-amber-200">
                    No version for Minecraft {draft.minecraft}: {Object.entries(updates).filter(([, v]) => v === null).map(([id]) => nameOf(id)).join(', ')}
                  </div>
                )}
              </div>
            )}
            {(resolved?.mods ?? []).map((m) => {
              const d = draft.mods.find((x) => x.projectId === m.source?.modrinth.projectId)
              if (!d) return null
              const before = online.manifest.mods.find((x) => x.id === m.id)
              return <ModRow key={m.id} mod={m} draft={d} minecraft={draft.minecraft} before={before ?? null} unused={resolved!.unused.includes(m.id)} onChange={(patch) => setMod(d.projectId, patch)} onRemove={() => set({ mods: draft.mods.filter((x) => x.projectId !== d.projectId) })} />
            })}
            {!resolved && <p className="text-sm text-gray-400">Reading the mods on Modrinth…</p>}
            <AddMod minecraft={draft.minecraft} have={draft.mods.map((m) => m.projectId)} onAdd={(m) => set({ mods: [...draft.mods, m] })} />
          </div>

          <div className="card">
            <div className="eyebrow mb-2">Config files</div>
            {draft.files.length === 0 && <p className="text-sm text-gray-400">None. Players' own settings are never touched unless a file is added here.</p>}
            {draft.files.map((f, i) => (
              <div key={i} className="mb-2 flex items-center gap-2">
                <input className="field flex-1" value={f.path} onChange={(e) => set({ files: draft.files.map((x, j) => (j === i ? { ...x, path: e.target.value.trim() } : x)) })} />
                <select className="field w-56!" value={f.policy} onChange={(e) => set({ files: draft.files.map((x, j) => (j === i ? { ...x, policy: e.target.value as ExtraFile['policy'] } : x)) })}>
                  <option value="default">Given once (players can change it)</option>
                  <option value="enforced">Always reset to this one</option>
                </select>
                <span className="w-16 text-right text-xs text-gray-400">{formatBytes(f.size)}</span>
                <button className="btn btn-sm btn-ghost" onClick={() => set({ files: draft.files.filter((_, j) => j !== i) })}>
                  Remove
                </button>
              </div>
            ))}
            <button
              className="btn btn-sm mt-1"
              disabled={!!busy}
              onClick={async () => {
                setBusy('Sending the file…')
                const res = await window.herald.pack.addFile()
                setBusy(null)
                if (!res) return
                if (!res.ok) return setError(res.error)
                set({ files: [...draft.files, { path: `config/${res.data.name}`, sha512: res.data.sha512, size: res.data.size, policy: 'default' }] })
              }}
            >
              + Add a config file
            </button>
            <p className="mt-2 text-xs text-gray-500">Paths start with config/, resourcepacks/ or shaderpacks/. Up to 1 MB per file.</p>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          {problems.length > 0 && (
            <div className="rounded-lg border border-amber-400/25 bg-amber-400/5 px-3 py-2 text-sm text-amber-200">
              {problems.map((p, i) => (
                <div key={i}>{p}</div>
              ))}
            </div>
          )}
          {resolved && resolved.warnings.length > 0 && (
            <div className="rounded-lg bg-gray-800 px-3 py-2 text-xs text-gray-300">
              {resolved.warnings.map((w, i) => (
                <div key={i}>⚠ {w}</div>
              ))}
            </div>
          )}
          <div className="card flex flex-col gap-3">
            <div>
              <label className="label">Version{suggested && <span className="font-normal text-gray-500"> (suggested: {suggested})</span>}</label>
              <input className="field" value={draft.clientVersion} onChange={(e) => (setVersionTouched(true), set({ clientVersion: e.target.value.trim() }))} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label">Minecraft</label>
                {mc ? (
                  <select className="field" value={draft.minecraft} disabled={!!busy} onChange={(e) => void moveTo(e.target.value)}>
                    {[...newerReleases(mc.releases, online.manifest.minecraft).map((r) => r.id), online.manifest.minecraft].map((v) => (
                      <option key={v} value={v}>
                        {v}
                        {v === online.manifest.minecraft ? ' (now)' : ''}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input className="field" value={draft.minecraft} onChange={(e) => set({ minecraft: e.target.value.trim() })} />
                )}
              </div>
              <div>
                <label className="label">Fabric Loader</label>
                {loaders && loaders.length > 0 ? (
                  <select className="field" value={draft.fabricLoader} onChange={(e) => set({ fabricLoader: e.target.value })}>
                    {!loaders.some((l) => l.version === draft.fabricLoader) && <option value={draft.fabricLoader}>{draft.fabricLoader} (not for {draft.minecraft})</option>}
                    {loaders.slice(0, 15).map((l) => (
                      <option key={l.version} value={l.version}>
                        {l.version}
                        {l.version === pickLoader(loaders) ? ' (recommended)' : ''}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input className="field" value={draft.fabricLoader} onChange={(e) => set({ fabricLoader: e.target.value.trim() })} />
                )}
              </div>
            </div>
            {draft.minecraft !== online.manifest.minecraft && (
              <>
                <p className="text-xs text-amber-200">
                  Every mod was moved to its newest build for Minecraft {draft.minecraft}. Publish when the server runs {draft.minecraft}: players' launchers then show “Update to {draft.minecraft}”.
                </p>
                <label className="flex items-start gap-2 text-sm text-gray-300">
                  <input type="checkbox" className="mt-1" checked={draft.previousCanJoin} onChange={(e) => set({ previousCanJoin: e.target.checked })} />
                  <span>
                    Players still on Minecraft {online.manifest.minecraft} can still join the server
                    <span className="block text-xs text-gray-500">Only if the server still accepts them (e.g. ViaVersion). Otherwise their launcher says the old version is for playing alone.</span>
                  </span>
                </label>
              </>
            )}
          </div>
          <div className="card">
            <div className="label">“What's new” shown to players (optional)</div>
            {draft.changelog.map((l, i) => (
              <div key={i} className="mb-2 flex flex-col gap-1 border-b border-white/5 pb-2">
                <input className="field" placeholder="English" maxLength={160} value={l.en} onChange={(e) => set({ changelog: draft.changelog.map((x, j) => (j === i ? { ...x, en: e.target.value } : x)) })} />
                <div className="flex gap-1">
                  <input className="field" placeholder="Français" maxLength={160} value={l.fr ?? ''} onChange={(e) => set({ changelog: draft.changelog.map((x, j) => (j === i ? { ...x, fr: e.target.value } : x)) })} />
                  <button className="btn btn-sm btn-ghost" onClick={() => set({ changelog: draft.changelog.filter((_, j) => j !== i) })}>
                    ✕
                  </button>
                </div>
              </div>
            ))}
            <button className="btn btn-sm" disabled={draft.changelog.length >= 30} onClick={() => set({ changelog: [...draft.changelog, { en: '', fr: '' }] })}>
              + Add a line
            </button>
          </div>
          <div className="card">
            <label className="label">Why (shown to whoever approves)</label>
            <textarea className="field h-20" maxLength={500} value={draft.note} onChange={(e) => set({ note: e.target.value })} placeholder="Sodium update for the new FPS fixes" />
          </div>
          {changes && (
            <div className="card">
              <div className="eyebrow mb-2">What changes</div>
              <ChangesList c={changes} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ModRow({ mod, draft, minecraft, before, unused, onChange, onRemove }: { mod: ModEntry; draft: DraftMod; minecraft: string; before: ModEntry | null; unused: boolean; onChange(p: Partial<DraftMod>): void; onRemove(): void }) {
  const [open, setOpen] = useState(false)
  const [versions, setVersions] = useState<PackVersion[] | null>(null)
  useEffect(() => {
    if (open && !versions) void window.herald.pack.versions(draft.projectId, minecraft).then((r) => setVersions(r.ok ? r.data : []))
  }, [open, versions, draft.projectId, minecraft])
  const badge = !before ? ['new', 'text-green-300'] : before.file.sha512 !== mod.file.sha512 ? [`was ${before.version}`, 'text-amber-200'] : null
  return (
    <div className="border-t border-white/5 py-2 first:border-0">
      <div className="flex items-center gap-2 text-sm">
        <button className="min-w-0 flex-1 truncate text-left" onClick={() => setOpen(!open)}>
          <b className="text-white">{mod.name}</b> <span className="text-gray-400">{mod.version}</span>
          {badge && <span className={`ml-2 text-xs ${badge[1]}`}>{badge[0]}</span>}
          {unused && <span className="ml-2 text-xs text-amber-300">not needed any more</span>}
          {mod.requires.length > 0 && <span className="ml-2 text-xs text-gray-500">needs {mod.requires.join(', ')}</span>}
        </button>
        <span className="text-xs text-gray-400">{MOD_CATEGORY_LABEL[draft.category]}</span>
        <span className="w-28 text-right text-xs text-gray-400">{draft.defaultEnabled ? 'On for new players' : 'Off by default'}</span>
        <button className="btn btn-sm btn-ghost" onClick={onRemove}>
          Remove
        </button>
      </div>
      {open && (
        <div className="mt-2 grid grid-cols-2 gap-2 rounded-lg bg-gray-900/50 p-3">
          <div>
            <label className="label">Version (for Minecraft {minecraft})</label>
            <select className="field" value={draft.versionId} onChange={(e) => onChange({ versionId: e.target.value })}>
              {!versions?.some((v) => v.id === draft.versionId) && <option value={draft.versionId}>{mod.version}</option>}
              {(versions ?? []).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.number}
                  {v.type !== 'release' ? ` (${v.type})` : ''}
                  {v.date ? ` · ${v.date.slice(0, 10)}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Category</label>
            <select className="field" value={draft.category} onChange={(e) => onChange({ category: e.target.value as DraftMod['category'] })}>
              {MOD_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {MOD_CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input type="checkbox" checked={draft.defaultEnabled} onChange={(e) => onChange({ defaultEnabled: e.target.checked })} />
            On for new players
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input type="checkbox" checked={draft.recommended} onChange={(e) => onChange({ recommended: e.target.checked })} />
            Recommended (a warning when turned off)
          </label>
          <div className="col-span-2 grid grid-cols-2 gap-2">
            <input className="field" placeholder="Description (English)" maxLength={140} value={draft.description.en} onChange={(e) => onChange({ description: { ...draft.description, en: e.target.value } })} />
            <input className="field" placeholder="Description (français)" maxLength={140} value={draft.description.fr ?? ''} onChange={(e) => onChange({ description: { ...draft.description, fr: e.target.value } })} />
          </div>
        </div>
      )}
    </div>
  )
}

function AddMod({ minecraft, have, onAdd }: { minecraft: string; have: string[]; onAdd(m: DraftMod): void }) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<MrHit[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const search = async () => {
    if (!query.trim()) return
    setBusy('search')
    const res = await window.herald.pack.search(query.trim(), minecraft)
    setBusy(null)
    if (!res.ok) return setError(res.error)
    setError(null)
    setHits(res.data)
  }
  const add = async (h: MrHit) => {
    setBusy(h.project_id)
    const res = await window.herald.pack.newest(minecraft, [{ projectId: h.project_id }])
    setBusy(null)
    if (!res.ok) return setError(res.error)
    const v = res.data[h.project_id]
    if (!v) return setError(`${h.title} has no release for Minecraft ${minecraft}.`)
    onAdd({ projectId: h.project_id, versionId: v.versionId, category: 'comfort', recommended: false, defaultEnabled: false, description: { en: h.description.slice(0, 140) || h.title } })
    setHits(null)
    setQuery('')
  }
  return (
    <div className="mt-3 border-t border-white/5 pt-3">
      <form className="flex gap-2" onSubmit={(e) => (e.preventDefault(), void search())}>
        <input className="field" placeholder={`Add a mod: search Modrinth (Fabric, Minecraft ${minecraft})`} value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className="btn shrink-0" disabled={!query.trim() || busy === 'search'}>
          Search
        </button>
      </form>
      {error && <p className="mt-1 text-sm text-red-300">{error}</p>}
      {hits && hits.length === 0 && <p className="mt-2 text-sm text-gray-400">Nothing found for Minecraft {minecraft}.</p>}
      {hits?.map((h) => (
        <div key={h.project_id} className="flex items-center gap-3 border-b border-white/5 py-2 text-sm">
          {h.icon_url ? <img src={h.icon_url} className="h-8 w-8 rounded" alt="" /> : <div className="h-8 w-8 rounded bg-gray-700" />}
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-white">
              {h.title} <span className="text-xs font-normal text-gray-500">{h.downloads.toLocaleString('en')} downloads</span>
            </div>
            <div className="truncate text-xs text-gray-400">{h.description}</div>
          </div>
          {have.includes(h.project_id) ? (
            <span className="text-xs text-gray-500">in the pack</span>
          ) : (
            <button className="btn btn-sm btn-primary" disabled={busy === h.project_id} onClick={() => void add(h)}>
              Add
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
