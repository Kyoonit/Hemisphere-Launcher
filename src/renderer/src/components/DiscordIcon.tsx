/** Simplified Discord mark (lucide has no brand icons). */
export default function DiscordIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" aria-hidden>
      <path d="M8 5.5c2.6-.7 5.4-.7 8 0l1.4 1c1.4 2.4 2.1 5 2.1 7.9-1.5 1.3-3.2 2.1-5 2.6l-.9-1.7c-1.7.4-3.5.4-5.2 0l-.9 1.7c-1.8-.5-3.5-1.3-5-2.6 0-2.9.7-5.5 2.1-7.9z" />
      <circle cx="9.5" cy="11.5" r="1" fill="currentColor" />
      <circle cx="14.5" cy="11.5" r="1" fill="currentColor" />
    </svg>
  )
}
