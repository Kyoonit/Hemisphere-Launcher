// The launcher's own account: its skin for the views (SkinView itself works anywhere, Herald too)
import { useEffect, useState } from 'react'
import type { SkinInfo } from '@shared/skins'
import { useAccounts } from '../../accounts'

/** The active account's skin (null while loading or without an account); `refresh` asks Mojang again. */
export function useActiveSkin(): { skin: SkinInfo | null; refresh(): void } {
  const { state } = useAccounts()
  const id = state?.activeId ?? null
  const [skin, setSkin] = useState<SkinInfo | null>(null)
  const load = (refresh = false) => void window.hemisphere.skins.get(id ?? undefined, refresh).then((s) => setSkin(s && s.id === id ? s : null))
  useEffect(() => {
    setSkin(null)
    if (!id) return
    load()
    // a skin or cape put on from the wardrobe
    return window.hemisphere.skins.onChange((changed) => changed === id && load())
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  return { skin, refresh: () => load(true) }
}

/** Home's button opens Settings > Account and brings the viewer into view (once). */
let focusViewer = false
export const requestSkinViewer = () => (focusViewer = true)
export const takeSkinViewerRequest = () => {
  const asked = focusViewer
  focusViewer = false
  return asked
}
