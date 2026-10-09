# Herald

Staff publishing tool of Hemisphere SMP. Decisions: `docs/herald/DECISIONS.md` · architecture:
`docs/herald/ARCHITECTURE.md` · wireframes: `design/herald-wireframes.html`.

```
herald/server/      Cloudflare Worker + D1 (the Herald server): accounts, drafts, vaults, pulse, publish queue
herald/publisher/   GitHub Actions workflow of the CONTENT repository (validates, signs, commits)
herald/app/         Electron app (phase S4)
tools/herald/       publisher logic + program, test key, GitHub App setup, end-to-end test
```

How a publication travels (plan A): the server queues it and starts the "Herald publish" workflow of the content
repository → the workflow (`tools/herald/publish-run.ts`, bundled) takes the newest queued job, validates it with the
launcher's schema, signs it with the key stored as a GitHub secret, commits, and reports the commit → the server's
`/pulse` points launchers at that commit. The server never holds the signing key and cannot write content.

## Test environment (phase S2)

Everything here uses a **test** signing key and **test** content (`Kyoonit/herald-test-content`). The real key and
the real `content/` are never involved.

### Local (no account needed)

```bash
npm run herald:test-key          # once: test key in ~/.hemisphere/herald-test-key.pem + herald/server/.dev.vars
npm run herald:server:migrate    # once, and after each new migration: local database
npm run herald:server:dev        # local server on http://127.0.0.1:8787 (workerd) — one at a time, stop with Ctrl+C
npm run herald:e2e               # other terminal: the publisher runs locally (no git), vaults, pulse, doors
```

Scheduled task by hand: `curl "http://127.0.0.1:8787/cdn-cgi/handler/scheduled?cron=*+*+*+*+*"`.
Type check: `npm run herald:server:types` once, then `npm run herald:server:typecheck`. Unit tests:
`tests/herald-*.test.ts` (`npx vitest run`).

### Staging (Kyonit's Cloudflare account, no payment method)

Server `https://herald-staging.hemisphere-launcher.workers.dev`, database `herald-staging`.

```bash
npx wrangler d1 migrations apply herald-staging --config herald/server/wrangler.toml --remote   # new migrations
npm run herald:server:deploy
npm run herald:e2e -- https://herald-staging.hemisphere-launcher.workers.dev                   # full chain, ~1 min
npm run herald:e2e-v2 -- https://herald-staging.hemisphere-launcher.workers.dev 4              # schema 2 + a vault opening in 4 min
```

Server secrets (`npx wrangler secret put <NAME> --config herald/server/wrangler.toml`): `VAULT_MASTER`,
`PUBLISHER_TOKEN`, `DEV_TOKEN`, `GITHUB_APP_ID`, `GITHUB_APP_KEY`, `GITHUB_INSTALLATION_ID` (values in
`herald/server/.dev.vars`). **No `SIGNING_KEY` on the server.**

### Content repository setup (done once per content repository)

1. GitHub App ("Herald Publisher Test" for staging), installed on the content repository only, repository
   permissions **Actions: Read and write**, **Contents: Read-only**, webhook inactive. Private key →
   `npm run herald:github-app -- <.pem> <App ID> <Installation ID>`, then delete the `.pem`.
2. Content repository → Settings → Secrets and variables → Actions: secrets `SIGNING_KEY` (PKCS#8 DER, base64) and
   `PUBLISHER_TOKEN`, variable `HERALD_URL`. `npm run herald:test-key` writes the test values to
   `herald/server/.actions-secrets.txt` (git-ignored): copy them, then delete the file.
3. `npm run herald:publisher:build`, then copy `herald/publisher/herald-publish.yml` to
   `.github/workflows/herald-publish.yml` and `herald/publisher/dist/herald-publish.mjs` to
   `.github/herald/herald-publish.mjs` in the content repository, commit, push. Repeat after any change to the
   publisher or the shared schemas.

### A dev launcher on the test content (schema 2)

Build the launcher with the test environment, run it, and it shows the test feed (its cache is separate:
`content-cache/v2-test`). Rebuild normally afterwards (`npx electron-vite build`).

```bash
MAIN_VITE_HERALD_URL=https://herald-staging.hemisphere-launcher.workers.dev MAIN_VITE_HERALD_CONTENT_BASE=https://raw.githubusercontent.com/Kyoonit/herald-test-content/main/content/ MAIN_VITE_HERALD_PUBLIC_KEY=$(cat herald/server/test-public-key.txt) npx electron-vite build
```

## The Herald app (phase S4)

```bash
npm run herald:typecheck && npm run herald:build     # herald/app/out (everything bundled, no node_modules)
npm run herald:dist                                  # herald/app/dist/Herald-Setup-<version>.exe (+ latest.yml)
npm run herald:release                               # GH_TOKEN with Contents: read and write on Kyoonit/herald-releases
```

A build talks to the staging server unless `MAIN_VITE_HERALD_SERVER` says otherwise (e.g. `http://127.0.0.1:8787`
with `npm run herald:server:dev`). The session token is kept by Windows (safeStorage), never given to the page.

Accounts: `POST /bootstrap` (one-time `BOOTSTRAP_TOKEN` secret) creates the Owner and the Developer; everyone else is
created in Herald (Team → New profile). Local test: `npm run herald:server:reset-local`, then
`npm run herald:e2e-accounts`. Server secrets added in S4: `CODE_PEPPER`, `BOOTSTRAP_TOKEN`.

Updates: installed apps ask the Herald server (`/update/…`, signed-in staff only), which relays the latest release of
the PRIVATE repository `Kyoonit/herald-releases` (the GitHub App needs it in its installation, Contents: read).

## Publications (phase S5)

News, banners and welcome messages are edited in Herald (Publications tab) and stored on the server
(`herald/server/src/publications.ts`, migration `0005`); the shared model is `src/shared/heraldPublications.ts`.
Life: draft → in review → Ready (locked) → published. Publishing sends the WHOLE current state: every published
publication + the feed parts Herald does not edit yet (`settings` key `feed.base`), future items locked in vaults.
Pictures (WebP, made by the app, ≤ 1.5 MB) and vault files are kept in D1 (`content_files`) and fetched by the
publisher from `/internal/file/…`; files already in the content repository are not sent again.

```bash
npm run herald:server:reset-local && npm run herald:server:dev    # then, in another terminal:
npm run herald:e2e-publications                                   # statuses, pictures, schedule, vault reuse, trash…
```

Staging tests without a staff code: `POST /dev/test-profile` (DEV_TOKEN, never in production) gives the
"Herald Test" admin profile a new code. After a change to the publisher or the shared schemas, rebuild it and copy it
into the test content repository again (see "Content repository setup").

Install window: `herald/app/build/installer.nsh` shows Herald's own window while it installs (the launcher's
HemiSplash plugin built with Herald's texts and colours, `herald/app/build/x86-unicode/HeraldSplash.dll`, background
`herald/app/build/installerSplash.bmp`). To change it: `node tools/installer-splash/herald.mjs` (needs Zig:
`py -m pip install --user ziglang`), then commit the rebuilt DLL and picture.

## Server tab (phase S6)

Maintenances (planned, started now, "back online") and the daily restart (time from a date, days without restart,
extra restarts) are feed parts kept in `settings` (`feed.base`, `herald/server/src/serverState.ts`); every change is
kept in `settings_versions` (migration `0006`), journaled, and published at once. Emergencies need
`maintenance.emergency`, planning `maintenance.write`, the restart `restart.write`.

```bash
npm run herald:server:reset-local && npm run herald:server:dev    # then, in another terminal:
npm run herald:e2e-server                                         # emergency, planned, restart, permissions, history
```

## Events and calendar (phase S7)

Events are a fourth kind of publication (`e-…` ids, permission `events.write`, so Lodge keepers write them too): title,
place, description, link, a start in a zone, a length, once or every week on chosen days (until a date or until taken
down), and when players first see it ("announced"; later = sent now in a vault). `feedItem` turns one into the feed's
`EventV2` (a weekly one gets `recurrence.weekly` with the start's wall time in its zone, so it does not move when the
clocks change); the launcher's list, reminder and calendar file are unchanged.

- Publications → **Calendar**: two weeks in the staff member's zone, one lane per kind plus maintenances and restarts
  (`restartsBetween`, `src/shared/restart.ts`), dashed = not published yet, and a warning for each event that happens
  while the server is closed (maintenance or restart).
- The preview draws the launcher's own event pieces (`src/renderer/src/components/feed/EventCards.tsx`, shared with the
  launcher's News page and server panel); time travel lists when each event is announced, starts and ends.
- Tests: `tests/herald-events.test.ts` (feed item, translations, announce time, weekly across the October clock
  change, checks, feed order, restarts over a period).

## Backgrounds (phase S8)

Home pictures by period (`src/shared/heraldBackgrounds.ts`): "All year" (shown with the launcher's built-in pictures)
and dated periods (first and last day, midnight to midnight in a zone) showing only their pictures or adding them to
the others. Kept in `settings` ('backgrounds', every version in `settings_versions`, permission `backgrounds.write`),
published at once by `POST /backgrounds` (`herald/server/src/backgrounds.ts`). `backgroundItems` turns them into the
feed's `backgrounds[]`; a period still to come is locked in vaults with its pictures (like a scheduled news picture).

- The pictures are uploaded WebP images (up to 2560 × 1440, ≤ 1.5 MB), written next to the feed as `v2/images/…`:
  the publisher lists them too (copy the rebuilt publisher to the content repository after this phase).
- Launcher: pictures downloaded once, checked by SHA-512, kept, shown through `hemi-content://`; on a metered
  connection (when "save data" is on) they wait for a normal one. Until a picture is on disk, the built-in ones show.
  The rule picking Home's pictures is shared with Herald's preview (`components/feed/homePictures.ts`).
- Tests: `tests/herald-backgrounds.test.ts`; staging check: `node <scratchpad>/stg-s8.mjs set|clean` style scripts.
