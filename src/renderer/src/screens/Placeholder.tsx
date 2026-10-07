import { useTranslation } from 'react-i18next'
import { Newspaper } from 'lucide-react'

export default function Placeholder({ kind }: { kind: 'news' }) {
  const { t } = useTranslation()
  const Icon = Newspaper

  return (
    <div className="grid h-full place-items-center p-8">
      <div className="glass flex w-[420px] flex-col items-center px-8 py-10 text-center">
        <span className="grid h-14 w-14 place-items-center rounded-full bg-gray-700/80 text-green-400">
          <Icon size={26} />
        </span>
        <p className="mt-4 text-xs font-bold tracking-[0.08em] text-green-400 uppercase">{t('placeholder.comingSoon')}</p>
        <h2 className="mt-1 text-[26px] font-bold text-white uppercase">{t(`nav.${kind}`)}</h2>
        <p className="mt-2 text-gray-400">{t(`placeholder.${kind}`)}</p>
      </div>
    </div>
  )
}
