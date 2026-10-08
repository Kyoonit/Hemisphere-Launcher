import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from '../i18n'
import { Activity, Clock3, Bell, BellRing, Bug, MemoryStick, Code, Languages, ZoomIn, CalendarDays, Construction, FlaskConical, FolderOpen, Gauge, Image, Info, LoaderCircle, Lock, Monitor, Newspaper, RefreshCw, RotateCcw, Server, Trash2, type LucideIcon } from 'lucide-react'
import type { DevAccess, DevAction, DevState } from '@shared/dev'
import type { PerfSnapshot } from '@shared/performance'
import Toggle from '../components/Toggle'

/**
 * Settings > Developer: pretend situations to look at every screen and stress-test features (development builds, or
 * the installed launcher with the staff code). Everything is local and pretend: nothing reaches the server or players.
 */
export default function Developer({ access, onLocked }: { access: DevAccess; onLocked(): void }) {
  const { t } = useTranslation()
  const [state, setState] = useState<DevState | null>(access.state)
  const [busy, setBusy] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [appId, setAppId] = useState(access.state?.discordAppId ?? '')
  const [discordCheck, setDiscordCheck] = useState<{ ok: true; name: string } | { ok: false; reason: 'notApp' | 'network' } | null>(null)
  useEffect(() => setState(access.state), [access.state])
  if (!state) return null

  const set = async (patch: Partial<DevState>) => {
    const next = await window.hemisphere.dev.set(patch)
    if (next) setState(next)
  }
  const act = async (action: DevAction) => {
    setBusy(action)
    setResult(null)
    // the id typed in the field counts even if Save wasn't clicked
    if (action === 'discord:test' && appId !== state.discordAppId) await set({ discordAppId: appId })
    setResult(await window.hemisphere.dev.action(action).catch(() => 'failed'))
    setBusy(null)
  }
  const select = 'rounded-lg border border-gray-700 bg-gray-900 px-3 py-1.5 text-sm text-white'
  const btn = 'flex items-center gap-1.5 rounded-lg bg-gray-700/85 px-3 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-gray-600 disabled:opacity-50'
  const Action = ({ action, icon: Icon, label }: { action: DevAction; icon: LucideIcon; label: string }) => (
    <button onClick={() => act(action)} disabled={busy !== null} className={btn}>
      {busy === action ? <LoaderCircle size={14} className="animate-spin" /> : <Icon size={14} />} {label}
    </button>
  )

  return (
    <div className="mt-2 space-y-4">
      <p className="flex items-start gap-2 rounded-lg border-l-[3px] border-violet-400 bg-violet-950/40 px-3.5 py-2.5 text-[13px] text-violet-100">
        <FlaskConical size={15} className="mt-0.5 flex-none text-violet-300" />
        <span className="min-w-0 flex-1">{access.devBuild ? t('dev.introDev') : t('dev.introStaff')}</span>
        {!access.devBuild && (
          <button
            onClick={async () => {
              await window.hemisphere.dev.lock()
              onLocked()
            }}
            className="flex flex-none items-center gap-1.5 rounded-md bg-violet-500/30 px-2.5 py-1 text-xs font-bold text-white hover:bg-violet-500/45"
          >
            <Lock size={12} /> {t('dev.lock')}
          </button>
        )}
      </p>
      {result && (
        <p role="status" className="flex items-center gap-2 rounded-lg bg-gray-800/80 px-3 py-2 text-[13px] text-gray-200">
          <Info size={14} className="text-green-400" /> {result}
        </p>
      )}

      <Performance />
      <Group icon={MemoryStick} title={t('dev.groups.memory')}>
        <p className="text-[12.5px] text-gray-400">{t('dev.releaseHint')}</p>
        <div className="flex flex-wrap gap-2">
          <Action action="release:test" icon={MemoryStick} label={t('dev.releaseTest')} />
        </div>
      </Group>

      <Group icon={Newspaper} title={t('dev.groups.feed')}>
        <Line label={t('dev.sampleEvents')} hint={t('dev.sampleEventsHint')}>
          <Toggle on={state.sampleEvents} label={t('dev.sampleEvents')} onChange={(sampleEvents) => set({ sampleEvents })} />
        </Line>
        <Line label={t('dev.maintenance')} hint={t('dev.maintenanceHint')}>
          <Toggle on={state.maintenance} label={t('dev.maintenance')} onChange={(maintenance) => set({ maintenance })} />
        </Line>
        <Line label={t('dev.restart')} hint={t('dev.restartHint')}>
          <select value={state.restart} onChange={(e) => set({ restart: e.target.value as DevState['restart'] })} className={select}>
            {(['real', 'soon', 'now'] as const).map((v) => (
              <option key={v} value={v}>
                {t(`dev.restartOptions.${v}`)}
              </option>
            ))}
          </select>
        </Line>
        <div className="flex flex-wrap gap-2">
          <Action action="restart:simulate" icon={RefreshCw} label={t('dev.simulateRestart')} />
        </div>
        <Line label={t('dev.extraNews')} hint={t('dev.extraNewsHint')}>
          <select value={state.extraNews} onChange={(e) => set({ extraNews: Number(e.target.value) })} className={select}>
            {[0, 1, 3, 9, 12].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Line>
        <div className="flex flex-wrap gap-2 pt-1">
          <Action action="reset:seen" icon={RotateCcw} label={t('dev.resetSeen')} />
        </div>
      </Group>

      <Group icon={Server} title={t('dev.groups.server')}>
        <Line label={t('dev.server')} hint={t('dev.serverHint')}>
          <select value={state.server} onChange={(e) => set({ server: e.target.value as DevState['server'] })} className={select}>
            {(['real', 'few', 'busy', 'full', 'offline', 'unknown'] as const).map((v) => (
              <option key={v} value={v}>
                {t(`dev.serverOptions.${v}`)}
              </option>
            ))}
          </select>
        </Line>
      </Group>

      <Group icon={Bug} title={t('dev.groups.game')}>
        <p className="text-[12.5px] text-gray-400">{t('dev.gameHint')}</p>
        <div className="flex flex-wrap gap-2">
          <Action action="crash" icon={Bug} label={t('dev.crash')} />
          <Action action="crash:many" icon={Bug} label={t('dev.crashMany')} />
          <Action action="crash:memory" icon={Bug} label={t('dev.crashMemory')} />
          <Action action="progress" icon={Gauge} label={t('dev.progress')} />
          <Action action="background" icon={RefreshCw} label={t('dev.background')} />
          {(['error:network', 'error:java', 'error:disk', 'error:busy', 'error:sessionExpired', 'error:content'] as const).map((a) => (
            <Action key={a} action={a} icon={Construction} label={t(`dev.errors.${a.slice(6)}`)} />
          ))}
          <Action action="clearError" icon={Trash2} label={t('dev.clearError')} />
        </div>
      </Group>

      <Group icon={Bell} title={t('dev.groups.community')}>
        <div className="flex flex-wrap gap-2">
          <Action action="notify:back" icon={Bell} label={t('dev.notifyBack')} />
          <Action action="notify:event" icon={CalendarDays} label={t('dev.notifyEvent')} />
          <Action action="notify:all" icon={BellRing} label={t('dev.notifyAll')} />
          <Action action="recap:sample" icon={Clock3} label={t('dev.recapSample')} />
        </div>
        <Line label={t('dev.discordId')} hint={t('dev.discordIdHint')}>
          <span className="flex gap-1.5">
            <input
              value={appId}
              onChange={(e) => setAppId(e.target.value.replace(/\D/g, '').slice(0, 20))}
              placeholder="1234567890123456789"
              className="w-[190px] rounded-lg border border-gray-700 bg-gray-900 px-2.5 py-1.5 font-mono text-[12.5px] text-white"
            />
            <button
              onClick={async () => {
                setDiscordCheck(null)
                await set({ discordAppId: appId })
                if (appId) setDiscordCheck(await window.hemisphere.dev.checkDiscord(appId))
              }}
              className={btn}
            >
              {t('dev.save')}
            </button>
          </span>
        </Line>
        {discordCheck && (
          <p className={`rounded-md px-2.5 py-1.5 text-[12.5px] ${discordCheck.ok ? 'bg-green-900/40 text-green-200' : 'bg-red-900/40 text-red-200'}`}>
            {discordCheck.ok ? t('dev.discordOk', { name: discordCheck.name }) : t(`dev.discordBad.${discordCheck.reason}`)}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Action action="discord:test" icon={Monitor} label={t('dev.discordTest')} />
          <Action action="discord:clear" icon={Trash2} label={t('dev.discordClear')} />
        </div>
      </Group>

      <Group icon={RefreshCw} title={t('dev.groups.launcher')}>
        <Line label={t('dev.launcherUpdate')} hint={t('dev.launcherUpdateHint')}>
          <select value={state.launcherUpdate} onChange={(e) => set({ launcherUpdate: e.target.value as DevState['launcherUpdate'] })} className={select}>
            {(['real', 'downloading', 'ready', 'error'] as const).map((v) => (
              <option key={v} value={v}>
                {t(`dev.updateOptions.${v}`)}
              </option>
            ))}
          </select>
        </Line>
        <Line label={t('dev.preflight')} hint={t('dev.preflightHint')}>
          <Toggle on={state.preflight} label={t('dev.preflight')} onChange={(preflight) => set({ preflight })} />
        </Line>
      </Group>

      <Group icon={Image} title={t('dev.groups.files')}>
        <div className="flex flex-wrap gap-2">
          <Action action="shots:add" icon={Image} label={t('dev.shotsAdd')} />
          <Action action="shots:remove" icon={Trash2} label={t('dev.shotsRemove')} />
          <Action action="open:data" icon={FolderOpen} label={t('dev.openData')} />
        </div>
      </Group>

      <Group icon={Monitor} title={t('dev.groups.window')}>
        <div className="flex flex-wrap gap-2">
          <Action action="window:960x600" icon={Monitor} label={t('dev.windowMin')} />
          <Action action="window:1120x700" icon={Monitor} label={t('dev.windowDefault')} />
          <Action action="window:1600x900" icon={Monitor} label="1600 × 900" />
        </div>
        <Line label={t('dev.zoom')} hint={t('dev.zoomHint')}>
          <span className="flex gap-1.5">
            {(['zoom:0.9', 'zoom:1', 'zoom:1.1', 'zoom:1.25'] as const).map((a) => (
              <Action key={a} action={a} icon={ZoomIn} label={`${Math.round(Number(a.slice(5)) * 100)} %`} />
            ))}
          </span>
        </Line>
        <Line label={t('dev.language')} hint={t('dev.languageHint')}>
          <span className="flex gap-1.5">
            {(['en', 'fr'] as const).map((l) => (
              <button
                key={l}
                onClick={() => i18n.changeLanguage(l)}
                className={`${btn} ${i18n.language.startsWith(l) ? 'ring-1 ring-violet-400' : ''}`}
              >
                <Languages size={14} /> {l.toUpperCase()}
              </button>
            ))}
          </span>
        </Line>
        <div className="flex flex-wrap gap-2">
          <Action action="ui:reload" icon={RotateCcw} label={t('dev.reload')} />
          <Action action="ui:devtools" icon={Code} label={t('dev.devtools')} />
        </div>
      </Group>
    </div>
  )
}

/** What the launcher costs right now: memory and CPU per process, and what it downloaded, per site. */
function Performance() {
  const { t, i18n } = useTranslation()
  const [perf, setPerf] = useState<PerfSnapshot | null>(null)
  useEffect(() => {
    const load = () => void window.hemisphere.dev.perf().then(setPerf)
    load()
    const timer = setInterval(load, 2000)
    return () => clearInterval(timer)
  }, [])
  if (!perf) return null
  const size = (b: number) => (b >= 1024 ** 2 ? `${(b / 1024 ** 2).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`)
  const minutes = Math.max(1, Math.round((Date.now() - perf.since) / 60_000))
  return (
    <Group icon={Activity} title={t('dev.groups.perf')}>
      <div className="flex items-baseline gap-3">
        <b className="text-2xl font-bold text-white tabular-nums">{perf.totalMb} MB</b>
        <span className="text-[12.5px] text-gray-400">{t('dev.perfTotal', { count: perf.processes.length })}</span>
      </div>
      <table className="w-full text-[12.5px] tabular-nums">
        <tbody>
          {perf.processes
            .slice()
            .sort((a, b) => b.memoryMb - a.memoryMb)
            .map((p, i) => (
              <tr key={i} className="border-t border-gray-800 text-gray-300">
                <td className="py-1">{t(`dev.perfProcess.${p.type}`, { defaultValue: p.type })}{p.name ? <span className="text-gray-500"> · {p.name}</span> : null}</td>
                <td className="py-1 text-right">{p.memoryMb} MB</td>
                <td className="w-16 py-1 text-right text-gray-400">{p.cpu.toLocaleString(i18n.language)} %</td>
              </tr>
            ))}
        </tbody>
      </table>
      <p className="pt-1 text-[12.5px] font-semibold text-gray-200">
        {t('dev.perfNetwork', { minutes })}
        {perf.metered && <span className="ml-2 rounded bg-amber-500/20 px-1.5 py-0.5 text-[11px] text-amber-200">{t('dev.perfMetered')}</span>}
      </p>
      <p className="text-[12.5px] text-green-300">
        {t('dev.perfSaved', { notModified: perf.savings.notModified, notModifiedSize: size(perf.savings.notModifiedBytes), reused: perf.savings.reusedFiles, reusedSize: size(perf.savings.reusedBytes) })}
      </p>
      {perf.network.length === 0 ? (
        <p className="text-[12.5px] text-gray-500">{t('dev.perfNoNetwork')}</p>
      ) : (
        <table className="w-full text-[12.5px] tabular-nums">
          <tbody>
            {perf.network.slice(0, 8).map((n) => (
              <tr key={n.host} className="border-t border-gray-800 text-gray-300">
                <td className="max-w-0 truncate py-1">{n.host}</td>
                <td className="w-24 py-1 text-right text-gray-400">{t('dev.perfRequests', { count: n.requests })}</td>
                <td className="w-20 py-1 text-right">{size(n.bytes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Group>
  )
}

function Group({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl bg-gray-900/55 p-4">
      <h3 className="mb-2 flex items-center gap-2 font-semibold text-white">
        <Icon size={16} className="text-violet-300" /> {title}
      </h3>
      <div className="space-y-2.5">{children}</div>
    </section>
  )
}

function Line({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4">
      <div className="min-w-0 flex-1">
        <b className="block text-[13.5px] font-semibold text-gray-100">{label}</b>
        {hint && <span className="block text-[12px] text-gray-400">{hint}</span>}
      </div>
      {children}
    </div>
  )
}
