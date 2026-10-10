import { useCallback, useEffect, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, ExternalLink, RotateCw, WifiOff } from 'lucide-react'
import { WEB_PAGES, type WebPageKey } from '@shared/webPages'

export type WebFramePhase = 'checking' | 'offline' | 'loading' | 'ready'

/**
 * A web page inside the launcher (shared/webPages.ts; main/security.ts keeps it to its own addresses). First asks
 * whether the page answers (no blank page without internet), then loads it; "doesn't answer" with a retry otherwise.
 * `css` is added to the page each time it loads (to hide parts of it).
 */
export function WebFrame({ page, view, css, onPhase, onLoaded }: { page: WebPageKey; view: RefObject<PageWebview | null>; css?: string; onPhase?(phase: WebFramePhase): void; onLoaded?(): void }) {
  const { t } = useTranslation()
  const [phase, setPhase] = useState<WebFramePhase>('checking')
  useEffect(() => onPhase?.(phase), [phase]) // eslint-disable-line react-hooks/exhaustive-deps

  const check = useCallback(() => {
    setPhase('checking')
    void window.hemisphere.pages.check(page).then((ok) => setPhase(ok ? 'loading' : 'offline'))
  }, [page])
  useEffect(check, [check])

  // the page's events: loaded (its look first), or failed (the connection went away meanwhile)
  const shown = phase === 'loading' || phase === 'ready'
  useEffect(() => {
    const w = view.current
    if (!w || !shown) return
    const styled = () => void (css && w.insertCSS(css).catch(() => {}))
    const loaded = () => {
      setPhase('ready')
      onLoaded?.()
    }
    const failed = (e: Event) => {
      const { errorCode, isMainFrame } = e as Event & { errorCode: number; isMainFrame: boolean }
      // -3: a load replaced by another one (not a failure)
      if (isMainFrame && errorCode !== -3) setPhase('offline')
    }
    w.addEventListener('dom-ready', styled)
    w.addEventListener('did-finish-load', loaded)
    w.addEventListener('did-fail-load', failed)
    return () => {
      w.removeEventListener('dom-ready', styled)
      w.removeEventListener('did-finish-load', loaded)
      w.removeEventListener('did-fail-load', failed)
    }
  }, [shown]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="relative min-w-0 flex-1 overflow-hidden rounded-xl bg-gray-900/70 ring-1 ring-white/10">
      {phase === 'offline' ? (
        <div className="grid h-full place-items-center p-6 text-center">
          <div className="max-w-[44ch]">
            <WifiOff size={30} className="mx-auto mb-3 text-gray-500" />
            <p className="font-semibold text-white">{t('webPage.unreachable')}</p>
            <p className="mt-1 text-[13px] text-gray-400">{t('webPage.unreachableHint')}</p>
            <button onClick={check} className="mt-4 rounded-lg bg-green-600 px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-green-500">
              {t('webPage.retry')}
            </button>
          </div>
        </div>
      ) : (
        <>
          {shown && <webview ref={view} src={WEB_PAGES[page].url} partition={WEB_PAGES[page].partition} className="absolute inset-0 flex" />}
          {phase !== 'ready' && <div className="absolute inset-0 grid place-items-center bg-gray-900/80 text-[13px] text-gray-400">{t('webPage.loading')}</div>}
        </>
      )}
    </div>
  )
}

/** Back to Home, the page's name, reload (once loaded) and the same page in the browser */
export function WebPageHeader({ title, ready, onBack, onReload, onOpenInBrowser }: { title: string; ready: boolean; onBack(): void; onReload(): void; onOpenInBrowser(): void }) {
  const { t } = useTranslation()
  return (
    <div className="mb-3 flex flex-none items-center gap-3">
      <button onClick={onBack} className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-gray-400 transition-colors hover:bg-gray-700 hover:text-white">
        <ArrowLeft size={14} /> {t('webPage.back')}
      </button>
      <h1 className="text-[22px] font-bold text-white uppercase">{title}</h1>
      <div className="ml-auto flex gap-2">
        {ready && (
          <button onClick={onReload} title={t('webPage.reload')} aria-label={t('webPage.reload')} className="grid size-9 place-items-center rounded-lg bg-gray-800/75 text-gray-300 transition-colors hover:bg-gray-700 hover:text-white">
            <RotateCw size={16} />
          </button>
        )}
        <button onClick={onOpenInBrowser} className="flex items-center gap-2 rounded-lg bg-gray-800/75 px-3.5 py-2 text-[13px] font-semibold text-gray-200 transition-colors hover:bg-gray-700 hover:text-white">
          <ExternalLink size={15} /> {t('webPage.openInBrowser')}
        </button>
      </div>
    </div>
  )
}
