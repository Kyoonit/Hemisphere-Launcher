import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, RotateCcw, TriangleAlert, Wrench } from 'lucide-react'
import type { GameState } from '@shared/game'
import type { ClientSummary } from '@shared/client'
import { useAccounts } from '../accounts'

const STAGES = ['minecraft', 'java', 'fabric', 'mods', 'launching'] as const
const REPAIR_STAGES = ['minecraft', 'java', 'fabric', 'mods'] as const

export function useGameState(): GameState | null {
  const [state, setState] = useState<GameState | null>(null)
  useEffect(() => {
    window.hemisphere.game.getState().then(setState)
    return window.hemisphere.game.onState(setState)
  }, [])
  return state
}

/** PLAY button and everything that replaces it: install progress, "playing", errors. */
export default function PlayZone({ client, onRepair }: { client: ClientSummary | null; onRepair(): void }) {
  const { t } = useTranslation()
  const { active } = useAccounts()
  const game = useGameState()
  if (!game || !active) return null

  if (game.phase === 'preparing') return <Preparing game={game} />

  const playing = game.runningAccounts.includes(active.id)
  if (playing) {
    return (
      <div className="flex flex-col items-center">
        <div className="play-button flex cursor-default items-center uppercase justify-center gap-3 !bg-none !bg-gray-700/90 !text-[22px] !tracking-[0.1em] !shadow-lg hover:!scale-100">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-green-400 shadow-[0_0_10px_var(--color-green-400)]" />
          {t('game.playing')}
        </div>
        <p className="mt-3 text-[13px] text-gray-400">{t('game.playingHint')}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center">
      <button className="play-button uppercase" onClick={() => window.hemisphere.game.play()}>
        {t('home.play')}
      </button>
      {game.error ? (
        <div className="animate-fade mt-3 flex max-w-[420px] items-start gap-2 text-left text-[13px]">
          <TriangleAlert size={15} className="mt-0.5 flex-none text-red-400" />
          <span className="text-gray-300">
            <b className="text-white">{t(`game.errors.${game.error.code}`)}</b>{' '}
            <button onClick={() => window.hemisphere.game.play()} className="inline-flex items-center gap-1 font-semibold text-green-400 hover:text-green-300">
              <RotateCcw size={12} /> {t('game.retry')}
            </button>
            {['crashed', 'unknown', 'java', 'disk'].includes(game.error.code) && (
              <button onClick={onRepair} className="ml-2 inline-flex items-center gap-1 font-semibold text-green-400 hover:text-green-300">
                <Wrench size={12} /> {t('repair.short')}
              </button>
            )}
          </span>
        </div>
      ) : (
        <p className="mt-3 flex items-center gap-1.5 text-[13px] text-gray-400">
          <Check size={14} className="text-green-400" />
          <b className="font-semibold text-green-400">{t('home.ready')}</b>
          {' · '}
          {client ? t('home.clientVersion', { version: client.clientVersion, minecraft: client.minecraft }) : t('home.clientUnknown')}
        </p>
      )}
    </div>
  )
}

export function Preparing({ game }: { game: GameState }) {
  const { t } = useTranslation()
  const repairing = game.activity === 'repair'
  const stages: readonly string[] = repairing ? REPAIR_STAGES : STAGES
  const stage = game.progress?.stage ?? 'minecraft'
  const ratio = game.progress?.ratio ?? null
  const index = stages.indexOf(stage)

  return (
    <div className="glass animate-fade w-[360px] px-[18px] py-4 text-left">
      <div className="mb-2 flex items-center justify-between">
        <b className="text-white">{t(repairing ? `repair.stages.${stage}` : `game.stages.${stage}`)}</b>
        <span className="text-xs text-gray-400 tabular-nums">
          {ratio !== null ? `${Math.round(ratio * 100)}%` : t('game.step', { n: index + 1, total: stages.length })}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-gray-700/90">
        {ratio === null ? (
          <i className="block h-full w-1/3 animate-[indeterminate_1.2s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-green-600 to-green-400" />
        ) : (
          <i className="block h-full rounded-full bg-gradient-to-r from-green-600 to-green-400 transition-[width] duration-300" style={{ width: `${ratio * 100}%` }} />
        )}
      </div>
      <div className="mt-2.5 flex gap-1.5">
        {stages.map((s, i) => (
          <span key={s} className={`h-1 flex-1 rounded-full ${i < index ? 'bg-green-500' : i === index ? 'bg-green-500/50' : 'bg-gray-700'}`} />
        ))}
      </div>
      <p className="mt-2 truncate text-xs text-gray-400">{stage === 'mods' && game.progress?.detail ? game.progress.detail : repairing ? t('repair.hint') : t('game.firstTimeHint')}</p>
    </div>
  )
}
