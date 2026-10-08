import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Lock, TriangleAlert } from 'lucide-react'
import type { AuthErrorCode } from '@shared/auth'
import type { LinkKey } from '@shared/ipc'
import { useAccounts } from '../accounts'
import logo from '../assets/logo.png'

/** What the player can do about each error (a link), if anything. */
const ERROR_ACTION: Partial<Record<AuthErrorCode, LinkKey>> = {
  notOwned: 'getMinecraft',
  noXboxProfile: 'xboxProfile',
  childAccount: 'microsoftFamily',
}

export default function Login({ onBack }: { onBack?: () => void }) {
  // hidden staff access (see StaffCode)
  const [staffOpen, setStaffOpen] = useState(false)
  const taps = useRef<number[]>([])
  const tapLock = () => {
    const now = Date.now()
    taps.current = [...taps.current.filter((t) => now - t < 3000), now]
    if (taps.current.length >= 5) {
      taps.current = []
      setStaffOpen(true)
    }
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyS') setStaffOpen((o) => !o)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const { t, i18n } = useTranslation()
  const { state } = useAccounts()
  const [waiting, setWaiting] = useState(false)
  const [error, setError] = useState<AuthErrorCode | null>(null)

  const signIn = async () => {
    setError(null)
    setWaiting(true)
    const result = await window.hemisphere.auth.signIn(i18n.language)
    setWaiting(false)
    if (result.ok) onBack?.()
    else if (result.code !== 'cancelled') setError(result.code)
  }

  const action = error ? ERROR_ACTION[error] : undefined

  return (
    // Centred when it fits; scrolls when an error message makes it taller than a small window.
    <div className="h-full overflow-x-hidden overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-6">
        <div className="glass animate-rise relative w-[420px] px-9 pt-9 pb-7 text-center">
          {onBack && !waiting && (
            <button
              onClick={onBack}
              className="absolute top-4 left-4 flex items-center gap-1 rounded-md px-2 py-1 text-[13px] text-gray-400 transition-colors hover:bg-gray-700 hover:text-white"
            >
              <ArrowLeft size={14} /> {t('auth.back')}
            </button>
          )}
          <img src={logo} alt="" className="mx-auto mb-3.5 h-16 w-16 drop-shadow-[0_4px_12px_rgba(0,0,0,0.5)]" draggable={false} />
          <p className="mb-1.5 text-xs font-bold tracking-[0.08em] text-green-400 uppercase">{t('home.welcomeTo')}</p>
          <h1 className="text-[38px] leading-[1.05] font-bold text-green-400 uppercase drop-shadow-lg">{t('app.name')}</h1>
          <p className="mt-3 text-gray-400">{t('auth.intro')}</p>

          {error && (
            <div className="animate-fade mt-5 flex gap-3 rounded-lg border-l-[3px] border-red-400 bg-red-900/35 px-3.5 py-3 text-left text-[13px]">
              <TriangleAlert size={16} className="mt-0.5 flex-none text-red-400" />
              <div>
                <b className="block text-white">{t(`auth.errors.${error}.title`)}</b>
                <span className="text-gray-300">{t(`auth.errors.${error}.body`)}</span>
                {action && (
                  <button onClick={() => window.hemisphere.openLink(action)} className="mt-1 block font-semibold text-green-400 hover:text-green-300">
                    {t(`auth.errors.${error}.action`)} ↗
                  </button>
                )}
              </div>
            </div>
          )}

          {waiting ? (
            <div className="mt-6">
              <div className="flex w-full items-center justify-center gap-3 rounded-lg bg-gray-900/70 p-[13px] font-semibold text-white">
                <span className="h-[18px] w-[18px] animate-spin rounded-full border-2 border-white/20 border-t-green-400" />
                {t('auth.waiting')}
              </div>
              <p className="mt-2.5 text-xs text-gray-400">{t('auth.waitingHint')}</p>
              <button onClick={() => window.hemisphere.auth.cancel()} className="mt-2 text-[13px] text-gray-400 underline-offset-2 hover:text-white hover:underline">
                {t('auth.cancel')}
              </button>
            </div>
          ) : (
            <button
              onClick={signIn}
              disabled={!state?.microsoftConfigured}
              title={state?.microsoftConfigured ? undefined : t('auth.notConfiguredHint')}
              className="mt-6 flex w-full items-center justify-center gap-3 rounded-lg bg-white p-[13px] text-[15px] font-semibold text-gray-800 transition-all duration-300 hover:-translate-y-px hover:bg-gray-100 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
            >
              <MicrosoftLogo />
              {t('auth.signIn')}
            </button>
          )}

          <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-gray-400">
            <Lock size={13} className="text-green-400" onClick={tapLock} />
            {t('auth.passwordNote')}
          </p>

          <div className="mt-5 border-t border-white/10 pt-4 text-xs text-gray-400">
            {t('auth.noMinecraft')}{' '}
            <button onClick={() => window.hemisphere.openLink('getMinecraft')} className="font-semibold text-green-400 hover:text-green-300">
              {t('auth.getMinecraft')} ↗
            </button>
          </div>

          {staffOpen && !state?.devOfflineAllowed && !waiting && <StaffCode onClose={() => setStaffOpen(false)} />}
          {state?.devOfflineAllowed && !waiting && <DevOffline onDone={onBack} />}
        </div>
      </div>
    </div>
  )
}

/**
 * Staff access, hidden on purpose: Ctrl+Shift+S, or 5 quick clicks on the padlock. The staff code (checked in the main
 * process, slowed down after wrong tries) unlocks the offline test account below and the Developer tab, on this PC.
 */
function StaffCode({ onClose }: { onClose(): void }) {
  const { t } = useTranslation()
  const [code, setCode] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  return (
    <form
      className="animate-fade mt-4 flex gap-2"
      onSubmit={async (e) => {
        e.preventDefault()
        const r = await window.hemisphere.dev.unlock(code)
        if (r.ok) return onClose()
        setCode('')
        setMessage(r.reason === 'wait' ? t('auth.staff.wait', { seconds: r.seconds ?? 30 }) : t('auth.staff.wrong'))
      }}
    >
      <input
        autoFocus
        type="password"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
        placeholder={message ?? t('auth.staff.placeholder')}
        aria-label={t('auth.staff.placeholder')}
        className={`min-w-0 flex-1 rounded-lg border bg-gray-900 px-3 py-1.5 text-sm text-white ${message ? 'border-red-500/60 placeholder:text-red-300' : 'border-gray-700'}`}
      />
      <button disabled={!code} className="rounded-lg bg-gray-700 px-3 text-sm font-semibold text-white hover:bg-gray-600 disabled:opacity-40">
        OK
      </button>
    </form>
  )
}

/** Development builds, or staff on this PC: an offline account to test the launcher before Microsoft approves the app. */
function DevOffline({ onDone }: { onDone?: () => void }) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const valid = /^[A-Za-z0-9_]{3,16}$/.test(name)

  return (
    <form
      className="mt-4 rounded-lg border border-dashed border-amber-400/40 bg-amber-900/15 p-3 text-left"
      onSubmit={async (e) => {
        e.preventDefault()
        if (valid && (await window.hemisphere.auth.addDevOffline(name)).ok) onDone?.()
      }}
    >
      <p className="mb-2 text-[11px] font-bold tracking-[0.08em] text-amber-400 uppercase">{t('auth.dev.title')}</p>
      <p className="mb-2 text-[11.5px] text-amber-100/70">{t('auth.dev.hint')}</p>
      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('auth.dev.placeholder')}
          aria-label={t('auth.dev.placeholder')}
          maxLength={16}
          className="min-w-0 flex-1 rounded-lg border border-gray-700 bg-gray-900 px-3 py-1.5 text-sm text-white"
        />
        <button disabled={!valid} className="rounded-lg bg-gray-700 px-3 text-sm font-semibold text-white hover:bg-gray-600 disabled:opacity-40">
          {t('auth.dev.use')}
        </button>
      </div>
    </form>
  )
}

function MicrosoftLogo() {
  return (
    <span className="grid grid-cols-[9px_9px] gap-[2px]" aria-hidden>
      <i className="h-[9px] w-[9px] bg-[#f25022]" />
      <i className="h-[9px] w-[9px] bg-[#7fba00]" />
      <i className="h-[9px] w-[9px] bg-[#00a4ef]" />
      <i className="h-[9px] w-[9px] bg-[#ffb900]" />
    </span>
  )
}
