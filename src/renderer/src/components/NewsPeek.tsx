import type { Feed } from '@shared/feed'
import { NewsPeekCard } from './feed/NewsCards'

/** Latest post on Home. Hidden when there's no news yet (offline first run). */
export default function NewsPeek({ feed, onOpen }: { feed: Feed | null; onOpen(): void }) {
  const latest = feed?.news[0]
  if (!latest) return null
  return <NewsPeekCard item={latest} onOpen={onOpen} />
}
