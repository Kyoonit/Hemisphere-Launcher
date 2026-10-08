/** Settings > Installation > Free up space: what the launcher can safely remove. Worlds, screenshots, mods and settings are never touched. */
export const CLEANUP_CATEGORIES = ['logs', 'crashes', 'downloads', 'versions'] as const
export type CleanupCategory = (typeof CLEANUP_CATEGORIES)[number]

export interface CleanupScan {
  /** per category: how many files/folders and how many bytes */
  categories: Record<CleanupCategory, { items: number; bytes: number }>
  totalBytes: number
}
