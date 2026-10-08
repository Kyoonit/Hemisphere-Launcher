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

## Launcher history and "What's new" (required for every release)

The launcher's history lives in `src/shared/launcherChangelog.json`: **one entry per day** (not per push), newest
first, each change with an area (play, home, content, screenshots, community, settings, performance, launcher) and its
English and French text. Players see it in **News > Launcher updates**, and the last 2 days they haven't seen yet in the
**What's new** card on Home (with **See more** leading to the full history).

- Add each change to today's entry as it's pushed (a new day = a new entry at the top, with `"version": "next"`).
- `npm run release` gives every `"next"` day the new version number, uses the same text for the GitHub release, and
  **refuses to publish** when there's nothing new or a change is missing its English or French text.
- After a release, commit `src/shared/launcherChangelog.json`.

## Publish a release (players get it automatically)

1. Raise `"version"` in `package.json` and check the `"next"` days in `src/shared/launcherChangelog.json`, then commit
   and push.
2. Create a GitHub token with **Contents: read and write** on this repository
   (GitHub → Settings → Developer settings → Fine-grained tokens).
3. In PowerShell:
   ```powershell
   $env:GH_TOKEN = "<token>"
   npm run release
   ```
   This creates the GitHub release `v<version>` and uploads the installer, `latest.yml` and the `.blockmap` file.
   It is published right away.
4. Within 4 hours, every open launcher downloads the update in the background and shows **Restart to update**.
   Players who ignore it get it the next time they close the launcher. A running game is never interrupted.

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
