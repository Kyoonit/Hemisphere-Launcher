/**
 * Online now (S11): what players' launchers really get at this moment. Not Herald's own state: the feed at the commit
 * the pulse gives, its signature checked with the content key, the vaults whose time has come opened with their
 * keys, the pictures from GitHub. Shown with the launcher's own components, like the time travel.
 */
import { useEffect, useMemo, useState } from 'react'
import type { OnlineState } from '@herald/api'
import type { NewsItemV2 } from '@shared/feedV2'
import { resolveFeed } from '@shared/schedule'
import { TEXT_LANGUAGES } from '@shared/heraldPublications'
import { usePubs } from '../pubs'
import { useStore } from '../store'
import { formatWhen } from '../time'
import { LauncherPreview, WINDOW_SIZES, type PreviewScreen, type WindowSize } from '../preview/LauncherPreview'

export default function OnlineNow() {
  const { state } = usePubs()
  const { zone } = useStore()
  const [online, setOnline] = useState<OnlineState | null>(null)
  const [busy, setBusy] = useState(false)
  const [lang, setLang] = useState('en')
  const [screen, setScreen] = useState<PreviewScreen>('home')
  const [article, setArticle] = useState<string | null>(null)
  const [size, setSize] = useState<WindowSize>('normal')
  const [now, setNow] = useState(Date.now())
  const check = async () => {
    setBusy(true)
    setOnline(await window.herald.online())
    setNow(Date.now())
    setBusy(false)
  }
  // Again after each publication, and every minute
  const live = state?.live?.sequence
  useEffect(() => void check(), [live])
  useEffect(() => {
    const t = window.setInterval(() => void check(), 60_000)
    return () => window.clearInterval(t)
  }, [])
  // Vault pictures arrive as bytes: object URLs for the page
  const blobs = useMemo(() => {
    const out: Record<string, string> = {}
    for (const [sha, bytes] of Object.entries(online?.pictures ?? {})) out[sha] = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/webp' }))
    return out
  }, [online])
  useEffect(() => () => Object.values(blobs).forEach((u) => URL.revokeObjectURL(u)), [blobs])

  if (!online) return <div className="text-gray-400">Reading what launchers get…</div>
  const picture = (f: { path: string; sha512: string } | undefined) => (f ? (blobs[f.sha512] ?? (f.path.startsWith('v2/images/') && online.base ? online.base + f.path : undefined)) : undefined)
  const view = online.feed ? resolveFeed(online.feed, online.opened, now, lang) : null
  if (view) {
    view.news = view.news.map((n) => ({ ...n, image: picture((n as NewsItemV2).imageFile) ?? n.image }))
    if (view.backgrounds) view.backgrounds.items = view.backgrounds.items.map((b) => ({ ...b, src: picture(b.image) }))
  }
  const herald = state?.live?.sequence ?? null
  const lastJob = state?.jobs.find((j) => j.status !== 'superseded') ?? null
  const vaults = online.feed?.vaults ?? []
  const closed = vaults.filter((v) => Date.parse(v.opensAt) > now).sort((a, b) => a.opensAt.localeCompare(b.opensAt))
  const rows: [string, React.ReactNode, string?][] = [
    ['Feed', online.pulse ? `sequence ${online.pulse.sequence}${online.pulse.commit ? ` · commit ${online.pulse.commit.slice(0, 7)}` : ''}` : 'the Herald server cannot be reached', online.pulse ? 'text-white' : 'text-red-300'],
    ['Signature', online.signed ? '✓ valid: launchers accept it' : `✕ ${online.error ?? 'not checked'}`, online.signed ? 'text-green-300' : 'text-red-300'],
    [
      'Herald',
      lastJob && (lastJob.status === 'queued' || lastJob.status === 'publishing')
        ? 'a publication is on its way: it shows here once on GitHub'
        : herald !== null && online.pulse && herald === online.pulse.sequence
          ? '✓ same as Herald’s last publication'
          : `Herald's last publication: ${herald ?? '?'}`,
      herald === online.pulse?.sequence ? 'text-green-300' : 'text-amber-200',
    ],
    [
      'GitHub cache',
      online.branchSequence === null ? '—' : online.pulse && online.branchSequence < online.pulse.sequence ? `the plain address still serves ${online.branchSequence}: a launcher that missed the pulse catches up within 5 minutes` : '✓ up to date',
      online.pulse && online.branchSequence !== null && online.branchSequence < online.pulse.sequence ? 'text-amber-200' : 'text-gray-300',
    ],
    ['Vaults', vaults.length ? `${vaults.length - closed.length} opened · ${closed.length} still locked${closed[0] ? ` (next: ${formatWhen(Date.parse(closed[0].opensAt), zone)}, ${closed[0].kind})` : ''}` : 'none', 'text-gray-300'],
    ['Mod pack', online.pack ? `Hemisphere Client ${online.pack.clientVersion} · Minecraft ${online.pack.minecraft} · index ${online.pack.sequence}` : '—', 'text-gray-300'],
  ]

  return (
    <div className="animate-fade">
      <div className="mb-4 flex items-end gap-3">
        <div>
          <div className="eyebrow">Online now</div>
          <h1 className="text-[26px] font-extrabold text-white">What launchers really get</h1>
        </div>
        <span className="ml-auto text-xs text-gray-500">checked {formatWhen(online.checkedAt, zone)}</span>
        <button className="btn btn-ghost" disabled={busy} onClick={() => void check()}>
          {busy ? 'Checking…' : 'Check again'}
        </button>
      </div>
      <div className="card mb-4 grid grid-cols-[140px_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
        {rows.map(([k, v, c]) => (
          <div key={k} className="contents">
            <span className="text-gray-400">{k}</span>
            <span className={c}>{v}</span>
          </div>
        ))}
      </div>
      {view && (
        <>
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <div>
              <label className="label">Player's language</label>
              <select className="field w-auto!" value={lang} onChange={(e) => setLang(e.target.value)}>
                {TEXT_LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Window</label>
              <select className="field w-auto!" value={size} onChange={(e) => setSize(e.target.value as WindowSize)}>
                {Object.entries(WINDOW_SIZES).map(([k, s]) => (
                  <option key={k} value={k}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-xs text-gray-500">Read from GitHub like a launcher: Herald's drafts and changes not published are not here.</p>
          </div>
          <LauncherPreview view={view} lang={lang} screen={screen} onScreen={setScreen} article={article} onArticle={setArticle} size={size} badge={0} at={now} />
        </>
      )}
    </div>
  )
}
