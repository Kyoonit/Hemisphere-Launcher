/** Build-time variables injected by electron-vite from .env files (MAIN_VITE_ prefix = main process only). */
interface ImportMetaEnv {
  readonly MAIN_VITE_MS_CLIENT_ID?: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
