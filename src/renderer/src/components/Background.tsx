import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MapPin } from 'lucide-react'
import { useFeed } from '../hooks'
import { homePictures } from './feed/homePictures'

const ROTATE_MS = 60_000

/**
 * still = light interface: one picture, no slow zoom or changes. Only the current picture (and the previous one, while
 * it fades out) is loaded: the others aren't kept in memory.
 */
export default function Background({ dimmed, still }: { dimmed: boolean; still: boolean }) {
  const { t, i18n } = useTranslation()
  const feed = useFeed()
  const list = useMemo(
    () => homePictures(feed?.backgrounds, i18n.language, t),
    [feed?.backgrounds, i18n.language, t],
  )
  const [current, setCurrent] = useState(() => list[Math.floor(Math.random() * list.length)].src)
  const [previous, setPrevious] = useState<string | null>(null)
  const shown = useRef(current)

  // The set changed (a period starts or ends, a picture arrived): stay on the same picture if it is still there
  const index = Math.max(0, list.findIndex((p) => p.src === current))
  useEffect(() => {
    if (!list.some((p) => p.src === current)) setCurrent(list[Math.floor(Math.random() * list.length)].src)
  }, [list, current])
  useEffect(() => {
    if (still) return
    const timer = setInterval(() => setCurrent((c) => list[(list.findIndex((p) => p.src === c) + 1) % list.length].src), ROTATE_MS)
    return () => clearInterval(timer)
  }, [still, list])
  useEffect(() => {
    if (shown.current === current) return
    setPrevious(shown.current)
    shown.current = current
    const done = setTimeout(() => setPrevious(null), 2500) // after the cross-fade
    return () => clearTimeout(done)
  }, [current])

  return (
    <div className="absolute inset-0" aria-hidden>
      {list.map(({ src }) => (
        <div key={src} className={`bg-slide ${src === current ? 'is-active' : ''}`} style={src === current || src === previous ? { backgroundImage: `url("${src}")` } : undefined} />
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
        {list[index].caption}
      </div>
    </div>
  )
}
