/** Build-time variables injected by electron-vite from .env files (MAIN_VITE_ prefix = main process only). */
interface ImportMetaEnv {
  readonly MAIN_VITE_MS_CLIENT_ID?: string
  /** Dev builds only: alternative content location for testing */
  readonly MAIN_VITE_CONTENT_BASE?: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
