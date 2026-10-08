import type { ModSetInfo } from '@shared/modSets'

/** One line about a preset: its mods, and (saved since packs) its resource packs and shader. */
export function presetDetails(s: ModSetInfo, t: (k: string, o?: Record<string, unknown>) => string): string {
  const parts = [t('sets.counts', { count: s.mods, on: s.enabled })]
  if (s.packs !== null) parts.push(t('sets.packsPart', { count: s.packs }))
  if (s.shader !== null) parts.push(s.shader ? t('sets.shaderPart', { name: s.shader }) : t('sets.shaderNone'))
  return parts.join(' · ')
}
