import { useEffect, useState } from 'react'
import type { LauncherUpdateState } from '@shared/launcherUpdate'

/** Live state of the launcher's own update (pushed by the main process). */
export function useLauncherUpdate(): LauncherUpdateState | null {
  const [state, setState] = useState<LauncherUpdateState | null>(null)
  useEffect(() => {
    window.hemisphere.launcherUpdate.get().then(setState)
    return window.hemisphere.launcherUpdate.onChange(setState)
  }, [])
  return state
}
