import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Download, FileUp, History, LoaderCircle, Package, RefreshCw, Save, Trash2, TriangleAlert, Upload, Wrench, type LucideIcon } from 'lucide-react'
import type { RestorePointInfo, RestorePreview, RestoreReason, SetupImportResult, SetupSummary } from '@shared/restorePoints'
import { formatBytes } from '../format'
import ConfirmDialog from '../components/ConfirmDialog'

const button = 'flex items-center gap-2 rounded-lg bg-gray-700/85 px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-gray-600 disabled:pointer-events-none disabled:opacity-50'
const primary = 'flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white shadow-md transition-colors hover:bg-green-500 disabled:pointer-events-none disabled:opacity-50'
const quiet = 'rounded-lg px-3 py-2 text-sm font-semibold text-gray-400 transition-colors hover:bg-gray-700 hover:text-white'

const ICONS: Record<RestoreReason['kind'], LucideIcon> = {
  clientUpdate: RefreshCw,
  import: Upload,
  updateAll: RefreshCw,
  version: Package,
  restore: History,
  setupImport: FileUp,
  repair: Wrench,
  manual: Save,
}

type Message = { ok: boolean; text: string; list?: string[] }

/** Settings > Backups: restore points (automatic + on demand) and moving the whole setup to another PC. */
export default function Backups() {
  const { t, i18n } = useTranslation()
  const [points, setPoints] = useState<RestorePointInfo[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<Message | null>(null)
  // the restore point the player is about to delete (confirmation box)
  const [deleting, setDeleting] = useState<RestorePointInfo | null>(null)
  const reload = () => window.hemisphere.backups.list().then(setPoints)
  useEffect(() => {
    void reload()
  }, [])

  const when = (ms: number) => {
    const d = new Date(ms)
    const today = new Date()
    const time = d.toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })
    if (d.toDateString() === today.toDateString()) return `${t('shots.today')}, ${time}`
    if (d.toDateString() === new Date(today.getTime() - 86_400_000).toDateString()) return `${t('shots.yesterday')}, ${time}`
    return d.toLocaleString(i18n.language, { day: 'numeric', month: 'long', ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}), hour: '2-digit', minute: '2-digit' })
  }
  const reasonText = (r: RestoreReason) => (r.kind === 'restore' ? t('backups.reason.restore', { when: when(r.to) }) : t(`backups.reason.${r.kind}`, r))

  const create = async () => {
    setBusy(true)
    setMessage(null)
    const r = await window.hemisphere.backups.create()
    setBusy(false)
    if (r.ok) {
      setMessage(r.id ? { ok: true, text: t('backups.created') } : { ok: false, text: t('backups.nothingYet') })
      void reload()
    } else setMessage({ ok: false, text: t(`backups.errors.${r.reason}`) })
  }
  const remove = async (id: string) => {
    setDeleting(null)
    if (await window.hemisphere.backups.remove(id)) {
      if (open === id) setOpen(null)
      void reload()
    }
  }

  return (
    <div className="mt-2">
      <div className="flex items-center gap-5 border-b border-white/5 py-4">
        <div className="min-w-0 flex-1">
          <b className="block font-semibold text-white">{t('backups.pointsTitle')}</b>
          <span className="block text-[12.5px] text-gray-400">{t('backups.pointsHint')}</span>
        </div>
        <button onClick={create} disabled={busy} className={button}>
          <Save size={16} /> {t('backups.createNow')}
        </button>
      </div>
      {message && <Note message={message} onClose={() => setMessage(null)} />}

      {points === null ? (
        <div className="mt-3 space-y-2" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-[60px] rounded-lg" />
          ))}
        </div>
      ) : points.length === 0 ? (
        <p className="mt-3 rounded-lg bg-gray-900/55 px-4 py-5 text-center text-[13px] text-gray-400">{t('backups.empty')}</p>
      ) : (
        <ul className="mt-3 overflow-hidden rounded-lg bg-gray-900/55">
          {points.map((p) => {
            const Icon = ICONS[p.reason.kind] ?? Save
            const contents = [
              t('backups.modsCount', { count: p.mods }),
              p.hasOptions && t('backups.keybinds'),
              p.hasServers && t('backups.servers'),
              p.configFiles > 0 && t('backups.configCount', { count: p.configFiles }),
            ].filter(Boolean)
            return (
              <li key={p.id} className="border-b border-white/5 last:border-b-0">
                <div className="flex items-center gap-3 px-4 py-3">
                  <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-gray-800 text-green-400">
                    <Icon size={17} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <b className="block truncate text-[14px] font-semibold text-white">{reasonText(p.reason)}</b>
                    <span className="block text-[12.5px] text-gray-400">
                      {when(p.createdAt)}
                      {p.clientVersion && ` · ${t('backups.client', { version: p.clientVersion })}`} · {contents.join(' · ')}
                    </span>
                  </div>
                  <button onClick={() => setOpen(open === p.id ? null : p.id)} className={open === p.id ? `${button} !bg-gray-600` : button} aria-expanded={open === p.id}>
                    <History size={15} /> {t('backups.restore')}
                  </button>
                  <button onClick={() => setDeleting(p)} title={t('backups.delete')} aria-label={t('backups.delete')} className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-700 hover:text-red-400">
                    <Trash2 size={16} />
                  </button>
                </div>
                {open === p.id && (
                  <RestorePanel
                    id={p.id}
                    onCancel={() => setOpen(null)}
                    onDone={(m) => {
                      setOpen(null)
                      setMessage(m)
                      void reload()
                    }}
                  />
                )}
              </li>
            )
          })}
        </ul>
      )}

      <MoveSetup onImported={() => void reload()} />

      {deleting && (
        <ConfirmDialog title={t('backups.deleteTitle')} confirmLabel={t('backups.deleteConfirm')} onConfirm={() => remove(deleting.id)} onCancel={() => setDeleting(null)}>
          <p className="rounded-lg bg-gray-800/80 px-3 py-2.5">
            <b className="block text-white">“{reasonText(deleting.reason)}”</b>
            <span className="text-[12.5px] text-gray-400">
              {when(deleting.createdAt)}
              {deleting.clientVersion && ` · ${t('backups.client', { version: deleting.clientVersion })}`}
            </span>
          </p>
          <p className="mt-3">{t('backups.deleteBody')}</p>
        </ConfirmDialog>
      )}
    </div>
  )
}

/** What restoring would change, then Restore / Cancel. */
function RestorePanel({ id, onCancel, onDone }: { id: string; onCancel(): void; onDone(m: Message): void }) {
  const { t } = useTranslation()
  const [preview, setPreview] = useState<RestorePreview | null | undefined>(undefined)
  const [running, setRunning] = useState(false)
  useEffect(() => {
    void window.hemisphere.backups.preview(id).then(setPreview)
  }, [id])

  const run = async () => {
    setRunning(true)
    const r = await window.hemisphere.backups.restore(id)
    setRunning(false)
    if (r.ok) onDone({ ok: !r.missing.length, text: r.missing.length ? t('backups.restoredMissing', { names: r.missing.join(', ') }) : t('backups.restored') })
    else onDone({ ok: false, text: t(`backups.errors.${r.reason}`) })
  }

  if (preview === undefined)
    return (
      <div className="flex items-center gap-2 px-4 pb-4 pl-16 text-[13px] text-gray-400">
        <LoaderCircle size={15} className="animate-spin" /> {t('backups.comparing')}
      </div>
    )
  if (preview === null) return <p className="px-4 pb-4 pl-16 text-[13px] text-red-300">{t('backups.errors.notFound')}</p>

  const lines: [string, string[]?][] = []
  if (preview.options) lines.push([t('backups.will.options')])
  if (preview.servers) lines.push([t('backups.will.servers')])
  if (preview.configs) lines.push([t('backups.will.configs', { count: preview.configs })])
  if (preview.changed.length) lines.push([t('backups.will.changed', { count: preview.changed.length }), preview.changed.map((c) => `${c.name}: ${c.from} → ${c.to}`)])
  if (preview.back.length) lines.push([t('backups.will.back', { count: preview.back.length }), preview.back])
  if (preview.away.length) lines.push([t('backups.will.away', { count: preview.away.length }), preview.away])
  if (preview.switched) lines.push([t('backups.will.switched', { count: preview.switched })])

  return (
    <div className="animate-fade px-4 pb-4 pl-16">
      {lines.length ? (
        <>
          <p className="mb-1.5 text-[13px] font-semibold text-gray-200">{t('backups.willTitle')}</p>
          <ul className="mb-3 space-y-1 text-[13px] text-gray-300">
            {lines.map(([text, names]) => (
              <li key={text} className="flex gap-2">
                <span className="mt-[7px] h-1.5 w-1.5 flex-none rounded-full bg-green-400" />
                <span className="min-w-0">
                  {text}
                  {names && <span className="block text-[12.5px] break-words text-gray-400">{names.join(', ')}</span>}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mb-3 text-[13px] text-gray-300">{t('backups.noDifference')}</p>
      )}
      <p className="mb-3 text-[12.5px] text-gray-400">{t('backups.safety')}</p>
      <div className="flex gap-2">
        <button onClick={run} disabled={running} className={primary}>
          {running ? <LoaderCircle size={15} className="animate-spin" /> : <History size={15} />} {running ? t('backups.restoring') : t('backups.restoreConfirm')}
        </button>
        <button onClick={onCancel} disabled={running} className={quiet}>
          {t('browse.cancel')}
        </button>
      </div>
    </div>
  )
}

/** Export my setup / Import my setup (to or from another PC). */
function MoveSetup({ onImported }: { onImported(): void }) {
  const { t, i18n } = useTranslation()
  const [busy, setBusy] = useState<'export' | 'pick' | 'import' | null>(null)
  const [picked, setPicked] = useState<{ token: string; summary: SetupSummary } | null>(null)
  const [message, setMessage] = useState<Message | null>(null)

  const exportSetup = async () => {
    setMessage(null)
    setBusy('export')
    const r = await window.hemisphere.backups.exportSetup()
    setBusy(null)
    if (r.ok) setMessage({ ok: true, text: t('backups.exported', { path: r.path, size: formatBytes(r.bytes, i18n.language) }) })
    else if (r.reason !== 'cancelled') setMessage({ ok: false, text: t('backups.errors.failed') })
  }
  const pick = async () => {
    setMessage(null)
    setBusy('pick')
    const r = await window.hemisphere.backups.pickSetup()
    setBusy(null)
    if (r.ok) setPicked(r)
    else if (r.reason === 'invalid') setMessage({ ok: false, text: t('backups.errors.invalid') })
  }
  const run = async () => {
    if (!picked) return
    setBusy('import')
    const r = await window.hemisphere.backups.importSetup(picked.token)
    setBusy(null)
    setPicked(null)
    setMessage(importMessage(r, t))
    if (r.ok) onImported()
  }

  const s = picked?.summary
  const otherMinecraft = !!s?.minecraft && s.minecraft !== s.currentMinecraft
  return (
    <div className="mt-6">
      <div className="flex items-center gap-5 border-b border-white/5 py-4">
        <div className="min-w-0 flex-1">
          <b className="block font-semibold text-white">{t('backups.moveTitle')}</b>
          <span className="block text-[12.5px] text-gray-400">{t('backups.moveHint')}</span>
        </div>
        <div className="flex flex-none gap-2">
          <button onClick={exportSetup} disabled={!!busy} className={button}>
            {busy === 'export' ? <LoaderCircle size={16} className="animate-spin" /> : <Download size={16} />} {t('backups.export')}
          </button>
          <button onClick={pick} disabled={!!busy} className={button}>
            <FileUp size={16} /> {t('backups.import')}
          </button>
        </div>
      </div>
      {message && <Note message={message} onClose={() => setMessage(null)} />}

      {s && (
        <div className="animate-fade mt-3 rounded-lg bg-gray-900/55 px-4 py-4">
          <b className="block truncate text-white">{s.name}</b>
          <span className="block text-[12.5px] text-gray-400">
            {new Date(s.createdAt).toLocaleString(i18n.language, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
            {s.clientVersion && ` · ${t('backups.client', { version: s.clientVersion })}`}
            {s.minecraft && ` · Minecraft ${s.minecraft}`}
          </span>
          <ul className="mt-3 space-y-1 text-[13px] text-gray-300">
            {[
              t('backups.setupMods', { count: s.mods }) + (s.embedded ? ` ${t('backups.setupEmbedded', { count: s.embedded })}` : ''),
              s.options && t('backups.keybindsLong'),
              s.servers && t('backups.serversLong'),
              s.configFiles > 0 && t('backups.configCount', { count: s.configFiles }),
              s.launcherSettings && t('backups.launcherSettings'),
            ]
              .filter(Boolean)
              .map((line) => (
                <li key={String(line)} className="flex gap-2">
                  <Check size={14} className="mt-0.5 flex-none text-green-400" /> {line}
                </li>
              ))}
          </ul>
          {otherMinecraft && (
            <p className="mt-3 flex gap-2 rounded-lg bg-amber-900/30 px-3 py-2 text-[13px] text-amber-200">
              <TriangleAlert size={15} className="mt-0.5 flex-none" /> {t('backups.otherMinecraft', { from: s.minecraft, to: s.currentMinecraft })}
            </p>
          )}
          <p className="mt-3 text-[12.5px] text-gray-400">{t('backups.importReplaces')}</p>
          <div className="mt-3 flex gap-2">
            <button onClick={run} disabled={busy === 'import'} className={primary}>
              {busy === 'import' ? <LoaderCircle size={15} className="animate-spin" /> : <FileUp size={15} />} {busy === 'import' ? t('backups.importing') : t('backups.importConfirm')}
            </button>
            <button onClick={() => setPicked(null)} disabled={busy === 'import'} className={quiet}>
              {t('browse.cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function importMessage(r: SetupImportResult, t: (k: string, o?: Record<string, unknown>) => string): Message {
  if (!r.ok) return { ok: false, text: t(`backups.errors.${r.reason}`) }
  const list = [
    ...(r.updated.length ? [t('backups.importUpdated', { names: r.updated.join(', ') })] : []),
    ...r.skipped.map((s) => t(`backups.skipped.${s.reason}`, { name: s.name })),
  ]
  return { ok: !r.skipped.length, text: t('backups.imported', { count: r.installed }), list }
}

function Note({ message, onClose }: { message: Message; onClose(): void }) {
  const { t } = useTranslation()
  return (
    <div role="status" className={`animate-fade mt-2 flex items-start gap-2 rounded-lg px-3 py-2 text-[13px] ${message.ok ? 'bg-green-900/40 text-green-200' : 'bg-amber-900/35 text-amber-200'}`}>
      {message.ok ? <Check size={14} className="mt-0.5 flex-none" /> : <TriangleAlert size={14} className="mt-0.5 flex-none" />}
      <div className="min-w-0 flex-1 break-words">
        {message.text}
        {message.list?.map((l) => (
          <span key={l} className="block text-[12.5px] opacity-85">
            {l}
          </span>
        ))}
      </div>
      <button onClick={onClose} className="flex-none opacity-70 hover:opacity-100" aria-label={t('shots.close')}>
        ×
      </button>
    </div>
  )
}
