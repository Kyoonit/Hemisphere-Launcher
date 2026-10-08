import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bell, Bug, CalendarDays, Construction, FlaskConical, FolderOpen, Gauge, Image, Info, LoaderCircle, Lock, Monitor, Newspaper, RefreshCw, RotateCcw, Server, Trash2, type LucideIcon } from 'lucide-react'
import type { DevAccess, DevAction, DevState } from '@shared/dev'
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
  useEffect(() => setState(access.state), [access.state])
  if (!state) return null

  const set = async (patch: Partial<DevState>) => {
    const next = await window.hemisphere.dev.set(patch)
    if (next) setState(next)
  }
  const act = async (action: DevAction) => {
    setBusy(action)
    setResult(null)
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
            {(['real', 'busy', 'offline', 'unknown'] as const).map((v) => (
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
        </div>
        <Line label={t('dev.discordId')} hint={t('dev.discordIdHint')}>
          <span className="flex gap-1.5">
            <input
              value={appId}
              onChange={(e) => setAppId(e.target.value.replace(/\D/g, '').slice(0, 20))}
              placeholder="1234567890123456789"
              className="w-[190px] rounded-lg border border-gray-700 bg-gray-900 px-2.5 py-1.5 font-mono text-[12.5px] text-white"
            />
            <button onClick={() => set({ discordAppId: appId })} className={btn}>
              {t('dev.save')}
            </button>
          </span>
        </Line>
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
      </Group>
    </div>
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
