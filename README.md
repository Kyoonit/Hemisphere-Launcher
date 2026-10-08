# Hemisphere Launcher

The official launcher for **Hemisphere SMP** (`play.hemispheresurvival.club`).
Electron + React + TypeScript + Tailwind. Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Requirements

- Node.js 24+ and npm 11+
- Windows 10/11

## Run

```bash
npm install
npm run dev        # development window with live reload
npm run build      # typecheck + production build into out/
npm start          # run the production build
npm test           # unit tests
npm run dist       # Windows installer into dist/
```

Publishing a launcher update for players: [docs/RELEASE.md](docs/RELEASE.md).
Updating mods, news or maintenance (no launcher release needed): [docs/CONTENT.md](docs/CONTENT.md).

## Translations

All interface text lives in `locales/<language>.json`. `en.json` is the reference.

- **Edit a text:** change the value in each language file.
- **Add a language:** copy `en.json` to e.g. `de.json`, translate the values, then add it to
  `LANGUAGES` in `src/renderer/src/i18n.ts`.
- **Check for missing translations:** `npm run i18n:check`

## Background pictures

Stored in `src/renderer/src/assets/backgrounds/` and bundled inside the app (players can't change them).
To add one: put the image in that folder, then add it to the list in `src/renderer/src/components/Background.tsx`
and give it a name in the `backgrounds` section of each language file.

## Project layout

```
locales/              all UI text, one file per language
resources/            app icon (runtime)
build/                installer icon
src/main/             Electron main process (window, security, system access)
src/preload/          the small, safe bridge between the UI and the main process
src/shared/           types and IPC channel list used by both sides
src/renderer/         the interface (React)
tools/                maintenance scripts
design/               approved design references (Phase 1–2)
docs/                 architecture and screenshots
```
