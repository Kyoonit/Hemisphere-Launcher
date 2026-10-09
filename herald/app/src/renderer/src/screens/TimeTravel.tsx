/**
 * Preview: "show me the launcher of a player in Sydney on 30/10 at 14:00". Same computation as the launcher
 * (resolveFeed) at any instant, any zone, any language; the list on the side jumps to each coming change.
 */
import { useMemo, useState } from 'react'
import { TEXT_LANGUAGES } from '@shared/heraldPublications'
import { usePubs } from '../pubs'
import { useStore } from '../store'
import { ZonePicker } from '../components/ui'
import { formatWhen, fromWallInput, offsetOf, toWallInput, zoneLabel } from '../time'
import { usePictures } from '../pictures'
import { LauncherPreview, WINDOW_SIZES, type PreviewScreen, type WindowSize } from '../preview/LauncherPreview'
import { badgeAt, pictureIds, upcomingChanges, viewAt } from '../preview/view'

export default function TimeTravel() {
  const { state } = usePubs()
  const { zone: myZone, settings } = useStore()
  const [zone, setZone] = useState(myZone)
  const [at, setAt] = useState(() => Date.now())
  const [lang, setLang] = useState('en')
  const [includeReady, setIncludeReady] = useState(false)
  const [screen, setScreen] = useState<PreviewScreen>('home')
  const [article, setArticle] = useState<string | null>(null)
  const [size, setSize] = useState<WindowSize>('normal')
  const ids = useMemo(() => (state ? pictureIds(state) : {}), [state])
  const urls = usePictures(Object.values(ids))
  const opts = useMemo(() => ({ includeReady }), [includeReady])
  const changes = useMemo(() => (state ? upcomingChanges(state, Date.now(), lang, opts, 40) : []), [state, lang, opts])
  if (!state) return <div className="text-gray-400">Loading…</div>
  const view = viewAt(state, at, lang, opts, urls, ids)
  const zones = [...new Set([myZone, ...settings.extraZones])]

  return (
    <div className="animate-fade">
      <div className="eyebrow">Time travel</div>
      <h1 className="mb-4 text-[26px] font-extrabold text-white">A player's launcher, any day, anywhere</h1>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="label">Date and time ({zoneLabel(zone)})</label>
          <input
            type="datetime-local"
            className="field w-auto!"
            value={toWallInput(at, zone)}
            onChange={(e) => {
              const t = fromWallInput(e.target.value, zone)
              if (t !== null) setAt(t)
            }}
          />
        </div>
        <div className="w-72">
          <label className="label">Player's time zone</label>
          <ZonePicker value={zone} onPick={setZone} />
        </div>
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
            {Object.entries(WINDOW_SIZES).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-1">
          {[
            ['− 1 day', -86_400_000],
            ['− 1 h', -3_600_000],
          ].map(([label, ms]) => (
            <button key={label} className="btn btn-ghost px-2.5!" onClick={() => setAt(at + (ms as number))}>
              {label}
            </button>
          ))}
          <button className="btn btn-ghost" onClick={() => setAt(Date.now())}>
            Now
          </button>
          {[
            ['+ 1 h', 3_600_000],
            ['+ 1 day', 86_400_000],
          ].map(([label, ms]) => (
            <button key={label} className="btn btn-ghost px-2.5!" onClick={() => setAt(at + (ms as number))}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-400">
        {zones.map((z) => (
          <span key={z}>
            {formatWhen(at, z)} {zoneLabel(z)} ({offsetOf(z, at)})
          </span>
        ))}
        <label className="ml-auto flex items-center gap-1.5 text-sm text-gray-300">
          <input type="checkbox" checked={includeReady} onChange={(e) => setIncludeReady(e.target.checked)} /> Also show what is Ready but not published yet
        </label>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_300px] gap-5">
        <div className="min-w-0">
          <LauncherPreview view={view} lang={lang} screen={screen} onScreen={setScreen} article={article} onArticle={setArticle} size={size} badge={badgeAt(state, at, lang, opts)} />
          <p className="mt-2 text-xs text-gray-500">Click Play or News in the preview, and the news cards, to move around like a player. The red badge counts the news a player who last looked a day earlier has not opened.</p>
        </div>
        <div className="card max-h-[620px] overflow-auto">
          <div className="eyebrow mb-2">Coming changes</div>
          {changes.length === 0 && <p className="text-sm text-gray-400">Nothing scheduled.</p>}
          {changes.map((c) => (
            <button key={c.at} className={`block w-full rounded-md px-2 py-2 text-left hover:bg-gray-700 ${Math.abs(c.at - at) < 1000 ? 'bg-gray-700' : ''}`} onClick={() => setAt(c.at)}>
              <span className="block text-xs font-semibold text-green-300">{formatWhen(c.at, zone)}</span>
              {c.lines.map((l) => (
                <span key={l} className="block text-sm text-gray-300">
                  {l}
                </span>
              ))}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
