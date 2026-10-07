import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, FolderArchive, RefreshCw, ShieldCheck, Trash2, TriangleAlert, Wrench } from 'lucide-react'
import type { RepairMode, RepairReport } from '@shared/game'
import { Preparing, useGameState } from '../components/PlayZone'

const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)

export default function Repair({ onClose, onDone }: { onClose(): void; onDone(): void }) {
  const { t } = useTranslation()
  const game = useGameState()
  const [mode, setMode] = useState<RepairMode>('quick')
  const [report, setReport] = useState<RepairReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  const running = game?.phase === 'preparing' && game.activity === 'repair'
  const blocked = (game?.runningAccounts.length ?? 0) > 0

  const start = async () => {
    setError(null)
    setReport(null)
    const res = await window.hemisphere.game.repair(mode)
    if ('error' in res) setError(t(`game.errors.${res.error?.code ?? 'unknown'}`))
    else setReport(res)
  }

  return (
    <div className="grid h-full place-items-center overflow-auto p-6">
      <div className="glass animate-rise w-[640px] px-8 py-7">
        <p className="text-xs font-bold tracking-[0.08em] text-green-400 uppercase">{t('settings.sections.installation')}</p>
        <h1 className="mt-1 text-[26px] font-bold text-white">
          {t('repair.titleA')} <span className="text-green-400">Hemisphere</span>
        </h1>
        <p className="mt-1.5 text-gray-400">{t('repair.safeNote')}</p>

        {running && game ? (
          <div className="mt-5 flex justify-center">
            <Preparing game={game} />
          </div>
        ) : report ? (
          <Results report={report} />
        ) : (
          <div className="my-5 grid grid-cols-2 gap-3">
            <Option active={mode === 'quick'} onClick={() => setMode('quick')} icon={<ShieldCheck size={20} />} title={t('repair.quick.title')} text={t('repair.quick.text')} />
            <Option active={mode === 'full'} onClick={() => setMode('full')} icon={<RefreshCw size={20} />} title={t('repair.full.title')} text={t('repair.full.text')} danger />
          </div>
        )}

        {(error || (blocked && !running && !report)) && (
          <p className="mb-4 flex items-center gap-2 text-[13px] text-red-400">
            <TriangleAlert size={15} /> {error ?? t('game.errors.busy')}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          {report ? (
            <button onClick={onDone} className="rounded-lg bg-green-600 px-5 py-3 text-[15px] font-semibold text-white shadow-md transition-colors hover:bg-green-500">
              {t('repair.backToPlay')}
            </button>
          ) : (
            <>
              <button onClick={onClose} disabled={running} className="rounded-lg px-4 py-2 text-sm font-semibold text-gray-300 transition-colors hover:bg-gray-700 hover:text-white disabled:opacity-40">
                {t('auth.cancel')}
              </button>
              <button
                onClick={start}
                disabled={running || blocked}
                className="flex items-center gap-2 rounded-lg bg-green-600 px-5 py-3 text-[15px] font-semibold text-white shadow-md transition-colors hover:bg-green-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Wrench size={17} /> {t('repair.start')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Option(props: { active: boolean; onClick(): void; icon: React.ReactNode; title: string; text: string; danger?: boolean }) {
  return (
    <button
      onClick={props.onClick}
      className={`rounded-lg border p-[18px] text-left transition-colors duration-150 ${
        props.active ? 'border-green-500 bg-green-600/10' : 'border-transparent bg-gray-900/60 hover:border-gray-600'
      }`}
    >
      <span className={`grid h-9 w-9 place-items-center rounded-lg bg-gray-700 ${props.danger ? 'text-red-400' : 'text-green-400'}`}>{props.icon}</span>
      <b className="mt-2.5 mb-1 block text-[15px] text-white">{props.title}</b>
      <span className="text-[12.5px] text-gray-400">{props.text}</span>
    </button>
  )
}

function Results({ report }: { report: RepairReport }) {
  const { t } = useTranslation()
  const fixed = report.repaired.length + report.minecraftRepaired
  return (
    <div className="animate-fade my-5 flex flex-col gap-1">
      <Line icon={<Check size={13} strokeWidth={3} />} tone="ok">
        {t('repair.result.verified', { count: report.verifiedFiles })}
      </Line>
      <Line icon={<Check size={13} strokeWidth={3} />} tone="ok">
        {report.minecraftRepaired ? t('repair.result.minecraftFixed', { count: report.minecraftRepaired }) : t('repair.result.minecraftOk')}
      </Line>
      {report.repaired.map((r) => (
        <Line key={r.label} icon={<RefreshCw size={13} strokeWidth={3} />} tone="fix">
          {t(`repair.result.${r.reason}`, { name: r.label })}
        </Line>
      ))}
      {report.freedBytes > 0 && (
        <Line icon={<Trash2 size={13} strokeWidth={3} />} tone="ok">
          {t('repair.result.freed', { mb: mb(report.freedBytes) })}
        </Line>
      )}
      {report.configBackup && (
        <Line icon={<FolderArchive size={13} strokeWidth={3} />} tone="fix">
          {t('repair.result.backup', { folder: report.configBackup.split(/[\\/]/).pop() })}
        </Line>
      )}
      <div className="mt-3 rounded-lg border-l-[3px] border-green-400 bg-green-900/40 px-3.5 py-3 text-sm">
        <b className="text-white">{fixed ? t('repair.result.allFixed', { count: fixed }) : t('repair.result.nothing')}</b>{' '}
        <span className="text-gray-400">{t('repair.result.took', { s: Math.max(1, Math.round(report.durationMs / 1000)) })}</span>
      </div>
    </div>
  )
}

function Line({ icon, tone, children }: { icon: React.ReactNode; tone: 'ok' | 'fix'; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-1 py-1.5 text-gray-200">
      <span className={`grid h-[22px] w-[22px] flex-none place-items-center rounded-full ${tone === 'ok' ? 'bg-green-600/25 text-green-400' : 'bg-amber-600/25 text-amber-400'}`}>
        {icon}
      </span>
      {children}
    </div>
  )
}
