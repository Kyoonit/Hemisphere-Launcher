/** Home's pictures (shared with Herald's preview): the built-in ones and the team's, by period (Herald). */
import { localize } from '@shared/manifest'
import type { FeedView } from '@shared/schedule'
import kingdom from '../../assets/backgrounds/kingdom.webp'
import hempshire from '../../assets/backgrounds/hempshire.avif'
import playerBases from '../../assets/backgrounds/player-bases.webp'
import community from '../../assets/backgrounds/community.avif'

/** Bundled inside the app (not editable on disk). Add a picture: import it and append it here. */
export const BUILT_IN_BACKGROUNDS = [
  { src: kingdom, name: 'backgrounds.kingdom' },
  { src: hempshire, name: 'backgrounds.hempshire' },
  { src: playerBases, name: 'backgrounds.playerBases' },
  { src: community, name: 'backgrounds.community' },
]

export interface HomePicture {
  src: string
  caption: string
}

/**
 * The pictures Home shows: the team's (Herald, by period) with the built-in ones, or only the team's during a period
 * set to "only these pictures". A picture not downloaded yet is left out; with none at all, the built-in ones show.
 */
export function homePictures(backgrounds: FeedView['backgrounds'], lang: string, t: (key: string) => string): HomePicture[] {
  const remote = (backgrounds?.items ?? []).flatMap((b) => (b.src ? [{ src: b.src, caption: localize(b.name, lang) }] : []))
  if (backgrounds?.mode === 'replace' && remote.length) return remote
  return [...BUILT_IN_BACKGROUNDS.map((b) => ({ src: b.src, caption: t(b.name) })), ...remote]
}
