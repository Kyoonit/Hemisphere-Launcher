# Releasing the launcher

Players install the launcher once with `Hemisphere-Launcher-Setup-<version>.exe`. After that it **updates itself** from
this repository's GitHub releases. Hemisphere's mods and news don't need a launcher release: they update through
`content/` (see [CONTENT.md](CONTENT.md)).

## Before the first public release

| | Why |
|---|---|
| **Microsoft sign-in set up** ([MICROSOFT_AUTH.md](MICROSOFT_AUTH.md)): `.env` with `MAIN_VITE_MS_CLIENT_ID`, and Minecraft API access approved | The client ID is built into the installer. Without it, nobody can sign in. |
| **Version number** in `package.json` (e.g. `1.0.0`) | Each release needs a higher version than the last, or launchers won't update. |
| **Repository stays public** | Installed launchers download updates from its releases without a token. |

## Build an installer (local test)

```bash
npm run dist
```

This makes `dist/Hemisphere-Launcher-Setup-<version>.exe` (about 115 MB). Run it to install: no admin rights are needed. It installs for the current Windows user, with desktop and Start menu shortcuts. Uninstalling keeps accounts, settings and the game, so a reinstall is instant.

While it installs, the Setup shows Hemisphere's own window (artwork, logo, green progress bar) instead of NSIS's small box: `build/installer.nsh` starts the `HemiSplash` plugin (`build/x86-unicode/HemiSplash.dll`, background `build/installerSplash.bmp`). Silent installs (launcher updates) show nothing. To change it, edit `tools/installer-splash/HemiSplash.c` and run `tools/installer-splash/build.sh` from WSL (needs ImageMagick and Zig: `python3 -m pip install ziglang`), then commit the rebuilt DLL and picture.

## Launcher history and "What's new" (required for every release)

**The version only changes with a release**: 1.0.19 (the first one), then **1.1, 1.2…** (`1.1.0`, `1.2.0` in
`package.json`). The launcher's history lives in `src/shared/launcherChangelog.json`: **one entry per day**, newest
first; each change has an area (play, home, content, screenshots, community, settings, performance, launcher), its
English and French text, and the release that brought it, or **`"next"`** until the next release. Players see it in
**News > Launcher updates**, and the last 2 days in the **What's new** card on Home (at every start, until closed),
never the `"next"` changes (development builds show them).

- With each push: add its changes to today's entry with `"version": "next"` (a new day = a new entry at the top).
  `package.json` doesn't change.
- `npm run release` gives the `"next"` changes the new version, and **refuses to publish** when there's nothing new.

## Publish a release (players get it automatically)

1. Create a GitHub token: fine-grained, **Contents: read and write** on this repository only
   (GitHub → Settings → Developer settings → Fine-grained tokens).
2. In PowerShell, in the project folder, with the window kept open until the end:
   ```powershell
   $env:GH_TOKEN = "<token>"; npm run release
   ```
   It picks the version (the next 1.x after the latest release), stamps the `"next"` changes, commits and pushes that,
   builds the installer, creates the GitHub release and uploads the 3 files one by one (retried): the installer, its
   `.blockmap` and `latest.yml`. Then it checks them online: the last line must be **release-check: v… ✓**.
3. If something stopped half-way (connection, closed window): `npm run release:fix` uploads what's missing to that
   version's release without rebuilding (same token).
4. `Remove-Item Env:GH_TOKEN`. Within 4 hours, every open launcher downloads the update in the background and shows
   **Restart to update**. Players who ignore it get it the next time they close the launcher. A running game is never
   interrupted.

Never delete `latest.yml` from a release: launchers read it to find updates.

## What players see without code signing

The installer isn't signed yet (a certificate costs about €200–400 per year). The first time someone runs it, Windows
SmartScreen shows **"Windows protected your PC"**. They need to click **More info → Run anyway**. Updates install silently
afterwards. Signing can be added later in `electron-builder.yml` (`win.signtoolOptions`) without changing anything else.

## Security built into the installed launcher

- Electron fuses: it can't be started as plain Node, ignores `NODE_OPTIONS` and `--inspect`, and only runs its own
  integrity-checked `app.asar`.
- It refuses to start with `--remote-debugging-port`.
- The package contains only the built app (`out/`), the icon and `package.json`: no sources, tools or keys.
