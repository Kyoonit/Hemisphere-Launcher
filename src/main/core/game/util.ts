import type { GameErrorCode } from '@shared/game'

export type ProgressFn = (ratio: number | null, detail?: string) => void

export class GameError extends Error {
  constructor(
    readonly code: GameErrorCode,
    detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code)
  }
}

/** Retries an install step on download errors (already-downloaded files are kept, so a retry resumes). */
export async function withRetries<T>(step: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await step()
    } catch (err) {
      const e = toGameError(err)
      if (e.code === 'disk' || e.code === 'java' || i >= attempts) throw e
      console.warn(`[game] attempt ${i} failed, retrying:`, e.message)
      await new Promise((r) => setTimeout(r, 1500 * i))
    }
  }
}

export async function fetchJson<T>(url: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  } catch (err) {
    throw new GameError('network', `${url}: ${err instanceof Error ? err.message : err}`)
  }
  if (!res.ok) throw new GameError('network', `${url}: HTTP ${res.status}`)
  return (await res.json()) as T
}

/** Maps low-level failures (xmcl, fs, network) to a player-facing error code. */
export function toGameError(err: unknown): GameError {
  if (err instanceof GameError) return err
  // Parallel downloads fail as one AggregateError: classify by its first cause, report a few.
  if (err instanceof AggregateError && err.errors.length) {
    const first = toGameError(err.errors[0])
    const sample = err.errors.slice(0, 3).map((e) => (e instanceof Error ? `${(e as { code?: string }).code ?? e.name}: ${e.message}` : String(e)))
    return new GameError(first.code, `${err.errors.length} file(s) failed — ${sample.join(' | ')}`)
  }
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
  const code = (err as { code?: string } | null)?.code
  if (code === 'ENOSPC' || code === 'EACCES' || code === 'EPERM' || code === 'EBUSY') return new GameError('disk', msg)
  if (/ENOTFOUND|ECONNRESET|ETIMEDOUT|ECONNREFUSED|fetch failed|socket|Download|HTTP/i.test(msg)) return new GameError('network', msg)
  return new GameError('unknown', msg)
}
