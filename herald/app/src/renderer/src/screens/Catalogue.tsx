/**
 * Catalogue (launcher 1.4, Patreon try-on): the owner's models and skins. Each item has a sheet (name, Patreon link,
 * tier…), its files with every version, and a studio to try it on any player, on a background, and make a picture of it
 * for Discord. An item stays on Herald only until it is shown in the launchers (Patreon link needed).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ApiResult, BlockedPlayer, TraceResult } from '@herald/api'
import { CATALOGUE_SLOTS, EMPTY_SHEET, sheetProblems, toModelFiles, type CatalogueItem, type CatalogueKind, type CatalogueSheet, type CatalogueStatus } from '@shared/heraldCatalogue'
import { announceDirect } from '../directChanges'
import { readModel, type ModelData } from '@shared/models'
import { withAlpha } from '@launcher/components/skin/modelMesh'
import { useStore } from '../store'
import { Modal } from '../components/ui'
import { usePicture } from '../pictures'
import { Studio, type StudioCapture } from './CatalogueStudio'

export const STATUS_LABEL: Record<CatalogueStatus, string> = { draft: 'On Herald only', published: 'In the launchers', hidden: 'Hidden from the launchers' }
const STATUS_STYLE: Record<CatalogueStatus, string> = { draft: 'bg-gray-700 text-gray-200', published: 'bg-green-600/20 text-green-400', hidden: 'bg-amber-600/20 text-amber-400' }
export const SLOT_LABEL = { head: 'On the head', righthand: 'Right hand', lefthand: 'Left hand' }
const fromB64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))

/** What the studio shows: the model read from the item's files, or the skin */
export type Loaded = { kind: 'model'; model: ModelData } | { kind: 'skin'; skin: string }

export default function Catalogue() {
  const { can, sync } = useStore()
  const [items, setItems] = useState<CatalogueItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [filter, setFilter] = useState<CatalogueStatus | 'all'>('all')
  const [adding, setAdding] = useState(false)
  const [tracing, setTracing] = useState(false)

  const load = async () => {
    const res = await window.herald.api<{ items: CatalogueItem[] }>('GET', '/catalogue')
    if (res.ok) (setItems(res.data.items), setError(null))
    else setError(res.error)
  }
  // reloaded when someone changes the catalogue (the shared content stamp)
  useEffect(() => void load(), [sync?.contentStamp])
  const replace = (item: CatalogueItem) => setItems((list) => (list ? [item, ...list.filter((i) => i.id !== item.id)] : [item]))

  if (error) return <p className="text-sm text-red-400">{error}</p>
  if (!items) return <p className="text-sm text-gray-400">Loading the catalogue…</p>
  const item = items.find((i) => i.id === open)
  if (item) return <ItemPage item={item} onBack={() => setOpen(null)} onChanged={replace} onDeleted={() => (setOpen(null), void load())} />

  const shown = items.filter((i) => filter === 'all' || i.status === filter)
  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="eyebrow">Patreon try-on</div>
          <h1 className="mt-1 text-2xl font-bold text-white">Catalogue</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-400">Models and skins from the Patreon. Keep them here to try them on and make pictures for Discord; show them in the launchers when they are on Patreon, with their link.</p>
        </div>
        <div className="flex gap-2">
          {can('catalogue.publish') && (
            <button className="btn" onClick={() => setTracing(true)} title="Every player gets the textures with an invisible mark of their own">
              Trace a leaked texture
            </button>
          )}
          {can('catalogue.write') && (
            <button className="btn btn-primary" onClick={() => setAdding(true)}>
              + New item
            </button>
          )}
        </div>
      </div>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {(['all', 'draft', 'published', 'hidden'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`btn btn-sm ${filter === f ? 'btn-primary' : ''}`}>
            {f === 'all' ? `Everything (${items.length})` : `${STATUS_LABEL[f]} (${items.filter((i) => i.status === f).length})`}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="card text-sm text-gray-400">{items.length ? 'Nothing here.' : 'The catalogue is empty: add the first model or skin.'}</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">
          {shown.map((i) => (
            <ItemCard key={i.id} item={i} onOpen={() => setOpen(i.id)} />
          ))}
        </div>
      )}
      {tracing && <Trace onClose={() => setTracing(false)} />}
      {adding && <NewItem onClose={() => setAdding(false)} onCreated={(i) => (replace(i), setAdding(false), setOpen(i.id))} />}
    </div>
  )
}

function ItemCard({ item, onOpen }: { item: CatalogueItem; onOpen(): void }) {
  const thumb = usePicture(item.thumbnail)
  return (
    <button onClick={onOpen} className="card flex flex-col gap-2 p-3 text-left transition-colors hover:border-green-600/50">
      <div className="grid aspect-square place-items-center overflow-hidden rounded-md bg-gray-900">
        {thumb ? <img src={thumb} alt="" className="h-full w-full object-cover" /> : <span className="text-xs text-gray-500">{item.version ? 'No picture yet' : 'No files yet'}</span>}
      </div>
      <div className="min-w-0">
        <b className="block truncate text-sm text-white">{item.name}</b>
        <span className="text-xs text-gray-400">
          {item.kind === 'skin' ? 'Skin' : SLOT_LABEL[item.slot]}
          {item.tier && ` · ${item.tier}`}
        </span>
      </div>
      <span className={`w-fit rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[item.status]}`}>{STATUS_LABEL[item.status]}</span>
    </button>
  )
}

/** A texture found elsewhere: who it was given to, from the mark hidden in it */
function Trace({ onClose }: { onClose(): void }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ApiResult<TraceResult> | null>(null)
  const [blocked, setBlocked] = useState<BlockedPlayer[]>([])
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    void window.herald.api<{ players: BlockedPlayer[] }>('GET', '/catalogue/blocked').then((r) => r.ok && setBlocked(r.data.players))
  }, [])
  const setBlock = async (id: string, block: boolean) => {
    const r = await window.herald.api<{ players: BlockedPlayer[] }>('POST', `/catalogue/players/${id}/block`, { blocked: block })
    if (!r.ok) return setError(r.error)
    setError(null)
    setBlocked(r.data.players)
    setResult((x) => (x?.ok && x.data.found && 'player' in x.data && x.data.player.id === id ? { ...x, data: { ...x.data, player: { ...x.data.player, blockedAt: block ? Date.now() : null } } } : x))
  }
  const pick = async () => {
    setBusy(true)
    const r = await window.herald.catalogue.trace()
    setBusy(false)
    if (r) setResult(r)
  }
  const day = (t: number) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  return (
    <Modal title="Trace a leaked texture" onClose={onClose}>
      <p className="mb-3 text-sm text-gray-300">
        Every player receives the catalogue’s textures with an invisible mark of their own, and so does every staff member who downloads the original files. Pick a
        texture found elsewhere (the PNG as found: a resized picture or a JPEG loses the mark) to see who it was given to.
      </p>
      {result && !result.ok && <p className="mb-3 text-sm text-red-400">{result.error}</p>}
      {result?.ok && !result.data.found && <p className="mb-3 rounded-md bg-gray-800 p-3 text-sm text-gray-300">No mark found: not a texture from the catalogue, or it was changed too much.</p>}
      {result?.ok && result.data.found && 'staff' in result.data && (
        <div className="mb-3 rounded-md border border-amber-600/40 bg-amber-600/10 p-3 text-sm">
          <p className="text-white">
            From the original files downloaded by <b>{result.data.staff.name}</b> {result.data.staff.role && <span className="text-xs text-gray-400">({result.data.staff.role})</span>}
          </p>
          <p className="mt-0.5 text-xs text-gray-400">
            First download {day(result.data.staff.firstAt)}, last {day(result.data.staff.lastAt)}. A staff member is not blocked here: their profile is managed in Team.
          </p>
          {result.data.downloads.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-gray-300">
              {result.data.downloads.map((d) => (
                <li key={`${d.itemId}-${d.version}-${d.at}`}>
                  {d.name} (version {d.version}) · {day(d.at)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {result?.ok && result.data.found && 'player' in result.data && (
        <div className="mb-3 rounded-md border border-amber-600/40 bg-amber-600/10 p-3 text-sm">
          <p className="text-white">
            Given to <b>{result.data.player.name}</b> <span className="text-xs text-gray-400">({result.data.player.id})</span>
          </p>
          <p className="mt-0.5 text-xs text-gray-400">
            First seen {day(result.data.player.firstAt)}, last {day(result.data.player.lastAt)}
          </p>
          {result.data.player.blockedAt ? (
            <p className="mt-2 text-xs font-semibold text-red-400">Blocked from the catalogue since {day(result.data.player.blockedAt)}</p>
          ) : (
            <button className="btn btn-sm mt-2 border-red-600/50 text-red-300" onClick={() => result.data.found && 'player' in result.data && void setBlock(result.data.player.id, true)}>
              Block from the catalogue
            </button>
          )}
          {result.data.received.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-gray-300">
              {result.data.received.map((r) => (
                <li key={`${r.itemId}-${r.version}`}>
                  {r.name} (version {r.version}) · {day(r.firstAt)}
                  {r.count > 1 && ` · ${r.count} times`}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
      {blocked.length > 0 && (
        <div className="mb-3">
          <label className="label">Blocked players</label>
          <p className="mb-1.5 text-xs text-gray-400">They get nothing more from the catalogue; what their launcher kept stops opening within 30 days.</p>
          <ul className="space-y-1">
            {blocked.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 rounded-md bg-gray-800 px-2.5 py-1.5 text-sm">
                <span>
                  <b className="text-white">{p.name}</b> <span className="text-xs text-gray-400">since {day(p.blockedAt)}</span>
                </span>
                <button className="btn btn-sm btn-ghost" onClick={() => void setBlock(p.id, false)}>
                  Unblock
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button className="btn btn-ghost" onClick={onClose}>
          Close
        </button>
        <button className="btn btn-primary" disabled={busy} onClick={() => void pick()}>
          {busy ? 'Reading…' : result ? 'Another picture…' : 'Pick the picture…'}
        </button>
      </div>
    </Modal>
  )
}

function NewItem({ onClose, onCreated }: { onClose(): void; onCreated(i: CatalogueItem): void }) {
  const [kind, setKind] = useState<CatalogueKind>('model')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const create = async () => {
    const res = await window.herald.api<CatalogueItem>('POST', '/catalogue', { sheet: { kind, name } })
    if (res.ok) onCreated(res.data)
    else setError(res.error)
  }
  return (
    <Modal title="New catalogue item" onClose={onClose}>
      <label className="label">It is</label>
      <div className="mb-3 flex gap-1.5">
        {(['model', 'skin'] as const).map((k) => (
          <button key={k} className={`btn btn-sm ${kind === k ? 'btn-primary' : ''}`} onClick={() => setKind(k)}>
            {k === 'model' ? 'A model (hat, item in hand…)' : 'A skin'}
          </button>
        ))}
      </div>
      <label className="label">Name</label>
      <input className="field mb-3" value={name} maxLength={60} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && void create()} />
      <p className="mb-3 text-xs text-gray-400">It stays on Herald only until it is shown in the launchers. Its files are added next.</p>
      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
      <div className="flex justify-end gap-2">
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

function ItemPage({ item, onBack, onChanged, onDeleted }: { item: CatalogueItem; onBack(): void; onChanged(i: CatalogueItem): void; onDeleted(): void }) {
  const { can, sync } = useStore()
  const [sheet, setSheet] = useState<CatalogueSheet>(item)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  // a picture chosen on this PC for the item's cover, sent with Save
  const [cover, setCover] = useState<{ bytes: Uint8Array; url: string; width: number; height: number } | null>(null)
  const current = usePicture(item.thumbnail)
  const capture = useRef<StudioCapture | null>(null)
  const people = useMemo(() => new Map((sync?.people ?? []).map((p) => [p.id, p.name])), [sync?.people])
  const write = can('catalogue.write')
  const dirty = JSON.stringify(sheet) !== JSON.stringify(pickSheet(item)) || !!cover

  useEffect(() => setSheet(pickSheet(item)), [item.updatedAt]) // eslint-disable-line react-hooks/exhaustive-deps
  // the files in use, read for the studio (kept in memory only)
  useEffect(() => {
    let alive = true
    setLoaded(null)
    setLoadError(null)
    if (!item.version) return
    void (async () => {
      const res = await window.herald.api<{ version: number; files: { name: string; data: string }[] }>('GET', `/catalogue/${item.id}/files?version=${item.version}`)
      if (!alive) return
      if (!res.ok) return setLoadError(res.error)
      try {
        const files = res.data.files.map((f) => ({ name: f.name, bytes: fromB64(f.data) }))
        if (item.kind === 'skin') return setLoaded({ kind: 'skin', skin: toModelFiles(files)[0].content })
        const model = readModel(await Promise.all(toModelFiles(files).map(withAlpha)))
        if (alive) setLoaded({ kind: 'model', model })
      } catch (err) {
        if (alive) setLoadError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      alive = false
    }
  }, [item.id, item.version, item.kind])

  const run = async (what: () => Promise<ApiResult<CatalogueItem> | null>, done?: string) => {
    setBusy(true)
    setMessage(null)
    const res = await what()
    setBusy(false)
    if (!res) return false
    if (res.ok) (onChanged(res.data), done && setMessage({ ok: true, text: done }))
    else setMessage({ ok: false, text: res.error })
    return res.ok
  }
  /**
   * The page's one Save: the sheet, the studio's look, and the cover (a picture chosen on this PC, or else the studio's
   * picture, made again each time, unless a chosen one is kept)
   */
  const save = async () => {
    setBusy(true)
    setMessage(null)
    const fail = (text: string) => (setBusy(false), setMessage({ ok: false, text }), false)
    const look = loaded ? (capture.current?.look() ?? undefined) : undefined
    let image: string | null = null
    let customCover = sheet.customCover
    if (cover) {
      const up = await window.herald.images.upload(cover.bytes, cover.width, cover.height)
      if (!up.ok) return fail(up.error)
      image = up.data.id
      customCover = true
    } else if (!customCover && loaded && capture.current) {
      const bytes = await capture.current.picture()
      const up = bytes ? await window.herald.images.upload(bytes, 512, 512) : null
      if (!up?.ok) return fail(up && !up.ok ? up.error : 'The picture could not be made.')
      image = up.data.id
    }
    let res = await window.herald.api<CatalogueItem>('PATCH', `/catalogue/${item.id}`, { sheet: { ...sheet, studio: look, customCover } })
    if (res.ok && image) res = await window.herald.api<CatalogueItem>('POST', `/catalogue/${item.id}/thumbnail`, { image })
    if (!res.ok) return fail(res.error)
    onChanged(res.data)
    setCover(null)
    setBusy(false)
    setMessage({ ok: true, text: 'Saved.' })
    return true
  }
  /** A picture from the PC as the cover: made WebP (1024 pixels at most), shown here until Save */
  const pickCover = async (file: File | undefined) => {
    if (!file) return
    try {
      const img = await createImageBitmap(file)
      const k = Math.min(1, 1024 / Math.max(img.width, img.height))
      const [width, height] = [Math.max(1, Math.round(img.width * k)), Math.max(1, Math.round(img.height * k))]
      const c = new OffscreenCanvas(width, height)
      c.getContext('2d')!.drawImage(img, 0, 0, width, height)
      const blob = await c.convertToBlob({ type: 'image/webp', quality: 0.9 })
      setCover({ bytes: new Uint8Array(await blob.arrayBuffer()), url: URL.createObjectURL(blob), width, height })
      setMessage(null)
    } catch {
      setMessage({ ok: false, text: 'This picture can’t be read (PNG, JPEG or WebP).' })
    }
  }
  const status = async (s: CatalogueStatus) => {
    const ok = await run(() => window.herald.api<CatalogueItem>('POST', `/catalogue/${item.id}/status`, { status: s }), s === 'published' ? 'Shown in the launchers.' : 'Hidden from the launchers.')
    // no GitHub on the way: the bar above shows it reaching the launchers at once
    if (ok && s !== 'draft') announceDirect(`${s === 'published' ? 'In the launchers' : 'Hidden from the launchers'}: “${item.name}”`, s === 'published' ? 'In the launchers’ catalogue' : 'Out of the launchers’ catalogue')
  }
  const publishProblems = sheetProblems(item, true, item.version > 0)
  const set = (patch: Partial<CatalogueSheet>) => setSheet((s) => ({ ...s, ...patch }))

  return (
    <div className="mx-auto max-w-6xl">
      <button className="btn btn-ghost btn-sm mb-4" onClick={onBack}>
        ← Catalogue
      </button>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-white">{item.name}</h1>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[item.status]}`}>{STATUS_LABEL[item.status]}</span>
        <span className="text-xs text-gray-500">
          {item.kind === 'skin' ? 'Skin' : 'Model'} · added by {people.get(item.createdBy ?? '') ?? 'someone'}
        </span>
        {write && (
          <div className="ml-auto flex gap-2">
            {dirty && (
              <button className="btn btn-ghost" disabled={busy} onClick={() => (setSheet(pickSheet(item)), setCover(null))}>
                Undo
              </button>
            )}
            <button className="btn btn-primary" disabled={busy} onClick={() => void save()} title="Saves the sheet, the studio’s look and the cover picture">
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </div>
      {message && <p className={`mb-3 text-sm ${message.ok ? 'text-green-400' : 'text-red-400'}`}>{message.text}</p>}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          {loaded ? (
            <Studio item={item} loaded={loaded} adjust={sheet.adjust} slot={sheet.slot} slim={sheet.slim} capture={capture} />
          ) : (
            <div className="card grid h-80 place-items-center text-sm text-gray-400">{loadError ? <span className="text-red-400">The files can’t be shown: {loadError}</span> : item.version ? 'Opening the files…' : 'Add its files to try it on.'}</div>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <div className="card">
            <div className="eyebrow mb-3">Cover picture</div>
            <div className="mb-2 grid aspect-square w-full place-items-center overflow-hidden rounded-md bg-gray-900">
              {cover || current ? <img src={cover?.url ?? current!} alt="" className="h-full w-full object-cover" /> : <span className="text-xs text-gray-500">No picture yet</span>}
            </div>
            <p className="mb-2 text-xs text-gray-400">
              {cover ? 'New picture: it is used once you save.' : sheet.customCover ? 'A picture chosen from the PC (kept when you save).' : 'Made from the studio each time you save.'} Players see it in the launcher’s catalogue.
            </p>
            {write && (
              <div className="flex flex-wrap gap-1.5">
                <label className="btn btn-sm cursor-pointer">
                  Choose a picture…
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => (void pickCover(e.target.files?.[0]), (e.target.value = ''))} />
                </label>
                {(cover || sheet.customCover) && (
                  <button className="btn btn-sm btn-ghost" onClick={() => (setCover(null), set({ customCover: false }))}>
                    Use the studio picture
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="card">
            <div className="eyebrow mb-3">Sheet</div>
            <label className="label">Name</label>
            <input className="field mb-3" value={sheet.name} disabled={!write} maxLength={60} onChange={(e) => set({ name: e.target.value })} />
            <label className="label">Patreon link (opened from the launcher)</label>
            <input className="field mb-3" value={sheet.patreonUrl} disabled={!write} placeholder="https://www.patreon.com/posts/…" onChange={(e) => set({ patreonUrl: e.target.value })} />
            <div className="mb-3 grid grid-cols-2 gap-2">
              <div>
                <label className="label">Tier</label>
                <input className="field" value={sheet.tier} disabled={!write} maxLength={40} placeholder="Tier 2" onChange={(e) => set({ tier: e.target.value })} />
              </div>
              <div>
                <label className="label">Category</label>
                <input className="field" value={sheet.category} disabled={!write} maxLength={40} placeholder="Hats" onChange={(e) => set({ category: e.target.value })} />
              </div>
            </div>
            {item.kind === 'model' ? (
              <>
                <label className="label">Worn</label>
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {CATALOGUE_SLOTS.map((s) => (
                    <button key={s} disabled={!write} className={`btn btn-sm ${sheet.slot === s ? 'btn-primary' : ''}`} onClick={() => set({ slot: s })}>
                      {SLOT_LABEL[s]}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <label className="label">Arms</label>
                <div className="mb-3 flex gap-1.5">
                  {([false, true] as const).map((slim) => (
                    <button key={String(slim)} disabled={!write} className={`btn btn-sm ${sheet.slim === slim ? 'btn-primary' : ''}`} onClick={() => set({ slim })}>
                      {slim ? 'Slim (Alex)' : 'Classic (Steve)'}
                    </button>
                  ))}
                </div>
              </>
            )}
            <label className="label">Description</label>
            <textarea className="field mb-3 h-20 resize-y" value={sheet.description} disabled={!write} maxLength={1000} onChange={(e) => set({ description: e.target.value })} />
            <label className="mb-1.5 flex cursor-pointer items-center gap-2 text-sm text-gray-200">
              <input
                type="checkbox"
                checked={!!sheet.newUntil}
                disabled={!write}
                // on: two weeks from today, to change below; off: no badge
                onChange={(e) => set({ newUntil: e.target.checked ? new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10) : null })}
              />
              “New” badge in the launcher
            </label>
            {sheet.newUntil && (
              <>
                <label className="label">Until</label>
                <input type="date" className="field mb-3" value={sheet.newUntil} min={new Date().toISOString().slice(0, 10)} disabled={!write} onChange={(e) => e.target.value && set({ newUntil: e.target.value })} />
              </>
            )}
            {!sheet.newUntil && <div className="mb-3" />}
            {item.kind === 'model' && (
              <>
                <label className="label">Position correction (saved with the sheet)</label>
                <div className="mb-3 grid grid-cols-4 gap-1.5">
                  {(['x', 'y', 'z', 'scale'] as const).map((k) => (
                    <label key={k} className="text-[11px] text-gray-400">
                      {k === 'scale' ? 'Size' : k.toUpperCase()}
                      <input
                        type="number"
                        className="field mt-0.5 px-2! py-1!"
                        step={k === 'scale' ? 0.05 : 0.25}
                        min={k === 'scale' ? 0.25 : -16}
                        max={k === 'scale' ? 4 : 16}
                        disabled={!write}
                        value={sheet.adjust[k]}
                        onChange={(e) => set({ adjust: { ...sheet.adjust, [k]: Number(e.target.value) } })}
                      />
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="card">
            <div className="eyebrow mb-3">Files</div>
            {write && (
              <button className="btn btn-sm mb-3" disabled={busy} onClick={() => void run(() => window.herald.catalogue.addFiles(item.id), 'New files added.')}>
                {item.version ? 'Upload a new version…' : item.kind === 'skin' ? 'Add the skin (.png)…' : 'Add the files (.bbmodel, or .json + .png)…'}
              </button>
            )}
            {item.versions.length === 0 && <p className="text-xs text-gray-500">No files yet.</p>}
            <div className="flex flex-col gap-2">
              {item.versions.map((v) => (
                <div key={v.version} className={`rounded-md border p-2 text-xs ${v.version === item.version ? 'border-green-600/50 bg-green-600/5' : 'border-gray-700'}`}>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <b className="text-gray-200">
                      Version {v.version}
                      {v.version === item.version && <span className="ml-1.5 font-normal text-green-400">in use</span>}
                    </b>
                    <span className="text-gray-500">
                      {new Date(v.at).toLocaleDateString()} · {people.get(v.by ?? '') ?? 'someone'}
                    </span>
                  </div>
                  <p className="truncate text-gray-400" title={v.files.map((f) => f.name).join(', ')}>
                    {v.files.map((f) => f.name).join(', ')}
                  </p>
                  <div className="mt-1.5 flex gap-1.5">
                    {write && v.version !== item.version && (
                      <button className="btn btn-sm" disabled={busy} onClick={() => void run(() => window.herald.api<CatalogueItem>('POST', `/catalogue/${item.id}/version`, { version: v.version }), `Version ${v.version} in use.`)}>
                        Use this version
                      </button>
                    )}
                    {can('catalogue.export') && (
                      <button
                        className="btn btn-sm btn-ghost"
                        disabled={busy}
                        onClick={async () => {
                          const res = await window.herald.catalogue.saveOriginal(item.id, v.version)
                          if (res) setMessage(res.ok ? { ok: true, text: `${res.data.saved} original file(s) saved in ${res.data.folder}.` } : { ok: false, text: res.error })
                        }}
                      >
                        Download the originals
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="eyebrow mb-3">In the launchers</div>
            <p className="mb-3 text-xs text-gray-400">
              {item.status === 'published' ? 'Players can try it on and open its Patreon page.' : item.status === 'hidden' ? 'Taken out of the launchers; still here.' : 'Only on Herald: players don’t see it yet.'}
            </p>
            {can('catalogue.publish') &&
              (item.status === 'published' ? (
                <button className="btn btn-sm" disabled={busy} onClick={() => void status('hidden')}>
                  Hide from the launchers
                </button>
              ) : (
                <>
                  <button className="btn btn-primary btn-sm" disabled={busy || publishProblems.length > 0 || dirty} onClick={() => void status('published')}>
                    Show in the launchers
                  </button>
                  {publishProblems.map((p) => (
                    <p key={p} className="mt-1.5 text-xs text-amber-400">
                      {p}
                    </p>
                  ))}
                  {dirty && <p className="mt-1.5 text-xs text-amber-400">Save first.</p>}
                </>
              ))}
          </div>

          {can('catalogue.delete') && (
            <div className="card">
              <div className="eyebrow mb-3 text-red-400!">Delete</div>
              {deleting ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-gray-300">Every version of its files is deleted too.</span>
                  <button className="btn btn-danger btn-sm" disabled={busy} onClick={async () => (await window.herald.api('POST', `/catalogue/${item.id}/delete`)).ok && onDeleted()}>
                    Delete for good
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setDeleting(false)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <button className="btn btn-danger btn-sm" onClick={() => setDeleting(true)}>
                  Delete this item…
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const pickSheet = (i: CatalogueSheet): CatalogueSheet => {
  const out = { ...EMPTY_SHEET }
  for (const k of Object.keys(EMPTY_SHEET) as (keyof CatalogueSheet)[]) (out as Record<string, unknown>)[k] = i[k]
  return out
}
