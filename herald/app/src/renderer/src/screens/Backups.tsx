/**
 * Team › Backups: how the automatic backups of Herald's database went (herald/backup: every night, encrypted for the
 * owner's key, kept in the private backups repository on GitHub). Also says on Home when the last good one is too old.
 */
import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { ago, formatWhen } from '../time'

export interface BackupReport {
  at: number
  ok: boolean
  name: string | null
  size: number | null
  sha256: string | null
  url: string | null
  kept: number | null
  error: string | null
}
export interface BackupList {
  lastGood: number | null
  backups: BackupReport[]
}

/** a backup runs every night: a good one older than this means something is wrong */
export const BACKUP_LATE_MS = 36 * 3_600_000

const size = (bytes: number | null) => (bytes === null ? '' : bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)

export function useBackups(): BackupList | null {
  const { can, sync } = useStore()
  const allowed = can('backups.view')
  const [list, setList] = useState<BackupList | null>(null)
  // read again with the rest (sync changes every few minutes at most for this)
  const hour = Math.floor((sync?.now ?? Date.now()) / 3_600_000)
  useEffect(() => {
    if (allowed) void window.herald.api<BackupList>('GET', '/backups').then((r) => r.ok && setList(r.data))
  }, [allowed, hour])
  return allowed ? list : null
}

/** What Home's "Needs attention" says about the backups (nothing when all is well) */
export function backupAttention(list: BackupList | null, now: number): string | null {
  if (!list) return null
  if (!list.backups.length) return 'no backup yet: the backups repository is not set up'
  if (!list.backups[0].ok) return `the last backup failed (${ago(list.backups[0].at, now)})`
  if (list.lastGood !== null && now - list.lastGood > BACKUP_LATE_MS) return `no backup for ${Math.floor((now - list.lastGood) / 3_600_000)} hours`
  return null
}

export default function Backups() {
  const { zone, sync } = useStore()
  const list = useBackups()
  const now = sync?.now ?? Date.now()
  if (!list) return <div className="text-gray-400">Loading…</div>
  const failed = list.backups[0]?.ok === false
  const late = failed || list.lastGood === null || now - list.lastGood > BACKUP_LATE_MS
  return (
    <div>
      <div className={`card mb-4 flex flex-wrap items-center gap-4 ${late ? 'border-amber-400/40 bg-amber-900/25' : ''}`}>
        <span className={`inline-flex items-center gap-2 rounded-full bg-gray-900/75 px-3 py-1.5 text-xs font-bold tracking-wider uppercase ${late ? 'text-amber-400' : 'text-green-400'}`}>
          <i className="size-2 rounded-full bg-current" /> {failed ? 'Last backup failed' : late ? 'Check the backups' : 'Backed up'}
        </span>
        <div className="min-w-0 flex-1 text-sm text-gray-300">
          {list.lastGood === null ? (
            'No backup has been saved yet. The backups repository and its workflow need to be set up (herald/backup/README.md).'
          ) : (
            <>
              {failed && 'The last run failed (see it on GitHub); it tries again tonight, or run it now from the repository’s Actions. '}
              Last good backup <b className="text-white">{ago(list.lastGood, now)}</b> ({formatWhen(list.lastGood, zone)}). One runs every night; each is encrypted for the owner’s key and
              kept on GitHub (30 days, then one a month for a year).
            </>
          )}
        </div>
      </div>
      {list.backups.length > 0 && (
        <div className="card">
          <ul className="divide-y divide-gray-700/60 text-sm">
            {list.backups.map((b) => (
              <li key={b.at} className="flex items-center gap-3 py-2">
                <span className={`size-2 shrink-0 rounded-full ${b.ok ? 'bg-green-400' : 'bg-red-400'}`} />
                <span className="w-44 shrink-0 text-gray-200">{formatWhen(b.at, zone)}</span>
                <span className="min-w-0 flex-1 truncate text-gray-400" title={b.sha256 ? `SHA-256 ${b.sha256}` : undefined}>
                  {b.ok ? `${b.name ?? ''} · ${size(b.size)}${b.kept !== null ? ` · ${b.kept} kept` : ''}` : (b.error ?? 'failed')}
                </span>
                {b.url && (
                  <a href={b.url} target="_blank" rel="noreferrer" className="shrink-0 text-xs font-semibold text-green-400 hover:underline">
                    {b.ok ? 'On GitHub' : 'See the run'}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-3 text-xs text-gray-500">
        To open a backup: download it from GitHub, then <code className="text-gray-300">npm run herald:backup -- decrypt &lt;file&gt; --key &lt;private key&gt;</code> and restore it into a new
        database first (herald/backup/README.md). Cloudflare can also put the database back as it was at any moment of the last days (Time Travel).
      </p>
    </div>
  )
}
