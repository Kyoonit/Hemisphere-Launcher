// Herald app build: npm run herald:build (from the repository root). Everything is bundled (no node_modules in the
// installer): the main process uses Electron, Node and the shared schemas only.
import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Paths from the repository root (the scripts run there; this config is bundled elsewhere before it runs)
const here = (p: string) => resolve('herald/app', p)
const alias = { '@shared': resolve('src/shared'), '@herald': here('src/common'), '@launcher': resolve('src/renderer/src'), '@locales': resolve('locales') }

export default defineConfig({
  main: {
    resolve: { alias },
    build: { externalizeDeps: false, outDir: here('out/main'), rollupOptions: { input: here('src/main/index.ts') } },
  },
  preload: {
    resolve: { alias },
    build: { externalizeDeps: false, outDir: here('out/preload'), rollupOptions: { input: here('src/preload/index.ts') } },
  },
  renderer: {
    root: here('src/renderer'),
    resolve: { alias },
    plugins: [react(), tailwindcss()],
    build: { outDir: here('out/renderer'), rollupOptions: { input: here('src/renderer/index.html') } },
  },
})
