/**
 * One publication: texts per language, picture, schedule, options, then review → Ready → Publish. Saves by itself
 * (a stale save is refused by the server), shows who else has it open, and previews it in the real launcher pieces.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PublicationDetail } from '@herald/api'
import { FIELDS, KIND_LABEL, LIMITS, TEXT_LANGUAGES, languageName, languagesOut, problems, type Publication, type PublicationData } from '@shared/heraldPublications'
import { usePubs, shown, SHOWN, pendingChanges, titleOf } from '../pubs'
import { useStore } from '../store'
import { Avatar, Modal, ZonePicker } from '../components/ui'
import { ago, formatWhen, fromWallInput, toWallInput, zoneLabel } from '../time'
import { formatBytes, prepareWebp, usePicture, usePictures } from '../pictures'
import { LauncherPreview, WINDOW_SIZES, type PreviewScreen, type WindowSize } from '../preview/LauncherPreview'
import { badgeAt, pictureIds, viewAt, withPlaceholders } from '../preview/view'

const DAY = 86_400_000
const NEWS_CATEGORIES_LABEL = { update: 'Update', event: 'Event', server: 'Server', community: 'Community' }

export default function Editor({ id, onClose }: { id: string; onClose(): void }) {
  const { state, act } = usePubs()
  const { me, can, zone } = useStore()
  const listed = state?.publications.find((p) => p.id === id) ?? null
  const [pub, setPub] = useState<Publication | null>(listed)
  const [data, setData] = useState<PublicationData | null>(listed?.data ?? null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [lang, setLang] = useState('en')
  const [detail, setDetail] = useState<PublicationDetail | null>(null)
  const [side, setSide] = useState<'preview' | 'comments' | 'history'>('preview')
  const [confirm, setConfirm] = useState<null | 'publish' | 'unpublish' | 'delete'>(null)

  // Someone else saved (or a status changed): take it, unless we have unsaved changes
  useEffect(() => {
    if (!listed || (pub && listed.version <= pub.version)) return
    setPub(listed)
    if (!dirty) setData(listed.data)
  }, [listed, pub, dirty])

  const loadDetail = useCallback(async () => {
    const res = await window.herald.api<PublicationDetail>('GET', `/publications/${id}`)
    if (res.ok) setDetail(res.data)
  }, [id])
  useEffect(() => {
    void loadDetail()
  }, [loadDetail, listed?.updatedAt])

  // Soft lock: "Kyonit is editing" for the others while this is open
  useEffect(() => {
    const on = () => void window.herald.api('POST', `/publications/${id}/editing`, { on: true })
    on()
    const timer = window.setInterval(on, 20_000)
    return () => {
      window.clearInterval(timer)
      void window.herald.api('POST', `/publications/${id}/editing`, { on: false })
    }
  }, [id])

  const editable = !!pub && !pub.deletedAt && pub.status !== 'ready' && can(pub.kind === 'news' ? 'news.write' : pub.kind === 'banner' ? 'banner.write' : 'welcome.write')

  // Saves by itself a second after the last change
  const latest = useRef({ pub, data })
  latest.current = { pub, data }
  useEffect(() => {
    if (!dirty || !editable) return
    const timer = window.setTimeout(async () => {
      const { pub: p, data: d } = latest.current
      if (!p || !d) return
      setSaving('saving')
      const res = await window.herald.api<Publication>('PATCH', `/publications/${id}`, { version: p.version, data: d })
      if (res.ok) {
        setPub(res.data)
        setDirty(JSON.stringify(latest.current.data) !== JSON.stringify(d))
        setSaving('saved')
        setError(null)
      } else {
        setSaving('error')
        setError(res.error)
      }
    }, 1000)
    return () => window.clearTimeout(timer)
  }, [data, dirty, editable, id])

  if (!pub || !data) return <div className="text-gray-400">Loading…</div>

  const change = (patch: Partial<PublicationData>) => {
    setData({ ...data, ...patch })
    setDirty(true)
  }
  const setText = (field: string, value: string) => change({ texts: { ...data.texts, [lang]: { ...data.texts[lang], [field]: value } } })

  const run = async (path: string, body: Record<string, unknown> = {}) => {
    setBusy(true)
    setError(null)
    const res = await act<Publication | { publication: Publication }>('POST', `/publications/${id}/${path}`, { version: pub.version, ...body })
    setBusy(false)
    if (!res.ok) return setError(res.error)
    const next = 'publication' in res.data ? res.data.publication : res.data
    setPub(next)
    setData(next.data)
    setDirty(false)
  }
  const reload = async () => {
    const res = await window.herald.api<PublicationDetail>('GET', `/publications/${id}`)
    if (!res.ok) return
    setPub(res.data.publication)
    setData(res.data.publication.data)
    setDirty(false)
    setError(null)
  }

  const issues = problems(pub.kind, data)
  const state0 = shown(pub)
  const otherEditor = pub.editing && pub.editing.by !== me.id ? pub.editing : null
  const scheduledLater = data.schedule.from && Date.parse(data.schedule.from) > Date.now()

  return (
    <div className="animate-fade">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button className="btn btn-ghost btn-sm" onClick={onClose}>
          ← Publications
        </button>
        <span className="text-xs font-bold tracking-widest text-gray-400 uppercase">{KIND_LABEL[pub.kind]}</span>
        <h1 className="min-w-0 truncate text-xl font-bold text-white">{titleOf(data)}</h1>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${SHOWN[state0].tone}`}>{SHOWN[state0].label}</span>
        {pub.published && state0 !== 'deleted' && pub.status !== 'ready' && <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${SHOWN[pub.status].tone}`}>Changes: {SHOWN[pub.status].label}</span>}
        {pendingChanges(pub) && pub.status === 'ready' && <span className="text-xs text-amber-400">Changes not published yet</span>}
        <span className="ml-auto text-xs text-gray-400">{saving === 'saving' ? 'Saving…' : saving === 'saved' && !dirty ? 'Saved' : dirty ? 'Not saved yet' : ''}</span>
      </div>

      {otherEditor && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-200">
          <Avatar name={otherEditor.name} size={20} /> <b>{otherEditor.name}</b> has it open right now: your changes and theirs may cross (the second save is refused).
        </div>
      )}
      {error && (
        <div className="mb-3 flex items-center gap-3 rounded-lg border border-red-400/30 bg-red-600/10 px-3 py-2 text-sm text-red-300">
          {error}
          {/changed this publication meanwhile/.test(error) && (
            <button className="btn btn-sm ml-auto" onClick={() => void reload()}>
              Reload it
            </button>
          )}
        </div>
      )}

      <Actions pub={pub} issues={issues} busy={busy} scheduledLater={!!scheduledLater} onStatus={(s) => void run('status', { status: s })} onConfirm={setConfirm} onRestore={() => void run('restore')} />

      <div className="grid grid-cols-[minmax(380px,1fr)_minmax(420px,1.15fr)] gap-5">
        <div className="flex flex-col gap-4">
          {!editable && !pub.deletedAt && pub.status === 'ready' && <p className="rounded-lg bg-gray-800 px-3 py-2 text-sm text-gray-300">Ready: locked. “Reopen” to change it (the published version stays online meanwhile).</p>}
          <fieldset disabled={!editable} className="flex flex-col gap-4">
            <Languages data={data} kind={pub.kind} lang={lang} onLang={setLang} onChange={change} />
            <Texts kind={pub.kind} data={data} lang={lang} onText={setText} />
            {pub.kind === 'news' && lang === 'en' && <NewsOptions data={data} onChange={change} />}
            {pub.kind === 'banner' && lang === 'en' && (
              <div>
                <label className="label">Importance</label>
                <div className="flex gap-2">
                  {(['info', 'important', 'critical'] as const).map((l) => (
                    <button key={l} type="button" className={`btn btn-sm ${data.level === l ? (l === 'critical' ? 'btn-danger' : 'btn-primary') : 'btn-ghost'}`} onClick={() => change({ level: l })}>
                      {l === 'info' ? 'Information (blue)' : l === 'important' ? 'Important (amber)' : 'Critical (red)'}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {lang === 'en' && <When data={data} onChange={change} defaultZone={zone} />}
            {lang === 'en' && (
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input type="checkbox" checked={!!data.visibleTo?.length} onChange={(e) => change({ visibleTo: e.target.checked ? ['owner', 'developer', 'admin', 'moderator'] : [] })} />
                Hide this draft from Lodge keepers (staff only) until it is published
              </label>
            )}
          </fieldset>
          {issues.length > 0 && (
            <div className="rounded-lg border border-amber-400/25 bg-amber-400/5 px-3 py-2 text-sm text-amber-200">
              <b>Before it can be Ready:</b>
              <ul className="mt-1 list-disc pl-5">
                {issues.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="min-w-0">
          <div className="mb-3 flex gap-1 border-b border-gray-700">
            {(['preview', 'comments', 'history'] as const).map((s) => (
              <button key={s} className={`-mb-px border-b-2 px-3 pb-2 text-sm font-semibold ${side === s ? 'border-green-400 text-white' : 'border-transparent text-gray-400 hover:text-gray-200'}`} onClick={() => setSide(s)}>
                {s === 'preview' ? 'Preview' : s === 'comments' ? `Comments${detail?.comments.length ? ` · ${detail.comments.length}` : ''}` : 'History'}
              </button>
            ))}
          </div>
          {side === 'preview' && <EditorPreview pub={pub} data={data} />}
          {side === 'comments' && <Comments id={id} detail={detail} onPosted={setDetail} />}
          {side === 'history' && <History detail={detail} />}
        </div>
      </div>

      {confirm && (
        <Modal title={confirm === 'publish' ? (scheduledLater ? 'Schedule it?' : 'Publish it now?') : confirm === 'unpublish' ? 'Take it down?' : 'Move it to the trash?'} onClose={() => setConfirm(null)}>
          <p className="mb-4 text-sm text-gray-300">
            {confirm === 'publish'
              ? scheduledLater
                ? `Players will see it from ${formatWhen(Date.parse(data.schedule.from!), zone)} (your time). It is sent now, locked: nobody can read it before.`
                : 'Players will see it within 2 minutes.'
              : confirm === 'unpublish'
                ? 'It disappears from the launchers within 2 minutes. It stays here; you can publish it again.'
                : pub.published
                  ? 'It also disappears from the launchers within 2 minutes. You can restore it from the trash.'
                  : 'You can restore it from the trash.'}
          </p>
          <div className="flex justify-end gap-2">
            <button className="btn btn-ghost" onClick={() => setConfirm(null)}>
              Cancel
            </button>
            <button
              className={`btn ${confirm === 'publish' ? 'btn-primary' : 'btn-danger'}`}
              disabled={busy}
              onClick={async () => {
                const what = confirm
                setConfirm(null)
                await run(what)
                if (what === 'delete') onClose()
              }}
            >
              {confirm === 'publish' ? (scheduledLater ? 'Schedule' : 'Publish') : confirm === 'unpublish' ? 'Take down' : 'Move to trash'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function Actions({ pub, issues, busy, scheduledLater, onStatus, onConfirm, onRestore }: { pub: Publication; issues: string[]; busy: boolean; scheduledLater: boolean; onStatus(s: 'draft' | 'review' | 'ready'): void; onConfirm(c: 'publish' | 'unpublish' | 'delete'): void; onRestore(): void }) {
  const { can } = useStore()
  const write = can(pub.kind === 'news' ? 'news.write' : pub.kind === 'banner' ? 'banner.write' : 'welcome.write')
  if (pub.deletedAt)
    return (
      <div className="mb-4 flex items-center gap-2 rounded-lg bg-gray-800 px-3 py-2 text-sm text-gray-300">
        In the trash since {ago(pub.deletedAt)}.
        {can('publications.restore') && (
          <button className="btn btn-sm btn-primary ml-auto" disabled={busy} onClick={onRestore}>
            Restore (as a draft)
          </button>
        )}
      </div>
    )
  const steps = ['draft', 'review', 'ready'] as const
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg bg-gray-800/70 px-3 py-2">
      <div className="mr-2 flex items-center gap-1 text-xs">
        {steps.map((s, i) => (
          <span key={s} className="flex items-center gap-1">
            {i > 0 && <span className="text-gray-600">→</span>}
            <span className={`rounded-full px-2 py-0.5 font-semibold ${pub.status === s ? SHOWN[s].tone : 'text-gray-500'}`}>{SHOWN[s].label}</span>
          </span>
        ))}
        <span className="text-gray-600">→</span>
        <span className={`rounded-full px-2 py-0.5 font-semibold ${pub.published ? SHOWN.online.tone : 'text-gray-500'}`}>{scheduledLater ? 'Scheduled' : 'Published'}</span>
      </div>
      {pub.status === 'draft' && write && (
        <button className="btn btn-sm" disabled={busy} onClick={() => onStatus('review')}>
          Send to review
        </button>
      )}
      {pub.status === 'review' && write && (
        <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => onStatus('draft')}>
          Back to draft
        </button>
      )}
      {pub.status !== 'ready' && can('publications.approve') && (
        <button className="btn btn-sm" disabled={busy || issues.length > 0} title={issues.join('\n')} onClick={() => onStatus('ready')}>
          ✓ Mark Ready
        </button>
      )}
      {pub.status === 'ready' && (write || can('publications.approve')) && (
        <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => onStatus('draft')}>
          Reopen
        </button>
      )}
      {pub.status === 'ready' && can('publications.publish') && (pendingChanges(pub) || !pub.published) && (
        <button className="btn btn-sm btn-primary" disabled={busy || issues.length > 0} onClick={() => onConfirm('publish')}>
          {pub.published ? 'Publish the changes' : scheduledLater ? 'Schedule' : 'Publish'}
        </button>
      )}
      {!can('publications.publish') && pub.status === 'ready' && !pub.published && <span className="text-xs text-gray-400">Ready: a staff member with the publish permission puts it online.</span>}
      <span className="ml-auto" />
      {pub.published && can('publications.publish') && (
        <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => onConfirm('unpublish')}>
          Take down
        </button>
      )}
      {can('publications.delete') && (
        <button className="btn btn-sm btn-ghost text-red-300" disabled={busy} onClick={() => onConfirm('delete')}>
          Delete
        </button>
      )}
    </div>
  )
}

function Languages({ data, kind, lang, onLang, onChange }: { data: PublicationData; kind: Publication['kind']; lang: string; onLang(l: string): void; onChange(p: Partial<PublicationData>): void }) {
  const out = languagesOut(kind, data)
  const missing = TEXT_LANGUAGES.filter((l) => !data.texts[l.code])
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {Object.keys(data.texts).map((l) => (
        <button key={l} type="button" className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${lang === l ? 'bg-green-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`} onClick={() => onLang(l)}>
          {l.toUpperCase()} <span className="ml-1 text-xs opacity-80">{l === 'en' ? 'required' : out.includes(l) ? '✓ done' : 'to do'}</span>
        </button>
      ))}
      {missing.length > 0 && (
        <select
          className="field w-auto! py-1.5"
          value=""
          onChange={(e) => {
            const l = e.target.value
            if (!l) return
            onChange({ texts: { ...data.texts, [l]: {} }, done: { ...data.done, [l]: false } })
            onLang(l)
          }}
        >
          <option value="">+ Add a language</option>
          {missing.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
            </option>
          ))}
        </select>
      )}
      {lang !== 'en' && (
        <span className="ml-auto flex items-center gap-3 text-sm">
          <label className="flex items-center gap-1.5 text-gray-300">
            <input type="checkbox" checked={!!data.done[lang]} onChange={(e) => onChange({ done: { ...data.done, [lang]: e.target.checked } })} /> {languageName(lang)} translation done
          </label>
          <button
            type="button"
            className="text-xs text-red-300 hover:underline"
            onClick={() => {
              const texts = { ...data.texts }
              const done = { ...data.done }
              delete texts[lang]
              delete done[lang]
              onChange({ texts, done })
              onLang('en')
            }}
          >
            Remove {languageName(lang)}
          </button>
        </span>
      )}
    </div>
  )
}

const FIELD_LABEL: Record<string, string> = { title: 'Title', body: 'Text', linkLabel: 'Button text (when there is a link)', text: 'Text' }

function Texts({ kind, data, lang, onText }: { kind: Publication['kind']; data: PublicationData; lang: string; onText(field: string, value: string): void }) {
  const en = data.texts.en ?? {}
  return (
    <>
      {FIELDS[kind].map((f) => {
        if (f === 'linkLabel' && !data.linkUrl) return null
        if (f === 'accent' && !en.title?.trim()) return null
        const value = data.texts[lang]?.[f] ?? ''
        const long = f === 'body'
        const max = LIMITS[f]
        return (
          <div key={f}>
            <label className="label">
              {kind === 'welcome' && f === 'title' ? 'Title (replaces the whole “Welcome back …” heading; optional)' : kind === 'welcome' && f === 'accent' ? 'Green line under the title (optional; {player} = the player’s name, {server} = Hemisphere SMP)' : FIELD_LABEL[f]} <span className={`font-normal ${value.length > max ? 'text-red-400' : 'text-gray-500'}`}>{value.length}/{max}</span>
            </label>
            {long ? (
              <textarea className="field min-h-[180px] resize-y" value={value} placeholder={lang === 'en' ? 'Blank lines separate paragraphs.' : en[f]} onChange={(e) => onText(f, e.target.value)} />
            ) : (
              <input className="field" value={value} placeholder={lang === 'en' ? '' : en[f]} onChange={(e) => onText(f, e.target.value)} />
            )}
          </div>
        )
      })}
    </>
  )
}

function NewsOptions({ data, onChange }: { data: PublicationData; onChange(p: Partial<PublicationData>): void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const url = usePicture(data.image?.id)
  const input = useRef<HTMLInputElement>(null)
  const pick = async (file: File) => {
    setError(null)
    setBusy('Preparing the picture…')
    try {
      const prepared = await prepareWebp(file)
      setBusy(`Sending ${formatBytes(prepared.bytes.length)}…`)
      const res = await window.herald.images.upload(prepared.bytes, prepared.width, prepared.height)
      if (!res.ok) throw new Error(res.error)
      onChange({ image: res.data })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Category</label>
          <select className="field" value={data.category} onChange={(e) => onChange({ category: e.target.value as PublicationData['category'] })}>
            {Object.entries(NEWS_CATEGORIES_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Big card at the top of News</label>
          <select className="field" value={data.featuredDays ?? 0} onChange={(e) => onChange({ featuredDays: Number(e.target.value) })}>
            <option value={0}>No (unless it is the newest)</option>
            {[1, 2, 3, 5, 7, 14].map((d) => (
              <option key={d} value={d}>
                For {d} day{d > 1 ? 's' : ''}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="label">Picture</label>
        <div className="flex items-center gap-3">
          {url ? <img src={url} alt="" className="h-16 w-28 rounded-md object-cover" /> : <div className="grid h-16 w-28 place-items-center rounded-md bg-gray-800 text-xs text-gray-500">{data.image ? '…' : 'Built-in screenshot'}</div>}
          <div className="text-xs text-gray-400">
            {data.image ? `${data.image.width} × ${data.image.height} · ${formatBytes(data.image.size)} (WebP)` : 'Without a picture, the launcher shows one of its screenshots.'}
            {busy && <div className="text-green-300">{busy}</div>}
            {error && <div className="text-red-300">{error}</div>}
          </div>
          <div className="ml-auto flex gap-2">
            <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && void pick(e.target.files[0]).finally(() => (e.target.value = ''))} />
            <button type="button" className="btn btn-sm" disabled={!!busy} onClick={() => input.current?.click()}>
              {data.image ? 'Change' : 'Add a picture'}
            </button>
            {data.image && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => onChange({ image: null })}>
                Remove
              </button>
            )}
          </div>
        </div>
        <p className="mt-1 text-xs text-gray-500">Made smaller and converted to WebP here (at most 1.5 MB). The launcher crops it to each card: check the preview.</p>
      </div>
      <div>
        <label className="label">Link (a button under the text, opens the player's browser)</label>
        <input className="field" placeholder="https://…" value={data.linkUrl ?? ''} onChange={(e) => onChange({ linkUrl: e.target.value.trim() ? e.target.value.trim() : null })} />
      </div>
    </>
  )
}

/** "When": as soon as published, or at a time in a zone; until when */
function When({ data, onChange, defaultZone }: { data: PublicationData; onChange(p: Partial<PublicationData>): void; defaultZone: string }) {
  const { settings } = useStore()
  const s = data.schedule
  const z = s.zone || defaultZone
  const set = (patch: Partial<PublicationData['schedule']>) => onChange({ schedule: { ...s, ...patch } })
  const field = (key: 'from' | 'until') => {
    const value = s[key]
    const at = value ? Date.parse(value) : null
    return (
      <div>
        <div className="flex items-center gap-3 text-sm">
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={!value} onChange={() => set({ [key]: null })} /> {key === 'from' ? 'As soon as it is published' : 'Stays until taken down'}
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={!!value} onChange={() => set({ [key]: new Date(Math.ceil((Date.now() + (key === 'from' ? DAY : 8 * DAY)) / 3_600_000) * 3_600_000).toISOString() })} /> {key === 'from' ? 'At' : 'Until'}
          </label>
          {value && (
            <input
              type="datetime-local"
              className="field w-auto! py-1.5"
              value={toWallInput(at!, z)}
              onChange={(e) => {
                const t = fromWallInput(e.target.value, z)
                if (t !== null) set({ [key]: new Date(t).toISOString() })
              }}
            />
          )}
        </div>
        {at !== null && (
          <p className="mt-1 text-xs text-gray-400">
            {[...new Set([z, ...settings.extraZones])].map((x) => `${formatWhen(at, x)} ${zoneLabel(x)}`).join(' · ')}
          </p>
        )}
      </div>
    )
  }
  return (
    <div className="card flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="eyebrow">When</span>
        <div className="w-64">
          <ZonePicker value={z} onPick={(zone) => set({ zone })} />
        </div>
      </div>
      {field('from')}
      {field('until')}
      <p className="text-xs text-gray-500">Times are in {zoneLabel(z)}. Each player sees them in their own time. Scheduled = sent now, locked until then.</p>
    </div>
  )
}

/** The launcher at the key moments of this publication */
function EditorPreview({ pub, data }: { pub: Publication; data: PublicationData }) {
  const { state } = usePubs()
  const { zone } = useStore()
  const now = Date.now()
  const from = data.schedule.from ? Date.parse(data.schedule.from) : (pub.publishedAt ?? now)
  const moments = useMemo(() => {
    const out: { label: string; at: number; hint: string }[] = [{ label: 'Right now', at: now, hint: from > now ? 'What players see today: it is not shown yet.' : 'What players see today.' }]
    if (from > now + 60_000) out.push({ label: 'When it appears', at: from + 1000, hint: 'The first second it is shown.' })
    if (pub.kind === 'news' && (data.featuredDays ?? 0) > 0) out.push({ label: 'After the big-card days', at: from + (data.featuredDays ?? 0) * DAY + 60_000, hint: 'It becomes a small card, unless it is still the newest news (the newest one is always the big card).' })
    if (data.schedule.until) out.push({ label: 'After it ends', at: Date.parse(data.schedule.until) + 60_000, hint: 'It is gone.' })
    return out
  }, [from, data.featuredDays, data.schedule.until, pub.kind])
  const [moment, setMoment] = useState(() => Math.max(0, moments.findIndex((m) => m.label === 'When it appears')))
  const langs = languagesOut(pub.kind, data)
  const [lang, setLang] = useState('en')
  const [screen, setScreen] = useState<PreviewScreen>(pub.kind === 'news' ? 'news' : 'home')
  const [article, setArticle] = useState<string | null>(null)
  const [size, setSize] = useState<WindowSize>('normal')
  const ids = useMemo(() => (state ? pictureIds(state, data) : {}), [state, data])
  const urls = usePictures(Object.values(ids))
  if (!state) return null
  const at = moments[Math.min(moment, moments.length - 1)].at
  const opts = { override: { id: pub.id, kind: pub.kind, data: withPlaceholders(pub.kind, data), publishedAt: pub.publishedAt ?? Math.min(now, from) } }
  const view = viewAt(state, at, lang, opts, urls, ids)
  const mine = withPlaceholders(pub.kind, data).texts.en
  const visible = pub.kind === 'news' ? view.news.some((n) => n.id === pub.id) : pub.kind === 'banner' ? view.banner?.text.en === mine.text : view.welcome?.text.en === mine.text
  // Only one banner and one welcome message at a time: another one may win (more important, or newer)
  const hiddenBy = !visible && from <= at && (!data.schedule.until || at < Date.parse(data.schedule.until)) ? (pub.kind === 'banner' ? view.banner?.text.en : pub.kind === 'welcome' ? view.welcome?.text.en : undefined) : undefined
  const current = moments[Math.min(moment, moments.length - 1)]
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {moments.map((m, i) => (
          <button key={m.label} className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${i === moment ? 'bg-green-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`} onClick={() => setMoment(i)}>
            {m.label}
          </button>
        ))}
        <select className="field ml-auto w-auto! py-1 text-xs" value={lang} onChange={(e) => setLang(e.target.value)}>
          {[...new Set(['en', ...langs, ...Object.keys(data.texts)])].map((l) => (
            <option key={l} value={l}>
              Player in {languageName(l)}
              {l !== 'en' && !langs.includes(l) ? ' (not done: sees English)' : ''}
            </option>
          ))}
        </select>
        <select className="field w-auto! py-1 text-xs" value={size} onChange={(e) => setSize(e.target.value as WindowSize)}>
          {Object.entries(WINDOW_SIZES).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
      </div>
      <p className="mb-2 text-xs text-gray-400">
        {formatWhen(at, zone)} your time · {current.hint} {visible ? '' : '(not shown at this moment)'}
      </p>
      {hiddenBy && (
        <p className="mb-2 rounded-md border border-amber-400/30 bg-amber-400/10 px-2.5 py-1.5 text-xs text-amber-200">
          Players see another {pub.kind === 'banner' ? 'banner' : 'welcome message'} instead: “{hiddenBy}”. {pub.kind === 'banner' ? 'Only one banner shows at a time: the most important, then the newest.' : 'Only one shows at a time: the newest.'} Take the other one down (or change its importance) to show this one.
        </p>
      )}
      <LauncherPreview view={view} at={at} lang={lang} screen={screen} onScreen={setScreen} article={article} onArticle={setArticle} size={size} badge={badgeAt(state, at, lang, opts, Math.min(at, from) - 1000)} />
      {pub.kind === 'news' && (
        <div className="mt-2 flex gap-1.5">
          <button className="btn btn-sm btn-ghost" onClick={() => (setScreen('news'), setArticle(null))}>
            News page
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => (setScreen('news'), setArticle(pub.id))} disabled={!visible}>
            Reading page
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => setScreen('home')}>
            Home
          </button>
        </div>
      )}
    </div>
  )
}

function Comments({ id, detail, onPosted }: { id: string; detail: PublicationDetail | null; onPosted(d: PublicationDetail): void }) {
  const { act } = usePubs()
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const send = async () => {
    const res = await act<PublicationDetail>('POST', `/publications/${id}/comments`, { text })
    if (!res.ok) return setError(res.error)
    setText('')
    setError(null)
    onPosted(res.data)
  }
  return (
    <div className="flex flex-col gap-3">
      {(detail?.comments ?? []).map((c) => (
        <div key={c.id} className="flex gap-2.5">
          <Avatar name={c.who ?? '?'} size={26} />
          <div className="min-w-0 flex-1 rounded-lg bg-gray-800 px-3 py-2">
            <div className="text-xs text-gray-400">
              <b className="text-gray-200">{c.who}</b> · {ago(c.at)}
            </div>
            <p className="text-sm whitespace-pre-line text-gray-200 select-text">{c.text}</p>
          </div>
        </div>
      ))}
      {!detail?.comments.length && <p className="text-sm text-gray-400">No comments yet.</p>}
      <textarea className="field min-h-[70px]" placeholder="A remark, a question, a translation note…" value={text} onChange={(e) => setText(e.target.value)} />
      {error && <p className="text-sm text-red-300">{error}</p>}
      <button className="btn btn-primary self-end" disabled={!text.trim()} onClick={() => void send()}>
        Comment
      </button>
    </div>
  )
}

const ACTION: Record<string, string> = { create: 'created', save: 'edited', status: 'changed the status to', publish: 'published', unpublish: 'took it down', delete: 'moved it to the trash', restore: 'restored it' }

function History({ detail }: { detail: PublicationDetail | null }) {
  // One line per editing session: consecutive saves by the same person are grouped
  const rows = (detail?.versions ?? []).filter((v, i, all) => !(v.action === 'save' && all[i + 1]?.action === 'save' && all[i + 1]?.who === v.who))
  return (
    <div className="flex flex-col">
      {rows.map((v) => (
        <div key={v.version} className="flex items-center gap-2.5 border-t border-gray-700/50 py-2 text-sm first:border-0">
          <Avatar name={v.who ?? '?'} size={22} />
          <span>
            <b className="text-white">{v.who ?? 'Someone'}</b> {ACTION[v.action] ?? v.action}
            {v.action === 'status' ? ` ${SHOWN[v.status].label}` : ''}
          </span>
          <span className="ml-auto text-xs text-gray-400">
            v{v.version} · {ago(v.at)}
          </span>
        </div>
      ))}
      <p className="mt-2 text-xs text-gray-500">Every version is kept for good, deleted publications included.</p>
    </div>
  )
}
