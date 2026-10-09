/** Every version of a setting Herald edits (S11): who changed it, when, what it was; optionally load one back. */
import { useEffect, useState, type ReactNode } from 'react'
import { useStore } from '../store'
import { Avatar, Modal } from './ui'
import { formatWhen } from '../time'

export interface SettingVersion<T> {
  id: number
  at: number
  action: string
  who: string | null
  value: T
}

export function SettingHistory<T>({ setting, title, describe, onLoad, onClose }: { setting: 'backgrounds' | 'public' | 'templates.publications'; title: string; describe(value: T, previous: T | null, action: string): ReactNode; onLoad?(value: T): void; onClose(): void }) {
  const { zone } = useStore()
  const [versions, setVersions] = useState<SettingVersion<T>[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    void window.herald.api<{ versions: SettingVersion<T>[] }>('GET', `/settings/history/${setting}`).then((r) => (r.ok ? setVersions(r.data.versions) : setError(r.error)))
  }, [setting])
  return (
    <Modal title={title} onClose={onClose}>
      <div className="-mx-1 max-h-[60vh] overflow-auto px-1">
        {error && <p className="text-sm text-red-300">{error}</p>}
        {versions?.length === 0 && <p className="text-sm text-gray-400">No change yet.</p>}
        {versions?.map((v, i) => (
          <div key={v.id} className="border-t border-gray-700/50 py-2 text-sm first:border-0">
            <div className="flex items-center gap-2">
              <Avatar name={v.who ?? '?'} size={20} />
              <b className="text-white">{v.who ?? 'Someone'}</b>
              <span className="ml-auto text-xs text-gray-400">{formatWhen(v.at, zone)}</span>
            </div>
            <div className="mt-1 text-gray-300">{describe(v.value, versions[i + 1]?.value ?? null, v.action)}</div>
            {onLoad && i > 0 && (
              <button className="mt-1 text-xs text-green-400 hover:underline" onClick={() => (onLoad(v.value), onClose())}>
                Load this version (then publish it)
              </button>
            )}
          </div>
        ))}
        {versions === null && !error && <p className="text-sm text-gray-400">Loading…</p>}
      </div>
      <p className="mt-3 text-xs text-gray-500">Every version is kept for good.</p>
    </Modal>
  )
}
