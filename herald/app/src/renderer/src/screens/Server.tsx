/**
 * Server tab: maintenance (now, in an emergency, or planned), the daily restart (its time from a date on, days
 * without restart, extra restarts), and taking a publication down fast. Every change is published at once.
 */
import { useEffect, useMemo, useState } from 'react'
import type { Maintenance, RestartException, RestartRule } from '@shared/feedV2'
import type { RestartObservation } from '@shared/restartObservations'
import { nextRestart } from '@shared/restart'
import type { MessageTemplate } from '@shared/heraldPublications'
import { usePubs } from '../pubs'
import { useStore } from '../store'
import { Modal, ZonePicker } from '../components/ui'
import { ago, formatDay, formatTime, formatWhen, fromWallInput, toWallInput, zoneLabel } from '../time'

type Result = { baseVersion: number; job: string }
const DAY = 86_400_000

export default function Server() {
  const { state, act } = usePubs()
  const { can, zone } = useStore()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [modal, setModal] = useState<null | { kind: 'now' } | { kind: 'back' } | { kind: 'plan'; edit?: Maintenance } | { kind: 'rule' } | { kind: 'exception' }>(null)
  // Re-drawn every 30 s; each drawing uses the current time (right after "back online" too)
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 30_000)
    return () => window.clearInterval(t)
  }, [])
  if (!state) return <div className="text-gray-400">Loading…</div>

  const base = state.base
  const now = Date.now()
  const send = async (path: string, body: Record<string, unknown> = {}) => {
    setBusy(true)
    setError(null)
    const res = await act<Result>('POST', path, { version: state.baseVersion, ...body })
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return false
    }
    setModal(null)
    return true
  }
  const running = base.maintenances.find((m) => Date.parse(m.start) <= now && (!m.end || Date.parse(m.end) > now))
  const planned = base.maintenances.filter((m) => Date.parse(m.start) > now).sort((a, b) => Date.parse(a.start) - Date.parse(b.start))

  return (
    <div className="animate-fade">
      <div className="mb-4">
        <div className="eyebrow">What launchers say about the server</div>
        <h1 className="text-[26px] font-extrabold text-white">Server</h1>
      </div>
      {error && <p className="mb-3 rounded-lg border border-red-400/30 bg-red-600/10 px-3 py-2 text-sm text-red-300">{error}</p>}

      <div className={`card mb-4 flex flex-wrap items-center gap-4 ${running ? 'border-amber-400/40 bg-amber-900/25' : ''}`}>
        <span className={`inline-flex items-center gap-2 rounded-full bg-gray-900/75 px-3 py-1.5 text-xs font-bold tracking-wider uppercase ${running ? 'text-amber-400' : 'text-green-400'}`}>
          <i className="size-2 rounded-full bg-current" /> {running ? 'Maintenance' : 'Open'}
        </span>
        <div className="min-w-0 flex-1 text-sm">
          {running ? (
            <>
              <b className="text-white">{running.message.en}</b>
              <div className="text-xs text-amber-200/80">
                Since {formatWhen(Date.parse(running.start), zone)} · {running.end ? `expected end ${formatWhen(Date.parse(running.end), zone)}` : 'until someone says the server is back'}
              </div>
            </>
          ) : (
            <span className="text-gray-300">Launchers show the server normally (its real status comes from the server itself).</span>
          )}
        </div>
        {can('maintenance.emergency') &&
          (running ? (
            <button className="btn btn-primary" disabled={busy} onClick={() => setModal({ kind: 'back' })}>
              ✓ The server is back online
            </button>
          ) : (
            <button className="btn bg-amber-600 hover:bg-amber-600/85" disabled={busy} onClick={() => setModal({ kind: 'now' })}>
              Start a maintenance now
            </button>
          ))}
      </div>

      <div className="grid grid-cols-[1fr_1fr] gap-4">
        <div className="card">
          <div className="mb-2 flex items-center">
            <span className="eyebrow">Planned maintenances</span>
            {can('maintenance.write') && (
              <button className="btn btn-sm ml-auto" onClick={() => setModal({ kind: 'plan' })}>
                + Plan one
              </button>
            )}
          </div>
          {planned.length === 0 && <p className="text-sm text-gray-400">None planned.</p>}
          {planned.map((m) => (
            <div key={m.id} className="border-t border-gray-700/60 py-2 text-sm first:border-0">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <b className="text-white">{m.message.en}</b>
                  <div className="text-xs text-gray-400">
                    {formatWhen(Date.parse(m.start), zone)}
                    {m.end ? ` → ${formatWhen(Date.parse(m.end), zone)}` : ' → until ended by hand'}
                    {m.announceFrom ? ` · announced from ${formatWhen(Date.parse(m.announceFrom), zone)}` : ' · not announced before'}
                  </div>
                </div>
                {can('maintenance.write') && (
                  <>
                    <button className="btn btn-sm btn-ghost" onClick={() => setModal({ kind: 'plan', edit: m })}>
                      Edit
                    </button>
                    <button className="btn btn-sm btn-ghost text-red-300" disabled={busy} onClick={() => void send(`/server/maintenances/${m.id}/delete`)}>
                      Remove
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>

        <RestartCard rules={base.restart?.rules ?? []} exceptions={base.restart?.exceptions ?? []} busy={busy} onSave={(rules, exceptions) => void send('/server/restart', { restart: { rules, exceptions } })} onAdd={(k) => setModal({ kind: k })} now={now} />
      </div>

      <History />

      {modal?.kind === 'now' && <MaintenanceForm title="Start a maintenance now" now onClose={() => setModal(null)} busy={busy} onSave={(m) => void send('/server/maintenance-now', { message: m.message, ...(m.end ? { end: m.end } : {}) })} />}
      {modal?.kind === 'plan' && <MaintenanceForm title={modal.edit ? 'Change the maintenance' : 'Plan a maintenance'} edit={modal.edit} onClose={() => setModal(null)} busy={busy} onSave={(m) => void send('/server/maintenances', { maintenance: m })} />}
      {modal?.kind === 'back' && (
        <Modal title="The server is back online?" onClose={() => setModal(null)}>
          <p className="mb-4 text-sm text-gray-300">The maintenance ends now: launchers show the server open again within 2 minutes.</p>
          <div className="flex justify-end gap-2">
            <button className="btn btn-ghost" onClick={() => setModal(null)}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={busy} onClick={() => void send('/server/back-online')}>
              Yes, it is back
            </button>
          </div>
        </Modal>
      )}
      {modal?.kind === 'rule' && (
        <RuleForm
          current={(base.restart?.rules ?? []).filter((r) => Date.parse(r.from) <= now).sort((a, b) => Date.parse(b.from) - Date.parse(a.from))[0] ?? null}
          onClose={() => setModal(null)}
          busy={busy}
          onSave={(rule) => void send('/server/restart', { restart: { rules: [...(base.restart?.rules ?? []).filter((r) => r.from !== rule.from), rule], exceptions: base.restart?.exceptions ?? [] } })}
        />
      )}
      {modal?.kind === 'exception' && (
        <ExceptionForm onClose={() => setModal(null)} busy={busy} onSave={(e) => void send('/server/restart', { restart: { rules: base.restart?.rules ?? [], exceptions: [...(base.restart?.exceptions ?? []), e] } })} />
      )}
    </div>
  )
}

function RestartCard({ rules, exceptions, busy, onSave, onAdd, now }: { rules: RestartRule[]; exceptions: RestartException[]; busy: boolean; onSave(r: RestartRule[], e: RestartException[]): void; onAdd(k: 'rule' | 'exception'): void; now: number }) {
  const { can, zone, settings } = useStore()
  const inForce = rules.filter((r) => Date.parse(r.from) <= now).sort((a, b) => Date.parse(b.from) - Date.parse(a.from))[0]
  const later = rules.filter((r) => Date.parse(r.from) > now).sort((a, b) => Date.parse(a.from) - Date.parse(b.from))
  // The coming restarts as launchers will compute them (rule in force at each one, exceptions included)
  const coming = useMemo(() => {
    const out: { at: number; kind?: string }[] = []
    let t = now
    for (let i = 0; i < 6; i++) {
      const rule = rules.filter((r) => Date.parse(r.from) <= t).sort((a, b) => Date.parse(b.from) - Date.parse(a.from))[0]
      if (!rule) break
      const n = nextRestart(t, { ...rule, exceptions })
      if (n.msLeft <= 0) break
      out.push({ at: n.next, kind: n.kind })
      t = n.next + 1000
    }
    return out
  }, [rules, exceptions, now])
  const edit = can('restart.write')
  return (
    <div className="card">
      <div className="mb-2 flex items-center">
        <span className="eyebrow">Daily restart</span>
      </div>
      {inForce ? (
        <p className="text-sm text-white">
          <b>
            {inForce.time} {zoneLabel(inForce.timeZone)}
          </b>{' '}
          <span className="text-gray-400">
            · {inForce.durationMin} min · {[...new Set([zone, ...settings.extraZones])].filter((z) => z !== inForce.timeZone).slice(0, 3).map((z) => `${formatTime(coming[0]?.at ?? now, z)} ${zoneLabel(z)}`).join(' · ')}
          </span>
        </p>
      ) : (
        <p className="text-sm text-gray-400">No restart rule.</p>
      )}
      <div className="mt-2 text-xs text-gray-400">
        Next ones (your time): {coming.map((c) => `${formatDay(c.at, zone)} ${formatTime(c.at, zone)}${c.kind === 'extra' ? ' (extra)' : ''}`).join(' · ')}
      </div>

      {later.length > 0 && (
        <div className="mt-3">
          <div className="label">Changes to come</div>
          {later.map((r) => (
            <div key={r.from} className="flex items-center gap-2 py-1 text-sm">
              <span className="text-gray-300">
                From {formatWhen(Date.parse(r.from), zone)}: <b className="text-white">{r.time} {zoneLabel(r.timeZone)}</b>, {r.durationMin} min
              </span>
              {edit && (
                <button className="btn btn-sm btn-ghost ml-auto text-red-300" disabled={busy} onClick={() => onSave(rules.filter((x) => x !== r), exceptions)}>
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {exceptions.length > 0 && (
        <div className="mt-3">
          <div className="label">Exceptions</div>
          {exceptions.map((e, i) => (
            <div key={i} className="flex items-center gap-2 py-1 text-sm">
              <span className="text-gray-300">
                {e.date} ({zoneLabel(e.timeZone)}): {e.skip ? <b className="text-white">no restart</b> : <b className="text-white">extra restart at {e.extra?.time}, {e.extra?.durationMin} min</b>}
              </span>
              {edit && (
                <button className="btn btn-sm btn-ghost ml-auto text-red-300" disabled={busy} onClick={() => onSave(rules, exceptions.filter((x) => x !== e))}>
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <RealRestarts
        current={inForce ?? null}
        onUse={edit && inForce ? (time) => onSave([...rules, { from: new Date().toISOString(), time, timeZone: inForce.timeZone, durationMin: inForce.durationMin }], exceptions) : undefined}
        busy={busy}
      />
      {edit && (
        <div className="mt-3 flex gap-2">
          <button className="btn btn-sm" onClick={() => onAdd('rule')}>
            Change the daily time…
          </button>
          <button className="btn btn-sm" onClick={() => onAdd('exception')}>
            Skip a day / extra restart…
          </button>
        </div>
      )}
    </div>
  )
}

/** A wall time in a zone, with its equivalents in the member's zones */
function WhenInput({ label, value, zone, onChange, optional }: { label: string; value: number | null; zone: string; onChange(v: number | null): void; optional?: string }) {
  const { settings } = useStore()
  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex items-center gap-3 text-sm">
        {optional && (
          <label className="flex items-center gap-1.5 text-gray-300">
            <input type="checkbox" checked={value === null} onChange={(e) => onChange(e.target.checked ? null : Date.now() + DAY)} /> {optional}
          </label>
        )}
        {value !== null && (
          <input
            type="datetime-local"
            className="field w-auto! py-1.5"
            value={toWallInput(value, zone)}
            onChange={(e) => {
              const t = fromWallInput(e.target.value, zone)
              if (t !== null) onChange(t)
            }}
          />
        )}
      </div>
      {value !== null && <p className="mt-1 text-xs text-gray-400">{[...new Set([zone, ...settings.extraZones])].map((z) => `${formatWhen(value, z)} ${zoneLabel(z)}`).join(' · ')}</p>}
    </div>
  )
}

function MaintenanceForm({ title, edit, now, busy, onClose, onSave }: { title: string; edit?: Maintenance; now?: boolean; busy: boolean; onClose(): void; onSave(m: Maintenance): void }) {
  const { zone: myZone } = useStore()
  const [zone, setZone] = useState(myZone)
  const { state } = usePubs()
  const templates = state?.maintenanceTemplates ?? []
  const [en, setEn] = useState(edit?.message.en ?? (now ? (templates[0]?.text ?? '') : (templates.find((t) => t.id === 't-planned')?.text ?? '')))
  const [editing, setEditing] = useState(false)
  const round = (t: number) => Math.ceil(t / 3_600_000) * 3_600_000
  const [start, setStart] = useState<number | null>(edit ? Date.parse(edit.start) : round(Date.now() + DAY))
  const [end, setEnd] = useState<number | null>(edit?.end ? Date.parse(edit.end) : now ? null : round(Date.now() + DAY) + 2 * 3_600_000)
  const [announce, setAnnounce] = useState<number | null>(edit ? (edit.announceFrom ? Date.parse(edit.announceFrom) : null) : round(Date.now()))
  const iso = (t: number) => new Date(t).toISOString()
  const ok = en.trim().length > 0 && (now || start !== null)
  return (
    <Modal title={title} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <MessagePicker templates={templates} value={en} onChange={setEn} onEditTemplates={() => setEditing(true)} />
        {editing && <TemplatesEditor templates={templates} onClose={() => setEditing(false)} />}
        <ZonePicker value={zone} onPick={setZone} />
        {!now && <WhenInput label="Start" value={start} zone={zone} onChange={setStart} />}
        <WhenInput label={now ? 'Expected end (shown to players)' : 'End'} value={end} zone={zone} onChange={setEnd} optional={now ? 'No expected end' : 'Ended by hand ("back online")'} />
        {!now && <WhenInput label="Announced to players from" value={announce} zone={zone} onChange={setAnnounce} optional="Not announced before it starts" />}
        <div className="flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className={`btn ${now ? 'bg-amber-600 hover:bg-amber-600/85' : 'btn-primary'}`}
            disabled={busy || !ok}
            onClick={() =>
              onSave({
                id: edit?.id ?? (undefined as unknown as string),
                message: { en: en.trim() },
                start: now ? iso(Date.now()) : iso(start!),
                ...(end !== null ? { end: iso(end) } : {}),
                ...(!now && announce !== null ? { announceFrom: iso(announce) } : {}),
              })
            }
          >
            {now ? 'Start it now' : 'Save and publish'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/** The message: a ready-made one (it can still be adjusted) or "Write my own…" */
function MessagePicker({ templates, value, onChange, onEditTemplates }: { templates: MessageTemplate[]; value: string; onChange(v: string): void; onEditTemplates(): void }) {
  const { can } = useStore()
  const match = templates.find((t) => t.text === value)
  const [own, setOwn] = useState(!match && value !== '')
  return (
    <div>
      <div className="mb-1.5 flex items-center">
        <label className="label mb-0!">Message shown to players</label>
        {can('templates.write') && (
          <button type="button" className="ml-auto text-xs text-green-300 hover:underline" onClick={onEditTemplates}>
            Edit the templates…
          </button>
        )}
      </div>
      <select
        className="field mb-2"
        value={own || !match ? 'own' : match.id}
        onChange={(e) => {
          if (e.target.value === 'own') {
            setOwn(true)
            return
          }
          setOwn(false)
          onChange(templates.find((t) => t.id === e.target.value)?.text ?? '')
        }}
      >
        {templates.map((t) => (
          <option key={t.id} value={t.id}>
            Template: {t.name}
          </option>
        ))}
        <option value="own">Write my own…</option>
      </select>
      <textarea className="field min-h-[64px]" maxLength={300} value={value} placeholder="Server update, back soon." onChange={(e) => (onChange(e.target.value), setOwn(true))} />
      <p className="mt-1 text-xs text-gray-500">In English: maintenance messages are not translated.</p>
    </div>
  )
}

/** The staff's ready-made maintenance messages: rename, change, add, remove */
function TemplatesEditor({ templates, onClose }: { templates: MessageTemplate[]; onClose(): void }) {
  const { act } = usePubs()
  const [list, setList] = useState(templates)
  const [error, setError] = useState<string | null>(null)
  const set = (i: number, patch: Partial<MessageTemplate>) => setList(list.map((t, j) => (j === i ? { ...t, ...patch } : t)))
  const save = async () => {
    const res = await act('POST', '/server/templates', { templates: list })
    if (res.ok) onClose()
    else setError(res.error)
  }
  return (
    <Modal title="Maintenance message templates" onClose={onClose}>
      <div className="flex max-h-[60vh] flex-col gap-3 overflow-auto pr-1">
        {list.map((t, i) => (
          <div key={t.id} className="rounded-lg bg-gray-900/60 p-2.5">
            <div className="mb-1.5 flex gap-2">
              <input className="field py-1.5" value={t.name} maxLength={40} placeholder="Name" onChange={(e) => set(i, { name: e.target.value })} />
              <button className="btn btn-sm btn-ghost text-red-300" onClick={() => setList(list.filter((_, j) => j !== i))}>
                Remove
              </button>
            </div>
            <textarea className="field min-h-[54px]" value={t.text} maxLength={300} onChange={(e) => set(i, { text: e.target.value })} />
          </div>
        ))}
        <button className="btn btn-sm self-start" onClick={() => setList([...list, { id: `t-${Date.now().toString(36)}`, name: 'New template', text: '' }])}>
          + Add a template
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <button className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={list.some((t) => !t.name.trim() || !t.text.trim())} onClick={() => void save()}>
          Save for everyone
        </button>
      </div>
    </Modal>
  )
}

/**
 * The restarts as Herald saw them (checked every 5 s around the scheduled time): when the server went down and came
 * back. When the last ones keep differing from the daily time, Herald suggests the real one (one click to use it).
 */
function RealRestarts({ current, onUse, busy }: { current: RestartRule | null; onUse?: (time: string) => void; busy: boolean }) {
  const { zone, sync } = useStore()
  const [seen, setSeen] = useState<{ observations: RestartObservation[]; suggestion: { time: string; offsetMin: number } | null } | null>(null)
  // read again with the rest (sync refreshes every few seconds; once a minute is plenty here)
  const minute = Math.floor((sync?.now ?? Date.now()) / 60_000)
  useEffect(() => void window.herald.api<NonNullable<typeof seen>>('GET', '/server/restarts').then((r) => r.ok && setSeen(r.data)), [minute, current?.time])
  if (!seen) return null
  const now = sync?.now ?? Date.now()
  const secs = (ms: number) => (ms >= 60_000 ? `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s` : `${Math.round(ms / 1000)} s`)
  const clock = (at: number) => new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(at)
  return (
    <div className="mt-3">
      <div className="label">Real restarts (seen by Herald)</div>
      {seen.suggestion && current && (
        <div className="mb-2 flex flex-wrap items-center gap-3 rounded-md border border-amber-400/40 bg-amber-900/25 px-3 py-2 text-sm">
          <span className="min-w-0 flex-1 text-amber-100">
            The server restarted about {Math.abs(seen.suggestion.offsetMin)} min {seen.suggestion.offsetMin > 0 ? 'later' : 'earlier'} than planned the last 3 times: around{' '}
            <b className="text-white">
              {seen.suggestion.time} {zoneLabel(current.timeZone)}
            </b>{' '}
            instead of {current.time}.
          </span>
          {onUse && (
            <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => onUse(seen.suggestion!.time)}>
              Use {seen.suggestion.time}
            </button>
          )}
        </div>
      )}
      {seen.observations.length === 0 ? (
        <p className="text-xs text-gray-400">None seen yet: Herald watches from 5 minutes before the daily time to 20 minutes after it.</p>
      ) : (
        <ul className="space-y-0.5 text-xs">
          {seen.observations.slice(0, 7).map((o) => {
            const watching = o.upAt === null && now < o.scheduledAt + 20 * 60_000
            return (
              <li key={o.scheduledAt} className="flex flex-wrap gap-x-2 text-gray-300">
                <span className="w-28 shrink-0 text-gray-400">{formatDay(o.scheduledAt, zone)}</span>
                <span className="w-24 shrink-0">planned {formatTime(o.scheduledAt, zone)}</span>
                {o.downAt === null ? (
                  <span className={watching ? 'text-sky-300' : 'text-gray-500'}>{watching ? 'watching now…' : 'not seen going down'}</span>
                ) : (
                  <span>
                    down <b className="text-white">{clock(o.downAt)}</b>
                    {o.upAt !== null ? (
                      <>
                        {' '}
                        → back <b className="text-white">{clock(o.upAt)}</b> <span className="text-gray-500">({secs(o.upAt - o.downAt)} off)</span>
                      </>
                    ) : (
                      <span className="text-amber-300"> · {watching ? 'not back yet…' : 'not seen coming back in the watch time'}</span>
                    )}
                    {Math.abs(o.downAt - o.scheduledAt) >= 60_000 && <span className="text-gray-500"> · {Math.round((o.downAt - o.scheduledAt) / 60_000)} min from the plan</span>}
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/** The daily restart's time: from now (the usual case), or from a date (the host changes it later, daylight saving) */
function RuleForm({ current, busy, onClose, onSave }: { current: RestartRule | null; busy: boolean; onClose(): void; onSave(r: RestartRule): void }) {
  const { zone: myZone } = useStore()
  const [zone, setZone] = useState(current?.timeZone ?? 'Europe/Paris')
  const [time, setTime] = useState(current?.time ?? '17:00')
  const [duration, setDuration] = useState(current?.durationMin ?? 5)
  const [later, setLater] = useState(false)
  const [from, setFrom] = useState<number | null>(Math.ceil((Date.now() + DAY) / DAY) * DAY)
  return (
    <Modal title="Change the daily restart time" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-gray-400">
          {current ? `Now: ${current.time} ${zoneLabel(current.timeZone)}, ${current.durationMin} min. ` : ''}Launchers count down to the new time as soon as it is published. An exception for one day only
          (no restart, or an extra one) is the other button.
        </p>
        <div className="flex items-end gap-3">
          <div>
            <label className="label">Time</label>
            <input type="time" className="field w-auto!" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
          <div>
            <label className="label">Lasts (min)</label>
            <input type="number" min={1} max={120} className="field w-24!" value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
          </div>
        </div>
        <div>
          <label className="label">Time zone of this time</label>
          <ZonePicker value={zone} onPick={setZone} />
        </div>
        <div className="flex gap-1.5">
          <button className={`btn btn-sm ${!later ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setLater(false)}>
            From now
          </button>
          <button className={`btn btn-sm ${later ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setLater(true)}>
            From a date…
          </button>
        </div>
        {later && <WhenInput label={`From (${zoneLabel(myZone)})`} value={from} zone={myZone} onChange={setFrom} />}
        <div className="flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy || (later && from === null) || !/^\d{2}:\d{2}$/.test(time)} onClick={() => onSave({ from: new Date(later ? from! : Date.now()).toISOString(), time, timeZone: zone, durationMin: duration })}>
            Save and publish
          </button>
        </div>
      </div>
    </Modal>
  )
}

function ExceptionForm({ busy, onClose, onSave }: { busy: boolean; onClose(): void; onSave(e: RestartException): void }) {
  const [zone, setZone] = useState('Europe/Paris')
  const [date, setDate] = useState(new Date(Date.now() + DAY).toISOString().slice(0, 10))
  const [skip, setSkip] = useState(true)
  const [time, setTime] = useState('09:00')
  const [duration, setDuration] = useState(5)
  return (
    <Modal title="Skip a day or add a restart" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div className="flex gap-2">
          <button className={`btn btn-sm ${skip ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setSkip(true)}>
            No restart that day
          </button>
          <button className={`btn btn-sm ${!skip ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setSkip(false)}>
            An extra restart
          </button>
        </div>
        <div className="flex items-end gap-3">
          <div>
            <label className="label">Day</label>
            <input type="date" className="field w-auto!" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          {!skip && (
            <>
              <div>
                <label className="label">Time</label>
                <input type="time" className="field w-auto!" value={time} onChange={(e) => setTime(e.target.value)} />
              </div>
              <div>
                <label className="label">Lasts (min)</label>
                <input type="number" min={1} max={120} className="field w-24!" value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
              </div>
            </>
          )}
        </div>
        <div>
          <label className="label">Time zone of this day{skip ? '' : ' and time'}</label>
          <ZonePicker value={zone} onPick={setZone} />
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy || !/^\d{4}-\d{2}-\d{2}$/.test(date)} onClick={() => onSave({ date, timeZone: zone, ...(skip ? { skip: true } : { extra: { time, durationMin: duration } }) })}>
            Save and publish
          </button>
        </div>
      </div>
    </Modal>
  )
}

const ACTION: Record<string, string> = {
  'maintenance.plan': 'planned a maintenance',
  'maintenance.update': 'changed a maintenance',
  'maintenance.delete': 'removed a maintenance',
  'maintenance.start': 'started a maintenance now',
  'maintenance.end': 'said the server is back online',
  'restart.update': 'changed the daily restart',
  'templates.update': 'changed the message templates',
}

function History() {
  const { sync } = useStore()
  const [rows, setRows] = useState<{ id: number; action: string; at: number; who: string | null }[]>([])
  const stamp = sync?.contentStamp
  useEffect(() => {
    void window.herald.api<typeof rows>('GET', '/server/history').then((r) => r.ok && setRows(r.data))
  }, [stamp])
  if (!rows.length) return null
  return (
    <div className="card mt-4">
      <div className="eyebrow mb-2">History</div>
      {rows.slice(0, 12).map((r) => (
        <div key={r.id} className="flex border-t border-gray-700/50 py-1.5 text-sm first:border-0">
          <span>
            <b className="text-white">{r.who ?? 'Someone'}</b> {ACTION[r.action] ?? r.action}
          </span>
          <span className="ml-auto text-xs text-gray-400">{ago(r.at)}</span>
        </div>
      ))}
      <p className="mt-1 text-xs text-gray-500">Every version is kept for good.</p>
    </div>
  )
}
