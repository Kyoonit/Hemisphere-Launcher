import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MapPin } from 'lucide-react'
import kingdom from '../assets/backgrounds/kingdom.webp'
import hempshire from '../assets/backgrounds/hempshire.avif'
import playerBases from '../assets/backgrounds/player-bases.webp'
import community from '../assets/backgrounds/community.avif'

/** Bundled inside the app (not editable on disk). Add a picture: import it and append it here. */
const BACKGROUNDS = [
  { src: kingdom, name: 'backgrounds.kingdom' },
  { src: hempshire, name: 'backgrounds.hempshire' },
  { src: playerBases, name: 'backgrounds.playerBases' },
  { src: community, name: 'backgrounds.community' },
]
const ROTATE_MS = 60_000

/**
 * still = light interface: one picture, no slow zoom or changes. Only the current picture (and the previous one, while
 * it fades out) is loaded: the others aren't kept in memory.
 */
export default function Background({ dimmed, still }: { dimmed: boolean; still: boolean }) {
  const { t } = useTranslation()
  const [index, setIndex] = useState(() => Math.floor(Math.random() * BACKGROUNDS.length))
  const [previous, setPrevious] = useState<number | null>(null)
  const current = useRef(index)

  useEffect(() => {
    if (still) return
    const timer = setInterval(() => setIndex((i) => (i + 1) % BACKGROUNDS.length), ROTATE_MS)
    return () => clearInterval(timer)
  }, [still])
  useEffect(() => {
    if (current.current === index) return
    setPrevious(current.current)
    current.current = index
    const done = setTimeout(() => setPrevious(null), 2500) // after the cross-fade
    return () => clearTimeout(done)
  }, [index])

  return (
    <div className="absolute inset-0" aria-hidden>
      {BACKGROUNDS.map((bg, i) => (
        <div
          key={bg.src}
          className={`bg-slide ${i === index ? 'is-active' : ''}`}
          style={i === index || i === previous ? { backgroundImage: `url(${bg.src})` } : undefined}
        />
      ))}
      {/* Gradient always there; the dark layer for other screens fades in/out the same way in both directions
          (a gradient can't be animated into a plain colour: switching it directly gave a one-way fade). */}
      <div className="absolute inset-0 bg-gradient-to-b from-gray-900/75 via-gray-800/60 to-gray-900/95" />
      <div className={`absolute inset-0 bg-gray-900/95 transition-opacity duration-200 ${dimmed ? 'opacity-100' : 'opacity-0'}`} />
      <div
        className={`absolute top-[66px] left-5 flex items-center gap-1.5 text-xs text-white/55 transition-opacity duration-200 ${
          dimmed ? 'opacity-0' : 'opacity-100'
        }`}
      >
        <MapPin size={13} />
        {t(BACKGROUNDS[index].name)}
      </div>
    </div>
  )
}
