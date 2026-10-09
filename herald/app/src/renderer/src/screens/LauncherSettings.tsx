/**
 * Profile menu → Launcher settings: where players send problem reports (support link), the Discord application behind
 * "Playing on Hemisphere SMP", the staff code of the launcher's Developer tab, and which launcher players have.
 * Each change is published at once (launchers have it within 2 minutes).
 */
import { useEffect, useState } from 'react'
import { usePubs } from '../pubs'
import { useStore } from '../store'
import { Modal } from '../components/ui'
import { formatWhen } from '../time'

/** The first launcher that reads Herald's content (schema 2: scheduling, vaults, banner, events…) */
const HERALD_LAUNCHER = '1.2.0'
const newer = (a: string, b: string) => {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number))
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0)
  return false
}

export default function LauncherSettings() {
  const { state, act, reload } = usePubs()
  const { can, zone } = useStore()
  const pub = state?.publicSettings
  const [supportUrl, setSupportUrl] = useState('')
  const [howTo, setHowTo] = useState('')
  const [discord, setDiscord] = useState('')
  const [check, setCheck] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<null | 'new' | 'builtIn'>(null)
  const [shownCode, setShownCode] = useState<string | null>(null)
  const [latest, setLatest] = useState<string | null | undefined>(undefined)

  // The fields follow the published settings (until edited)
  const key = JSON.stringify(pub?.settings ?? null)
  useEffect(() => {
    if (!pub) return
    setSupportUrl(pub.settings.support?.url ?? '')
    setHowTo(pub.settings.support?.howTo?.en ?? '')
    setDiscord(pub.settings.discordAppId ?? '')
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => void window.herald.launcher.latest().then(setLatest), [])
  if (!state || !pub) return <div className="text-gray-400">Loading…</div>

  const s = pub.settings
  const changed = supportUrl.trim() !== (s.support?.url ?? '') || howTo.trim() !== (s.support?.howTo?.en ?? '') || discord.trim() !== (s.discordAppId ?? '')
  const savePublic = async () => {
    setBusy(true)
    setError(null)
    setSaved(null)
    const settings = {
      support: supportUrl.trim() ? { url: supportUrl.trim(), ...(howTo.trim() ? { howTo: { en: howTo.trim() } } : {}) } : null,
      discordAppId: discord.trim() || null,
    }
    const res = await act('POST', '/settings/public', { version: pub.version, part: 'public', settings })
    setBusy(false)
    if (!res.ok) return setError(res.error)
    setSaved('Published: launchers have it within 2 minutes.')
  }
  const newCode = async () => {
    setConfirm(null)
    setBusy(true)
    setError(null)
    const res = await window.herald.launcher.newStaffCode(pub.version)
    setBusy(false)
    void reload()
    if (!res.ok) return setError(res.error)
    setShownCode(res.data.code)
  }
  const builtIn = async () => {
    setConfirm(null)
    setBusy(true)
    const res = await act('POST', '/settings/public', { version: pub.version, part: 'staffCode', settings: { staffCode: null } })
    setBusy(false)
    if (!res.ok) setError(res.error)
  }

  return (
    <div className="animate-fade max-w-3xl">
      <div className="mb-4">
        <div className="eyebrow">Published in every launcher</div>
        <h1 className="text-[26px] font-extrabold text-white">Launcher settings</h1>
      </div>
      {error && <p className="mb-3 rounded-lg border border-red-400/30 bg-red-600/10 px-3 py-2 text-sm text-red-300">{error}</p>}

      <div className="card mb-4">
        <div className="eyebrow mb-1">Which launcher players have</div>
        {latest === undefined ? (
          <p className="text-sm text-gray-400">Looking at the launcher's releases…</p>
        ) : latest === null ? (
          <p className="text-sm text-gray-400">The launcher's releases could not be read (no internet?).</p>
        ) : newer(HERALD_LAUNCHER, latest) ? (
          <p className="text-sm text-amber-200">
            Players have the launcher <b>{latest}</b>. What Herald publishes needs <b>{HERALD_LAUNCHER}</b> or newer: until that version is released, players keep seeing the old content (nothing published here reaches them yet).
          </p>
        ) : (
          <p className="text-sm text-green-300">
            Players have the launcher <b>{latest}</b>: it reads everything Herald publishes.
          </p>
        )}
      </div>

      <fieldset disabled={!can('settings.public') || busy} className="card mb-4 flex flex-col gap-3">
        <div className="eyebrow">Support and Discord</div>
        <div>
          <label className="label">Support link (the Discord channel where players open a ticket; empty = the Discord invite)</label>
          <input className="field" placeholder="https://discord.com/channels/…" value={supportUrl} onChange={(e) => setSupportUrl(e.target.value)} />
        </div>
        <div>
          <label className="label">How to ask for help (optional, shown next to the link)</label>
          <input className="field" maxLength={120} placeholder="#support → Create ticket" value={howTo} onChange={(e) => setHowTo(e.target.value)} />
        </div>
        <div>
          <label className="label">Discord application id (shows “Playing on Hemisphere SMP” in players' Discord status)</label>
          <div className="flex gap-2">
            <input className="field" placeholder="17 to 20 digits" value={discord} onChange={(e) => (setDiscord(e.target.value), setCheck(null))} />
            <button
              type="button"
              className="btn shrink-0"
              disabled={!/^\d{17,20}$/.test(discord.trim())}
              onClick={async () => {
                setCheck('Checking…')
                const r = await window.herald.launcher.checkDiscord(discord.trim())
                setCheck(r.ok ? `✓ ${r.name}` : r.reason === 'notApp' ? '✕ No Discord application has this id' : 'Discord could not be reached')
              }}
            >
              Check
            </button>
          </div>
          {check && <p className={`mt-1 text-xs ${check.startsWith('✓') ? 'text-green-300' : 'text-amber-300'}`}>{check}</p>}
        </div>
        <div className="flex items-center gap-3">
          {saved && !changed && <span className="text-sm text-green-300">{saved}</span>}
          <button className="btn btn-primary ml-auto" disabled={!changed} onClick={() => void savePublic()}>
            Publish
          </button>
        </div>
      </fieldset>

      <div className="card">
        <div className="eyebrow mb-1">Staff code (launcher's Developer tab)</div>
        <p className="text-sm text-gray-300">
          {s.staffCode ? (
            <>
              A code made in Herald{pub.staffCodeAt ? ` on ${formatWhen(pub.staffCodeAt, zone)}` : ''}
              {pub.staffCodeBy ? ` by ${pub.staffCodeBy}` : ''}. Launchers accept only this one.
            </>
          ) : (
            'Launchers accept the code built into the launcher.'
          )}{' '}
          The code itself is kept nowhere: it is shown once when it is made. PCs already unlocked stay unlocked.
        </p>
        {can('settings.staffCode') ? (
          <div className="mt-3 flex gap-2">
            <button className="btn btn-primary" disabled={busy} onClick={() => setConfirm('new')}>
              Make a new code
            </button>
            {s.staffCode && (
              <button className="btn btn-ghost" disabled={busy} onClick={() => setConfirm('builtIn')}>
                Back to the built-in code
              </button>
            )}
          </div>
        ) : (
          <p className="mt-2 text-xs text-gray-500">Only the Owner and the Developer can change it.</p>
        )}
      </div>

      {confirm && (
        <Modal title={confirm === 'new' ? 'Make a new staff code?' : 'Back to the built-in code?'} onClose={() => setConfirm(null)}>
          <p className="mb-4 text-sm text-gray-300">
            {confirm === 'new'
              ? 'Within 2 minutes, launchers accept only the new code: the previous one stops working. It is made on this PC and shown to you once: have a safe place ready to keep it.'
              : 'Within 2 minutes, launchers accept the code built into the launcher again; the code made in Herald stops working.'}
          </p>
          <div className="flex justify-end gap-2">
            <button className="btn btn-ghost" onClick={() => setConfirm(null)}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={() => void (confirm === 'new' ? newCode() : builtIn())}>
              {confirm === 'new' ? 'Make it' : 'Go back to it'}
            </button>
          </div>
        </Modal>
      )}
      {shownCode && (
        <Modal title="The new staff code">
          <p className="mb-3 text-sm text-gray-300">Shown only now. Give it to the staff who need the Developer tab, never in a public channel.</p>
          <div className="mb-4 flex items-center gap-3 rounded-lg bg-gray-900 px-4 py-3">
            <code className="text-xl font-bold tracking-wider text-green-300 select-text">{shownCode}</code>
            <button className="btn btn-sm ml-auto" onClick={() => window.herald.copy(shownCode)}>
              Copy
            </button>
          </div>
          <div className="flex justify-end">
            <button className="btn btn-primary" onClick={() => setShownCode(null)}>
              I kept it somewhere safe
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
