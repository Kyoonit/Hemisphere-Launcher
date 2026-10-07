/** Launcher settings shared by main and renderer. More are added in Phase 13. */
export interface Settings {
  /** Connect to Hemisphere straight from the title screen (latest client only) */
  autoJoin: boolean
  /** What the launcher window does once Minecraft has started */
  onGameStart: 'hide' | 'keep' | 'close'
  /** 'auto' follows Windows */
  language: string
}

export const DEFAULT_SETTINGS: Settings = {
  autoJoin: false,
  onGameStart: 'hide',
  language: 'auto',
}
