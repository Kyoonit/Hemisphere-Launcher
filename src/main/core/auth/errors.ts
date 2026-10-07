import type { AuthErrorCode } from '@shared/auth'

export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code)
  }
}

export function toAuthCode(err: unknown): AuthErrorCode {
  if (err instanceof AuthError) return err.code
  if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError' || /fetch failed|ENOTFOUND|ECONN/i.test(err.message)))
    return 'network'
  return 'unknown'
}

/** POST/GET JSON with timeout. Throws AuthError('network') on transport failure. */
export async function requestJson(url: string, init: RequestInit & { timeoutMs?: number }): Promise<{ status: number; body: unknown }> {
  let res: Response
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(init.timeoutMs ?? 15_000) })
  } catch (err) {
    throw new AuthError('network', err instanceof Error ? err.message : String(err))
  }
  const text = await res.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return { status: res.status, body }
}
