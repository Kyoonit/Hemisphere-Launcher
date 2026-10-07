import type { PlaytimeSummary, ServerStatus } from './server'

/** IPC contract shared by main, preload and renderer. Every channel is listed here. */

export const IPC = {
  windowMinimize: 'window:minimize',
  windowToggleMaximize: 'window:toggle-maximize',
  windowClose: 'window:close',
  windowMaximizedChanged: 'window:maximized-changed',
  openLink: 'link:open',
  appInfo: 'app:info',
  serverStatusGet: 'server:status:get',
  serverStatusUpdate: 'server:status:update',
  playtimeGet: 'playtime:get',
} as const

/** External links the renderer may open. The renderer sends a key, never a URL. */
export const LINKS = {
  discord: 'https://discord.gg/m3FGGUF',
  website: 'https://hemispheresurvival.club/',
  map: 'http://play.hemispheresurvival.club:9090/',
  rules: 'https://hemispheresurvival.club/rules',
  getMinecraft: 'https://www.minecraft.net/store/minecraft-java-bedrock-edition-pc',
} as const

export type LinkKey = keyof typeof LINKS

export interface AppInfo {
  version: string
  platform: string
}

/** API exposed on `window.hemisphere` by the preload script. */
export interface HemisphereApi {
  window: {
    minimize(): void
    toggleMaximize(): void
    close(): void
    onMaximizedChange(cb: (maximized: boolean) => void): () => void
  }
  openLink(key: LinkKey): void
  appInfo(): Promise<AppInfo>
  server: {
    getStatus(): Promise<ServerStatus>
    onStatus(cb: (status: ServerStatus) => void): () => void
  }
  playtime: {
    get(): Promise<PlaytimeSummary>
  }
}
