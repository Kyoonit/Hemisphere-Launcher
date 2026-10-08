import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { LoaderCircle, Trash2 } from 'lucide-react'

/** A confirmation box over the whole launcher (deleting a restore point, a mod set…). Esc or a click outside cancels. */
export default function ConfirmDialog({
  title,
  children,
  confirmLabel,
  busy = false,
  onConfirm,
  onCancel,
}: {
  title: string
  children: React.ReactNode
  confirmLabel: string
  busy?: boolean
  onConfirm(): void
  onCancel(): void
}) {
  const { t } = useTranslation()
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    cancelRef.current?.focus()
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        e.stopPropagation()
        onCancel()
      }
    }
    document.addEventListener('keydown', key, true)
    return () => document.removeEventListener('keydown', key, true)
  }, [busy, onCancel])

  return (
    <div className="animate-fade fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" className="w-full max-w-[440px] rounded-xl bg-gray-900 p-5 shadow-2xl ring-1 ring-gray-700">
        <h2 id="confirm-title" className="mb-2 text-lg font-bold text-white">
          {title}
        </h2>
        <div className="text-[13.5px] text-gray-300">{children}</div>
        <div className="mt-5 flex justify-end gap-2">
          <button ref={cancelRef} onClick={onCancel} disabled={busy} className="rounded-lg px-4 py-2 text-sm font-semibold text-gray-300 transition-colors hover:bg-gray-700 hover:text-white disabled:opacity-50">
            {t('browse.cancel')}
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-md transition-colors hover:bg-red-500 disabled:opacity-60"
          >
            {busy ? <LoaderCircle size={15} className="animate-spin" /> : <Trash2 size={15} />} {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
