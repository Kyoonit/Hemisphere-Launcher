import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ClipboardCopy, FileWarning, PackageX, RotateCcw, Wrench, X } from 'lucide-react'
import DiscordIcon from './DiscordIcon'

/** "Minecraft couldn't start": likely cause + one-click fixes (approved Error wireframe). */
export default function CrashCard({ suspects, onRepair }: { suspects: string[]; onRepair(): void }) {
  const { t } = useTranslation()
  const [ownMods, setOwnMods] = useState<number>(0)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    window.hemisphere.client.playerMods().then((m) => setOwnMods(m.filter((x) => x.enabled).length))
  }, [])

  return (
    <div className="glass animate-fade w-[480px] max-w-[calc(100vw-540px)] px-5 py-4 text-left" role="alert">
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-red-600/20 text-red-400">
          <X size={18} />
        </span>
        <div>
          <b className="block text-white">{t('crash.title')}</b>
          <span className="text-[13px] text-gray-400">{t('crash.subtitle')}</span>
        </div>
      </div>

      {(ownMods > 0 || suspects.length > 0) && (
        <p className="mt-3 rounded-lg border-l-[3px] border-amber-400 bg-gray-900/65 px-3 py-2 text-[13px] text-gray-300">
          {ownMods > 0 ? t('crash.causeOwnMods', { count: ownMods }) : t('crash.causeMods')}
          {suspects.length > 0 && <span className="mt-0.5 block text-xs text-gray-400">{t('crash.mentioned', { mods: suspects.join(', ') })}</span>}
        </p>
      )}

      <div className="mt-3.5 flex flex-wrap gap-2">
        {ownMods > 0 && (
          <button
            onClick={() => window.hemisphere.game.play({ target: 'latest', withoutPlayerMods: true })}
            className="flex items-center gap-2 rounded-lg bg-green-600 px-3.5 py-2 text-sm font-semibold text-white shadow-md transition-colors hover:bg-green-500"
          >
            <PackageX size={15} /> {t('crash.withoutMyMods')}
          </button>
        )}
        <button onClick={onRepair} className="flex items-center gap-2 rounded-lg bg-gray-700/85 px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-gray-600">
          <Wrench size={15} /> {t('repair.short')}
        </button>
        <button onClick={() => window.hemisphere.game.play()} className="flex items-center gap-2 rounded-lg bg-gray-700/85 px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-gray-600">
          <RotateCcw size={15} /> {t('game.retry')}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1 border-t border-white/10 pt-2.5">
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
        <LinkButton onClick={() => window.hemisphere.openLink('discord')} icon={<DiscordIcon size={14} />}>
          {t('crash.help')}
        </LinkButton>
      </div>
    </div>
  )
}

function LinkButton({ onClick, icon, children }: { onClick(): void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-gray-400 transition-colors hover:bg-gray-700 hover:text-white">
      {icon} {children}
    </button>
  )
}
