/** Screenshots page (Phase 25). */
export interface Screenshot {
  /** file name in instance/screenshots */
  name: string
  /** when it was taken (ms) */
  takenAt: number
  size: number
  /** changes when the file changes (cache key for the thumbnail) */
  version: number
}

export interface ScreenshotList {
  screenshots: Screenshot[]
  totalBytes: number
}

/** Image URLs served by the launcher (only files from the screenshots folder). */
export const screenshotUrl = (kind: 'thumb' | 'full', s: Screenshot) => `hemi-shot://${kind}/${encodeURIComponent(s.name)}?v=${s.version}`
