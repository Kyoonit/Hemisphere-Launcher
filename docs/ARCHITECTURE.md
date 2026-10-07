# Hemisphere Launcher — Technical Architecture

Status: **Phase 3 proposal** · Windows first · Electron + TypeScript

---

## 1. Stack

| Concern | Choice | Why |
|---|---|---|
| Shell | **Electron** (current stable) | One language (TypeScript) everywhere; best fit for AI-written code |
| Build | **electron-vite** | Fast dev reload, clean main/preload/renderer split |
| UI | **React + TypeScript + Tailwind CSS** | The website is Tailwind → identical tokens, near copy-paste styling |
| Validation | **Zod** | Every remote JSON (manifest, config, news, API) is validated before use |
| Minecraft core | **@xmcl/core 2.15.1 + @xmcl/installer 6.1.2** (MIT), **exact pins** | Proven TS library: version JSON, libraries, assets, natives, Fabric, Mojang Java runtimes. The 2026 releases (installer 6.3.x / core 2.16.x) are published broken on npm — never use `^` ranges here. All calls go through `core/game/` so the library can be swapped or vendored in one place |
| Translations | **i18next** + JSON files per language | See §10 |
| Logging | **electron-log** | Rotating files, redaction hook |
| Installer / updates | **electron-builder (NSIS)** + **electron-updater** (GitHub Releases) | Standard, free, works unsigned today and signed later |

## 2. Process model & security boundary

```
┌──────────────────────────── Renderer (React UI) ────────────────────────────┐
│  sandboxed · no Node · strict CSP · only talks through window.hemisphere.*   │
└──────────────────────────────────┬───────────────────────────────────────────┘
                                   │ typed IPC (contract in src/shared/ipc.ts)
┌──────────────────────────────────┴─────────── Preload ───────────────────────┐
│  contextBridge: exposes a small, explicit API — no raw ipcRenderer           │
└──────────────────────────────────┬───────────────────────────────────────────┘
┌──────────────────────────────────┴──────────── Main (Node) ──────────────────┐
│  auth · tokens · downloads · file system · Java · launching · updater        │
│  every IPC input validated with Zod · external links via allowlist only     │
└──────────────────────────────────────────────────────────────────────────────┘
```

Hardening: `contextIsolation`, `sandbox`, `nodeIntegration: false`, no `webview`, navigation blocked,
Electron **fuses** on (`OnlyLoadAppFromAsar`, embedded ASAR integrity, no `RunAsNode`) so bundled files —
including background pictures — can't be swapped by editing the install folder.

## 3. Project structure

```
hemisphere-launcher/
├─ locales/                    en.json, fr.json, …   ← ALL UI text lives here (§10)
├─ resources/
│  ├─ backgrounds/             bundled world screenshots (inside app.asar, not editable)
│  └─ icon.ico
├─ src/
│  ├─ main/
│  │  ├─ index.ts              app lifecycle, window, single-instance lock
│  │  ├─ ipc/                  one handler file per domain (thin → calls core/)
│  │  └─ core/
│  │     ├─ auth/              microsoft.ts · xbox.ts · minecraft.ts · accounts.ts
│  │     ├─ hemisphere-api/    whitelist + player list client (Option A)
│  │     ├─ remote/            signed config + manifest fetch, signature check, cache
│  │     ├─ java/              Mojang runtime manifests → managed Java per MC version
│  │     ├─ game/              install + launch MC/Fabric (wraps @xmcl), process watch
│  │     ├─ sync/              content store, diff planner, downloader, repair
│  │     ├─ mods/              toggles, user mods, Modrinth hash lookup, blocklist
│  │     ├─ importer/          detect other launchers, copy settings/packs/mods
│  │     ├─ status/            Server List Ping, restart schedule
│  │     ├─ news/              fetch + offline cache
│  │     ├─ settings/          typed settings store with defaults + migrations
│  │     ├─ updater/           launcher self-update
│  │     └─ diagnostics/       logging, error codes, diagnostics bundle
│  ├─ preload/index.ts
│  ├─ shared/                  types, IPC contract, error codes (used by both sides)
│  └─ renderer/
│     ├─ screens/              Login, Whitelist, Onboarding, Home, News, Mods, Settings, Repair, Error
│     ├─ components/           PlayButton, Toggle, Pill, Card, ServerPanel, AccountMenu…
│     ├─ styles/tokens.css     Phase 1 design tokens
│     └─ i18n.ts
├─ tools/
│  ├─ publish-client/          CLI for staff: folder → signed manifest + upload list
│  └─ i18n-check.ts            reports missing / unused translation keys
└─ server/                     tiny Hemisphere API (whitelist + players), deployed on the MC host
```

## 4. Files on the player's PC

```
%APPDATA%\Hemisphere\
├─ settings.json               launcher settings
├─ accounts.dat                refresh tokens, encrypted with Windows DPAPI (Electron safeStorage)
├─ store\ab\abcdef…            content-addressed files (SHA-256 named) — every mod/config stored once
├─ runtime\java-25\            managed Java (from Mojang's official runtime manifest)
├─ minecraft\                  shared versions\, libraries\, assets\
├─ instance\                   the Hemisphere game folder
│  ├─ mods\                    rebuilt from store (hard links) for the selected version + toggles
│  ├─ config\  options.txt  servers.dat  saves\  screenshots\  resourcepacks\  shaderpacks\
│  └─ .hemisphere\state.json   installed client version(s), toggles, file ownership
└─ logs\
```

**Why a content store:** updates download only changed files; keeping the previous version for
"Play on 26.2" costs almost nothing; repair = re-hash and re-link; no "delete and reinstall".

## 5. Remote data (what the staff controls)

**Hosting (easiest to maintain): everything on GitHub, one account.**
- `hemisphere-launcher` repo (public) → source code + **GitHub Releases** (installer & auto-updates)
- `hemisphere-content` repo (public) → **GitHub Pages** serves the files below; staff edit them with the publish tool, commit, done
- Mod jars are downloaded from Modrinth's CDN (never re-hosted)

All remote files are **signed with Ed25519**.
The public key is compiled into the launcher; the private key stays with staff (used by `tools/publish-client`).

| File | Content |
|---|---|
| `launcher-config.json` | links (Discord, website, map, rules), restart schedule `{ "time": "17:00", "timeZone": "Europe/Paris", "durationMin": 5 }`, maintenance message, mod **blocklist**, latest client version, `acceptedClientVersions` (decides if "Play on 26.2" can still join), minimum launcher version |
| `clients/<version>/manifest.json` | MC version, Fabric version, Java major, and every file: `id`, `path`, `sha256`, `size`, `url`, `kind` (mod/config/resourcepack), `category`, `recommended`, `defaultEnabled`, `configPolicy` (`enforced` \| `default`) |
| `news.json` | posts: id, date, category, title/body **per language**, optional image |

Rules: HTTPS only · download hosts allowlisted (`cdn.modrinth.com`, our CDN, Mojang, Fabric meta) ·
paths must stay inside the instance (no `..`, no absolute paths) · manifests contain **data only**, never commands.
If anything is unreachable, the last verified copy in cache is used → launcher works offline.

## 6. Core flows

**Sign-in** — OAuth 2.0 authorization code + PKCE in the **system browser** (loopback redirect), then
Microsoft → Xbox Live → XSTS → Minecraft token → profile + ownership check. Only the Microsoft refresh
token is stored (encrypted); Minecraft tokens stay in memory. Multiple accounts = multiple refresh tokens;
switching is instant. Until Microsoft approves our app, **dev builds only** get an offline test mode that is
compiled out of release builds.

**Whitelist (Option A)** — after sign-in: `GET api.hemispheresurvival.club/v1/whitelist/{uuid}` → `{ whitelisted }`.
If the API is down, the launcher does not block — the Minecraft server remains the authority.

**PLAY**
```
account token valid? ─► whitelist ─► config + manifest (verify signature)
   ─► Java ready? ─► MC + Fabric ready? ─► sync files (diff → download → verify → link)
   ─► player mods compatible? (dialog if not) ─► launch ─► (auto-join if setting on & latest version)
```
Auto-join uses Minecraft's `--quickPlayMultiplayer`. "Play on 26.2" launches the previous client's files and never auto-joins.

**Update** — a new client version is staged into the store while the old one stays intact; the switch happens
only after every file is verified. Same-MC-version updates apply automatically on PLAY.

**Server status** — `GET https://api.mcsrvstat.us/3/play.hemispheresurvival.club` (free, no key) every 60 s from the main
process: `online`, `players.online/max`, `version`, `players.list` (names + UUIDs). Heads: `https://mc-heads.net/avatar/<uuid>/<px>`.
Limits: mcsrvstat caches a few minutes; the list is the ~12-player sample the server sends → we show up to 10 heads and
"+N more" from the exact count. If mcsrvstat is down, the launcher falls back to its own direct Server List Ping (status only).
Restart countdown computed from
`launcher-config.json` using the IANA time zone → correct for every player's clock, daylight saving included.
Inside the restart window the status shows **SERVER OFFLINE · Restarting**.

**Playtime** — measured by the launcher, per account:
1. On launch, write `playtime/session.json` `{ uuid, pid, startedAt }` **before** the game starts.
2. Game exits while the launcher runs → add `exit − start` to `playtime.json`, delete the session file, refresh the Home card.
3. Launcher was closed during play → at next start, the pending session is found: if the PID is still Minecraft, keep
   watching; otherwise the end time = last write time of the instance's `logs/latest.log` (Minecraft writes it until exit).
4. Sessions < 30 s (crashes on load) are ignored; one session can't exceed 24 h (guard against a wrong PC clock).

Stored: total, last session, sessions count, daily buckets (for "this week"). Local only — never uploaded.

**Launching (Phase 7)** — `src/main/core/game/`: `install.ts` (Minecraft → Mojang Java → Fabric, with retries and a
fast path that skips everything when the last install matches), `gameService.ts` (launch, one game per account,
crash detection via exit code + crash report). Game paths are passed to Java **fully resolved** (`realpath`):
when Windows virtualises a folder (MSIX app containers, some sync/security tools), Java sees the real location and
Fabric 0.19 would otherwise consider its own loader jar to be two different files and crash at startup.

**Mod sync (Phase 9)** — `src/main/core/sync/`: on PLAY, `plan.ts` compares the manifest + the player's choices
with `instance/.hemisphere/state.json` (what Hemisphere placed, with size/mtime) and decides keep / check (hash) /
place / remove. `download.ts` fetches only missing files into the content store (`store/ab/<sha512>`) with HTTP
Range resume, retries and SHA-512 verification before a file is accepted; jars are hard-linked into `mods/`
(configs are copied). Files the player added are never touched; "default" configs are only copied once.

**PLAY flow (Phase 11)** — account (fresh session) → signed content
→ Minecraft/Java/Fabric → mod sync → launch (`--quickPlayMultiplayer` when auto-join is on and on the latest client)
→ playtime session file. The game is spawned **detached with `stdio: 'ignore'`**: with piped output, closing the
launcher while playing left Minecraft frozen on a full pipe. Crashes are detected from the exit code + a new file in
`crash-reports/`. Update offer: `src/shared/update.ts` (same Minecraft → silent; new Minecraft → "Update to…" +
"Play on <previous>", which uses the previous signed manifest and never auto-joins).

## 7. (Whitelist API — removed)

The whitelist check was dropped at the product owner's request (Phase 12). The Minecraft server alone decides who can join.

## 8. Mods

- Every Hemisphere mod can be toggled; "Recommended" ones show a warning when turned off.
- Libraries (Fabric API, Cloth Config…) are not shown — enabled automatically when anything needs them.
- **Player-added mods**: copied into the store, identified via Modrinth's hash API. On a version change the
  launcher looks up a compatible version automatically; otherwise it shows the "Launch without them" dialog.
- **Blocklist** (from remote config, by Modrinth project ID + hash): blocked mods are never loaded.

## 9. Import from another launcher

Detects: official launcher (`.minecraft`), Modrinth App, CurseForge, Prism/MultiMC, ATLauncher, plus "choose a folder".
Copies (never moves): `options.txt` (keybinds), `servers.dat`, resource/shader packs, mod configs for mods we ship,
and the player's compatible mods.

## 10. Translations

```
locales/
├─ en.json      ← source of truth, every string of the UI
├─ fr.json
└─ de.json      ← adding a language = copying en.json and translating it
```
```json
{ "home": { "welcome": "Welcome back", "play": "PLAY", "update": "UPDATE TO {{version}}",
            "restartIn": "Restart in {{time}}" } }
```
- A lint rule rejects hard-coded text in the UI, so new features **must** add their text to `en.json`.
- `npm run i18n:check` lists keys missing in each language; missing keys fall back to English.
- Language follows Windows by default; selectable in Settings.

## 11. Errors, logs, diagnostics

- Error codes `HEM-<AREA>-<NNN>` (e.g. `HEM-AUTH-003`) defined once in `src/shared/errors.ts`, each mapped to a translated
  message + suggested fix.
- Logs rotate in `%APPDATA%\Hemisphere\logs`; tokens and emails are redacted automatically.
- "Copy diagnostics" = launcher version, OS, RAM, Java, client version, last log lines — never tokens.

## 12. Launcher updates

electron-updater checks GitHub Releases at start. Without a code-signing certificate Windows shows SmartScreen on
first install; updates still work. Protect the GitHub account with 2FA (it's the update channel). Adding a
certificate later requires no architectural change.

## 13. Security summary

| Threat | Mitigation |
|---|---|
| Token theft | DPAPI-encrypted refresh token, Minecraft token memory-only, redacted logs, sandboxed renderer |
| Tampered manifest/config | Ed25519 signature + Zod schema + host allowlist |
| Tampered download | SHA-256 verified before use, atomic move into store |
| Path traversal / zip-slip | All paths normalized and checked to stay inside the instance |
| Malicious remote content | Manifests are data only; no remote scripts; renderer has strict CSP |
| Swapped app files / backgrounds | ASAR integrity fuses |
| Rule-breaking mods | Remote blocklist (light guard, not anti-cheat) |
