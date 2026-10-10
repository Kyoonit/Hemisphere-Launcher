import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, Plus, Settings, TriangleAlert } from 'lucide-react'
import { headUrl, useAccounts } from '../accounts'

interface Props {
  onAddAccount(): void
  onManage(): void
}

/** Title-bar account chip with instant switching. */
export default function AccountMenu({ onAddAccount, onManage }: Props) {
  const { t } = useTranslation()
  const { state, active } = useAccounts()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => ref.current?.contains(e.target as Node) || setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  if (!state || !active) return null

  return (
    <div ref={ref} data-tour="account" className="no-drag relative mr-2">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-2 rounded-lg py-[5px] pr-2.5 pl-[5px] transition-colors duration-150 hover:bg-gray-700"
      >
        <img src={headUrl(active.id, 52)} alt="" className="h-[26px] w-[26px] rounded [image-rendering:pixelated]" draggable={false} />
        <b className="max-w-[130px] truncate text-[13px] font-semibold text-white max-[1100px]:max-w-[90px]">{active.name}</b>
        {active.status === 'expired' && <TriangleAlert size={14} className="text-amber-400" />}
        <ChevronDown size={14} className={`text-gray-400 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="animate-rise absolute top-12 right-0 z-30 w-[260px] rounded-lg border border-white/5 bg-gray-800 p-2 shadow-xl [animation-duration:200ms]">
          <p className="px-2 pt-1 pb-1.5 text-xs font-bold tracking-[0.08em] text-gray-400 uppercase">{t('auth.accounts')}</p>
          {state.accounts.map((a) => (
            <MenuItem
              key={a.id}
              icon={<img src={headUrl(a.id, 60)} alt="" className="h-[30px] w-[30px] rounded [image-rendering:pixelated]" />}
              title={a.name}
              subtitle={a.status === 'expired' ? t('auth.expired') : a.kind === 'offline' ? t('auth.dev.badge') : t('auth.microsoftAccount')}
              trailing={a.id === state.activeId ? <Check size={18} className="text-green-400" /> : null}
              onClick={() => {
                setOpen(false)
                if (a.id !== state.activeId) window.hemisphere.auth.switchTo(a.id)
              }}
            />
          ))}
          <div className="my-1.5 h-px bg-white/10" />
          <MenuItem icon={<Plus size={16} />} title={t('auth.addAccount')} onClick={() => (setOpen(false), onAddAccount())} />
          <MenuItem icon={<Settings size={16} />} title={t('auth.manage')} onClick={() => (setOpen(false), onManage())} />
        </div>
      )}
    </div>
  )
}

function MenuItem(props: { icon: React.ReactNode; title: string; subtitle?: string; trailing?: React.ReactNode; onClick(): void }) {
  return (
    <button onClick={props.onClick} className="flex w-full items-center gap-2.5 rounded-lg p-2 text-left transition-colors duration-150 hover:bg-gray-700">
      <span className="grid h-[30px] w-[30px] flex-none place-items-center rounded bg-gray-700 text-gray-300">{props.icon}</span>
      <span className="min-w-0 flex-1">
        <b className="block truncate text-[13.5px] font-semibold text-white">{props.title}</b>
        {props.subtitle && <span className="text-xs text-gray-400">{props.subtitle}</span>}
      </span>
      {props.trailing}
    </button>
  )
}
