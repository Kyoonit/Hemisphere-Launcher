/** Build-time variables (electron-vite, MAIN_VITE_ prefix = main process only). */
interface ImportMetaEnv {
  /** Herald server for this build (default: staging until the production server exists) */
  readonly MAIN_VITE_HERALD_SERVER?: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
