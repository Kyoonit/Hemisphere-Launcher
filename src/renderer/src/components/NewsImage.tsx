import { useState } from 'react'
import fallback from '../assets/backgrounds/hempshire.avif'

/** News picture; uses a bundled Hemisphere screenshot when there is none or it can't load (offline). */
export default function NewsImage({ src, className = '' }: { src?: string; className?: string }) {
  const [failed, setFailed] = useState(false)
  return (
    <img
      src={src && !failed ? src : fallback}
      onError={() => setFailed(true)}
      alt=""
      loading="lazy"
      draggable={false}
      className={`bg-gray-800 object-cover ${className}`}
    />
  )
}
