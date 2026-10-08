import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ClipboardCopy, FileWarning, Flag, Package, PackageX, RotateCcw, Wrench, X } from 'lucide-react'

/** "Minecraft couldn't start": likely cause + one-click fixes (approved Error wireframe). */
export default function CrashCard({
  suspects,
  incompatible,
  outOfMemory,
  onRepair,
  onOpenMods,
  onReport,
}: {
  suspects: string[]
  incompatible: { name: string; version: string; needs: string }[]
  outOfMemory?: { memoryMb: number }
  onRepair(): void
  onOpenMods(): void
  onReport(): void
}) {
  const { t } = useTranslation()
  const [ownMods, setOwnMods] = useState<number>(0)
  const [copied, setCopied] = useState(false)
  const [raised, setRaised] = useState(false)
  // memory recommended for this PC: offered when Minecraft had less and ran out
  const [recommendedMb, setRecommendedMb] = useState<number | null>(null)
  useEffect(() => {
    if (outOfMemory) window.hemisphere.system.info().then((i) => setRecommendedMb(i.recommendedMemoryMb))
  }, [outOfMemory])
  useEffect(() => {
    window.hemisphere.client.playerMods().then((m) => setOwnMods(m.filter((x) => x.enabled).length))
  }, [])

  return (
    // Never wider than the gap between the side panels; in a narrow window it drops the subtitle and link labels
    // (a container query) so it stays short enough to fit above the bottom row.
    <div className="glass animate-fade @container w-[min(480px,calc(100vw-610px))] px-5 py-4 text-left" role="alert">
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-red-600/20 text-red-400">
          <X size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <b className="block text-white">{t('crash.title')}</b>
          <span className="text-[13px] text-gray-400 @max-[400px]:hidden short:hidden">{t('crash.subtitle')}</span>
        </div>
        <button
          onClick={() => window.hemisphere.game.dismissError()}
          aria-label={t('crash.close')}
          title={t('crash.close')}
          className="flex-none self-start rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-700 hover:text-white"
        >
          <X size={16} />
        </button>
      </div>

      {outOfMemory ? (
        // Minecraft ran out of memory: the launcher can give it more (the game's own settings stay the player's)
        <div className="mt-3 rounded-lg border-l-[3px] border-amber-400 bg-gray-900/65 px-3 py-2 text-[13px] text-gray-300">
          <b className="block text-white">{t('crash.outOfMemory', { gb: Math.round((outOfMemory.memoryMb / 1024) * 10) / 10 })}</b>
          <span className="text-xs text-gray-400">{raised ? t('crash.outOfMemoryDone') : t('crash.outOfMemoryHint')}</span>
          {!raised && recommendedMb !== null && outOfMemory.memoryMb < recommendedMb && (
            <button
              onClick={() => window.hemisphere.settings.set({ memoryMb: null }).then(() => setRaised(true))}
              className="mt-1.5 block rounded-md bg-amber-400 px-2.5 py-1 text-xs font-bold text-gray-900 hover:bg-amber-300"
            >
              {t('crash.outOfMemoryRaise', { gb: Math.round((recommendedMb / 1024) * 10) / 10 })}
            </button>
          )}
        </div>
      ) : incompatible.length > 0 ? (
        // Fabric said exactly which mods don't fit: name them (updating is the player's choice, in Mods)
        <div className="mt-3 rounded-lg border-l-[3px] border-amber-400 bg-gray-900/65 px-3 py-2 text-[13px] text-gray-300">
          <b className="block text-white">{t('crash.incompatibleTitle', { count: incompatible.length })}</b>
          <ul className="mt-1 max-h-[54px] space-y-0.5 overflow-y-auto">
            {incompatible.map((m) => (
              <li key={m.name} className="text-xs">
                <span className="font-semibold text-gray-200">{m.name}</span> <span className="text-gray-400">{m.version}</span>
                {m.needs && <span className="text-gray-400"> · {t('crash.needs', { needs: m.needs })}</span>}
              </li>
            ))}
          </ul>
        </div>
      ) : (ownMods > 0 || suspects.length > 0) && (
        <p className="mt-3 rounded-lg border-l-[3px] border-amber-400 bg-gray-900/65 px-3 py-2 text-[13px] text-gray-300">
          {ownMods > 0 ? t('crash.causeOwnMods', { count: ownMods }) : t('crash.causeMods')}
          {suspects.length > 0 && <span className="mt-0.5 block text-xs text-gray-400">{t('crash.mentioned', { mods: suspects.join(', ') })}</span>}
        </p>
      )}

      <div className="mt-3.5 flex flex-wrap gap-2 @max-[400px]:mt-2.5 @max-[400px]:gap-1.5 short:mt-2.5 short:gap-1.5">
        {incompatible.length > 0 && (
          <button
            onClick={onOpenMods}
            className="flex items-center gap-2 rounded-lg bg-green-600 px-3.5 py-2 text-sm @max-[400px]:gap-1.5 @max-[400px]:px-2.5 @max-[400px]:py-1.5 @max-[400px]:text-[13px] short:gap-1.5 short:px-2.5 short:py-1.5 short:text-[13px] font-semibold text-white shadow-md transition-colors hover:bg-green-500"
          >
            <Package size={15} /> {t('crash.openMods')}
          </button>
        )}
        {ownMods > 0 && (
          <button
            onClick={() => window.hemisphere.game.play({ target: 'latest', withoutPlayerMods: true })}
            className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm @max-[400px]:gap-1.5 @max-[400px]:px-2.5 @max-[400px]:py-1.5 @max-[400px]:text-[13px] short:gap-1.5 short:px-2.5 short:py-1.5 short:text-[13px] font-semibold text-white transition-colors ${incompatible.length ? 'bg-gray-700/85 hover:bg-gray-600' : 'bg-green-600 shadow-md hover:bg-green-500'}`}
          >
            <PackageX size={15} /> {t('crash.withoutMyMods')}
          </button>
        )}
        {/* Repair can't fix a mod made for another version: Open Mods is the way */}
        {incompatible.length === 0 && (
          <button onClick={onRepair} className="flex items-center gap-2 rounded-lg bg-gray-700/85 px-3.5 py-2 text-sm @max-[400px]:gap-1.5 @max-[400px]:px-2.5 @max-[400px]:py-1.5 @max-[400px]:text-[13px] short:gap-1.5 short:px-2.5 short:py-1.5 short:text-[13px] font-semibold text-white transition-colors hover:bg-gray-600">
            <Wrench size={15} /> {t('repair.short')}
          </button>
        )}
        <button onClick={() => window.hemisphere.game.play()} className="flex items-center gap-2 rounded-lg bg-gray-700/85 px-3.5 py-2 text-sm @max-[400px]:gap-1.5 @max-[400px]:px-2.5 @max-[400px]:py-1.5 @max-[400px]:text-[13px] short:gap-1.5 short:px-2.5 short:py-1.5 short:text-[13px] font-semibold text-white transition-colors hover:bg-gray-600">
          <RotateCcw size={15} /> {t('game.retry')}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-0.5 border-t border-white/10 pt-2.5">
        <LinkButton onClick={() => window.hemisphere.system.openFolder('crashReports')} icon={<FileWarning size={14} />}>
          {t('crash.reports')}
        </LinkButton>
        <LinkButton
          onClick={async () => {
            await window.hemisphere.system.copyDiagnostics()
            setCopied(true)
            setTimeout(() => setCopied(false), 2500)
          }}
          icon={copied ? <Check size={14} className="text-green-400" /> : <ClipboardCopy size={14} />}
        >
          {copied ? t('settings.copied') : t('settings.copyDiagnostics')}
        </LinkButton>
        <LinkButton onClick={onReport} icon={<Flag size={14} />}>
          {t('report.thisCrash')}
        </LinkButton>
      </div>
    </div>
  )
}

function LinkButton({ onClick, icon, children }: { onClick(): void; icon: React.ReactNode; children: string }) {
  return (
    <button
      onClick={onClick}
      title={children}
      className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] whitespace-nowrap text-gray-400 transition-colors hover:bg-gray-700 hover:text-white"
    >
      {icon} <span className="@max-[400px]:sr-only">{children}</span>
    </button>
  )
}
