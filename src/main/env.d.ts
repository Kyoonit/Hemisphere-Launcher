/** Build-time variables injected by electron-vite from .env files (MAIN_VITE_ prefix = main process only). */
interface ImportMetaEnv {
  readonly MAIN_VITE_MS_CLIENT_ID?: string
  /** Dev builds only: alternative content location for testing */
  readonly MAIN_VITE_CONTENT_BASE?: string
  /** Dev builds only: Herald TEST environment for the schema 2 feed (server, content, public key); see herald/README.md */
  readonly MAIN_VITE_HERALD_URL?: string
  readonly MAIN_VITE_HERALD_CONTENT_BASE?: string
  readonly MAIN_VITE_HERALD_PUBLIC_KEY?: string
  /** Dev builds only: a stand-in for Mojang's session server (catalogue tests against a local Herald) */
  readonly MAIN_VITE_MOJANG_SESSION?: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
