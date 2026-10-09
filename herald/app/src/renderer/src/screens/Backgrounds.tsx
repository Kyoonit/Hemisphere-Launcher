/**
 * Pictures behind the launcher's Home, by period: "All year" (with the built-in pictures) and dated periods (Halloween,
 * Christmas…) that show only their pictures or add them to the others. Changes are prepared here, then published at
 * once for everyone (like the Server tab); the preview shows the real Home with the picture chosen.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ImageRef } from '@herald/api'
import { ALL_YEAR, backgroundProblems, periodWindow, type BackgroundPeriod, type Backgrounds as BackgroundsData } from '@shared/heraldBackgrounds'
import { BUILT_IN_BACKGROUNDS } from '@launcher/components/feed/homePictures'
import en from '@locales/en.json'
import { usePubs } from '../pubs'
import { useStore } from '../store'
import { ZonePicker } from '../components/ui'
import { formatBytes, PICTURE_SIZES, prepareWebp, usePicture, usePictures } from '../pictures'
import { formatDay, toWallInput, zoneLabel } from '../time'
import { LauncherPreview } from '../preview/LauncherPreview'
import { pictureIds, viewAt } from '../preview/view'

const DAY = 86_400_000
const newId = () => `p-${[...crypto.getRandomValues(new Uint8Array(10))].map((b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('')}`
const builtInName = (key: string) => (en.backgrounds as Record<string, string>)[key.split('.')[1]] ?? key

export default function Backgrounds() {
  const { state, act } = usePubs()
  const { zone, can } = useStore()
  const [draft, setDraft] = useState<BackgroundsData | null>(state?.backgrounds ?? null)
  const [baseVersion, setBaseVersion] = useState(state?.backgroundsVersion ?? 0)
  const [selected, setSelected] = useState<string>(ALL_YEAR)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const dirty = !!state && !!draft && JSON.stringify(draft) !== JSON.stringify(state.backgrounds)

  // Someone else published meanwhile: take it, unless there are changes here
  useEffect(() => {
    if (!state || state.backgroundsVersion === baseVersion) return
    if (!dirty) setDraft(state.backgrounds)
    setBaseVersion(state.backgroundsVersion)
  }, [state, baseVersion, dirty])
  if (!state || !draft) return <div className="text-gray-400">Loading…</div>

  const now = state.now
  const periods = [...draft.periods].sort((a, b) => (a.id === ALL_YEAR ? -1 : b.id === ALL_YEAR ? 1 : (a.from ?? '').localeCompare(b.from ?? '')))
  const period = draft.periods.find((p) => p.id === selected) ?? draft.periods.find((p) => p.id === ALL_YEAR)!
  const setPeriod = (patch: Partial<BackgroundPeriod>) => setDraft({ periods: draft.periods.map((p) => (p.id === period.id ? { ...p, ...patch } : p)) })
  const problems = backgroundProblems(draft, now)
  const stale = state.backgroundsVersion !== baseVersion

  const publish = async () => {
    setBusy(true)
    setError(null)
    const res = await act<{ backgrounds: BackgroundsData; backgroundsVersion: number }>('POST', '/backgrounds', { version: state.backgroundsVersion, backgrounds: draft })
    setBusy(false)
    if (!res.ok) return setError(res.error)
    setDraft(res.data.backgrounds)
    setBaseVersion(res.data.backgroundsVersion)
  }
  const addPeriod = () => {
    const today = toWallInput(now, zone).slice(0, 10)
    const at = (days: number) => new Date(Date.parse(`${today}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10)
    const p: BackgroundPeriod = { id: newId(), name: 'New period', from: at(7), until: at(14), zone, mode: 'replace', pictures: [] }
    setDraft({ periods: [...draft.periods, p] })
    setSelected(p.id)
  }

  return (
    <div className="animate-fade">
      <div className="mb-4 flex items-center gap-3">
        <div>
          <div className="eyebrow">Pictures behind the launcher's Home</div>
          <h1 className="text-[26px] font-extrabold text-white">Backgrounds</h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {dirty && <span className="text-sm text-amber-300">Changes not published yet</span>}
          {dirty && (
            <button className="btn btn-ghost" disabled={busy} onClick={() => (setDraft(state.backgrounds), setError(null))}>
              Undo the changes
            </button>
          )}
          <button className="btn btn-primary" disabled={!dirty || busy || problems.length > 0 || !can('backgrounds.write')} title={problems.join('\n')} onClick={() => void publish()}>
            Publish the changes
          </button>
        </div>
      </div>
      {stale && dirty && <p className="mb-3 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-200">Someone published other background changes meanwhile: undo yours and redo them on the new version.</p>}
      {error && <p className="mb-3 rounded-lg border border-red-400/30 bg-red-600/10 px-3 py-2 text-sm text-red-300">{error}</p>}
      {problems.length > 0 && <p className="mb-3 rounded-lg border border-amber-400/25 bg-amber-400/5 px-3 py-2 text-sm text-amber-200">{problems.join(' ')}</p>}

      <div className="grid grid-cols-[260px_minmax(0,1fr)] gap-5">
        <div>
          <div className="card flex flex-col gap-1 p-1.5!">
            {periods.map((p) => {
              const w = periodWindow(p)
              const live = (w.from ?? -Infinity) <= now && now < (w.until ?? Infinity)
              return (
                <button key={p.id} className={`rounded-lg px-3 py-2.5 text-left ${p.id === period.id ? 'bg-gray-700' : 'hover:bg-gray-700/50'}`} onClick={() => setSelected(p.id)}>
                  <div className="flex items-center gap-2 font-semibold text-white">
                    {p.name}
                    {live && p.id !== ALL_YEAR && <span className="text-[11px] font-semibold text-green-400">● now</span>}
                  </div>
                  <div className="text-xs text-gray-400">
                    {p.id === ALL_YEAR ? `${p.pictures.length} + ${BUILT_IN_BACKGROUNDS.length} built in` : `${p.from ? formatDay(w.from!, p.zone) : '?'} → ${p.until ? formatDay(w.until! - 1, p.zone) : '?'} · ${p.pictures.length} picture${p.pictures.length === 1 ? '' : 's'}`}
                    {p.id !== ALL_YEAR && (p.mode === 'replace' ? ' · only these' : ' · added')}
                  </div>
                </button>
              )
            })}
          </div>
          <button className="btn btn-ghost mt-2.5 w-full justify-center" onClick={addPeriod}>
            + New period
          </button>
        </div>

        <PeriodEditor key={period.id} period={period} onChange={setPeriod} onDelete={() => (setDraft({ periods: draft.periods.filter((p) => p.id !== period.id) }), setSelected(ALL_YEAR))} draft={draft} />
      </div>
    </div>
  )
}

function PeriodEditor({ period, onChange, onDelete, draft }: { period: BackgroundPeriod; onChange(p: Partial<BackgroundPeriod>): void; onDelete(): void; draft: BackgroundsData }) {
  const { state } = usePubs()
  const [chosen, setChosen] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const allYear = period.id === ALL_YEAR
  const ids = useMemo(() => (state ? pictureIds(state, undefined, draft) : {}), [state, draft])
  const urls = usePictures(Object.values(ids))
  if (!state) return null

  const add = async (files: File[]) => {
    setError(null)
    const added: { image: ImageRef; caption: string }[] = []
    for (const [i, file] of files.entries()) {
      try {
        setBusy(`Preparing ${i + 1}/${files.length}…`)
        const prepared = await prepareWebp(file, PICTURE_SIZES.background)
        setBusy(`Sending ${i + 1}/${files.length} (${formatBytes(prepared.bytes.length)})…`)
        const res = await window.herald.images.upload(prepared.bytes, prepared.width, prepared.height)
        if (!res.ok) throw new Error(res.error)
        added.push({ image: res.data, caption: file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').slice(0, 60) || period.name })
      } catch (err) {
        setError(`${file.name}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    setBusy(null)
    if (added.length) onChange({ pictures: [...period.pictures, ...added].slice(0, 12) })
  }

  // The preview: inside the period (its first day at noon, or now when it is on), with the picture chosen
  const w = periodWindow(period)
  const at = w.from !== null && w.from > state.now ? w.from + 12 * 3_600_000 : state.now
  const view = viewAt(state, at, 'en', { backgrounds: draft }, urls, ids)
  const builtIns = allYear ? BUILT_IN_BACKGROUNDS : []
  const preview = chosen ?? (period.pictures[0] ? urls[period.pictures[0].image.id] : undefined) ?? builtIns[0]?.src

  return (
    <div className="min-w-0">
      <div className="card mb-4 flex flex-col gap-3">
        <div className="flex items-center gap-3">
          {allYear ? <h2 className="text-lg font-bold text-white">All year</h2> : <input className="field max-w-xs py-1.5 text-lg font-bold" value={period.name} maxLength={40} onChange={(e) => onChange({ name: e.target.value })} />}
          {allYear && <span className="rounded-full bg-green-600/20 px-2.5 py-0.5 text-xs font-semibold text-green-300">Default</span>}
          {!allYear && (
            <button className="btn btn-sm btn-ghost ml-auto text-red-300" onClick={onDelete}>
              Delete this period
            </button>
          )}
        </div>
        {allYear ? (
          <p className="text-sm text-gray-400">Shown all year, with the launcher's built-in pictures. Players without internet, or before a picture is downloaded, see the built-in ones.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="label">First day</label>
                <input type="date" className="field w-auto! py-1.5" value={period.from ?? ''} onChange={(e) => onChange({ from: e.target.value || null })} />
              </div>
              <div>
                <label className="label">Last day</label>
                <input type="date" className="field w-auto! py-1.5" value={period.until ?? ''} onChange={(e) => onChange({ until: e.target.value || null })} />
              </div>
              <div className="w-64">
                <label className="label">From midnight to midnight in</label>
                <ZonePicker value={period.zone} onPick={(z) => onChange({ zone: z })} />
              </div>
            </div>
            <div>
              <label className="label">During this period</label>
              <span className="flex w-fit rounded-lg bg-gray-800 p-0.5">
                {(['replace', 'add'] as const).map((m) => (
                  <button key={m} className={`rounded-md px-3 py-1.5 text-[13px] font-semibold ${period.mode === m ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-gray-200'}`} onClick={() => onChange({ mode: m })}>
                    {m === 'replace' ? 'Only these pictures' : 'Add them to the all-year ones'}
                  </button>
                ))}
              </span>
            </div>
            <p className="text-xs text-gray-500">
              Players see them from the first day 00:00 to the last day 24:00, {zoneLabel(period.zone)} time. Sent in advance, locked until then (nobody sees them early).
            </p>
          </>
        )}
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3">
        {builtIns.map((b) => (
          <Thumb key={b.src} src={b.src} on={preview === b.src} onPick={() => setChosen(b.src)}>
            <span className="truncate text-sm text-gray-300">{builtInName(b.name)}</span>
            <span className="ml-auto shrink-0 text-[11px] text-gray-500">Built in</span>
          </Thumb>
        ))}
        {period.pictures.map((pic, i) => (
          <PictureThumb key={pic.image.id + i} id={pic.image.id} on={preview === urls[pic.image.id]} onPick={(src) => setChosen(src)}>
            <input className="field min-w-0 flex-1 py-1 text-sm" value={pic.caption} maxLength={60} placeholder="Place shown on Home" onChange={(e) => onChange({ pictures: period.pictures.map((x, j) => (j === i ? { ...x, caption: e.target.value } : x)) })} />
            <button className="btn btn-sm btn-ghost shrink-0 text-red-300" title="Remove this picture" onClick={() => onChange({ pictures: period.pictures.filter((_, j) => j !== i) })}>
              ✕
            </button>
          </PictureThumb>
        ))}
        {period.pictures.length < 12 && (
          <button className="grid aspect-video place-items-center rounded-lg border-2 border-dashed border-gray-600 text-center text-sm text-gray-400 hover:border-green-500 hover:text-green-300" disabled={!!busy} onClick={() => input.current?.click()}>
            <span>
              {busy ?? '+ Add pictures'}
              <span className="block text-xs text-gray-500">Resized and converted to WebP here (≤ 1.5 MB each)</span>
            </span>
          </button>
        )}
        <input ref={input} type="file" accept="image/*" multiple className="hidden" onChange={(e) => e.target.files?.length && void add([...e.target.files]).finally(() => (e.target.value = ''))} />
      </div>
      {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
      {period.pictures.some((p) => !p.caption.trim()) && <p className="mt-2 text-sm text-amber-300">Every picture needs the place it shows (written on Home).</p>}

      <div className="card mt-4">
        <div className="eyebrow mb-2">Preview on the real Home · {formatDay(at, period.zone)}</div>
        <LauncherPreview view={view} at={at} lang="en" screen="home" onScreen={() => {}} article={null} onArticle={() => {}} size="normal" badge={0} background={preview} />
        <p className="mt-2 text-xs text-gray-400">Click a picture above to see it behind Home: the text must stay readable on it.</p>
      </div>
    </div>
  )
}

function PictureThumb({ id, on, onPick, children }: { id: string; on: boolean; onPick(src: string): void; children: React.ReactNode }) {
  const src = usePicture(id)
  return (
    <Thumb src={src} on={on} onPick={() => src && onPick(src)}>
      {children}
    </Thumb>
  )
}

function Thumb({ src, on, onPick, children }: { src: string | null; on: boolean; onPick(): void; children: React.ReactNode }) {
  return (
    <div className={`overflow-hidden rounded-lg bg-gray-800 ring-2 ${on ? 'ring-green-500' : 'ring-transparent'}`}>
      <button className="block aspect-video w-full bg-gray-900 bg-cover bg-center" style={src ? { backgroundImage: `url("${src}")` } : undefined} onClick={onPick} aria-label="Show it in the preview" />
      <div className="flex items-center gap-1.5 p-2">{children}</div>
    </div>
  )
}
