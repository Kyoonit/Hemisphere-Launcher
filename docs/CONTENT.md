# Publishing the Hemisphere client

The mods, Minecraft version and Fabric version that players get are defined by **one file you edit** and
**one command you run**. Players' launchers pick up the change on their next start — no launcher update needed.

```
content-src/client.json   ← you edit this
        │  npm run content:publish
        ▼
content/index.json + index.json.sig   ← signed "pointer" to the current client
content/clients/<version>/manifest.json   ← full list: every file, its download URL and SHA-512 hash
        │  git commit + push
        ▼
Players' launchers (verify the signature, then use it)
```

## One-time setup (already done on Kyoonit's PC)

```bash
npm run content:keygen
```

Creates the **private signing key** in `C:\Users\<you>\.hemisphere\content-signing-key.pem`.

- **Back it up** (password manager, encrypted USB). If it's lost, a launcher update is needed to trust a new key.
- **Never commit or share it.** Anyone with it could push mods to every player. `.gitignore` blocks `*.pem`.
- Only the matching *public* key is in the launcher (`src/main/core/remote/publicKey.ts`).

## Changing the client

1. Edit `content-src/client.json`:
   - **Bump `clientVersion`** every time (`1.0.0` → `1.0.1` for mod updates, `1.1.0` for new mods,
     `2.0.0` for a new Minecraft version). Published versions are never overwritten.
   - Add/remove mods by their **Modrinth slug** (the name in the URL: `modrinth.com/mod/<slug>`).
   - `category`: `performance`, `voice`, `visual`, `comfort` (or `library`, hidden in the launcher).
   - `recommended`: shows a badge; players get a warning when they turn it off.
   - `default`: on for new players.
   - Optional `"version": "<exact Modrinth version number>"` to pin; otherwise the newest **release** for the
     Minecraft version is used. `"allowBeta": true` accepts beta builds when no release exists.
   - `previousCanJoin`: `true` while the server still accepts the previous client (e.g. same Minecraft version).
2. Preview: `npm run content:publish -- --dry-run`
3. Publish: `npm run content:publish`
4. `git add content content-src && git commit -m "Client 1.0.1" && git push`

GitHub caches these files for up to **~5 minutes**, so players see a new client within a few minutes of the push.

Required libraries (Cloth Config, Fabric Language Kotlin, …) are added automatically.

## Config files, resource packs

Put the file in `content-src/files/<path>` (e.g. `content-src/files/config/sodium-options.json`) and list it:

```json
"files": [{ "path": "config/sodium-options.json", "policy": "default" }]
```

- `default`: copied once; after that the player's own changes are kept.
- `enforced`: always reset to your version.

Allowed folders: `config/`, `resourcepacks/`, `shaderpacks/`.

## What the launcher checks (security)

- The index signature must match the built-in public key, and the manifest must match the hash in the index.
- Every download must come from `cdn.modrinth.com` or this repository's `content/` folder, over HTTPS,
  and is checked against its SHA-512 hash.
- File paths can't leave the game folder (`..`, absolute paths, drive letters, reserved names are rejected).
- An older index can't replace a newer one (replay protection), and the last verified copy is kept for offline use.

## News, maintenance and restart time

All in `content-src/feed.json`, published with one command:

```bash
npm run content:feed
git add content content-src && git commit -m "News: <title>" && git push
```

Launchers check for a new feed every **10 minutes** (plus GitHub's ~5-minute cache).

- **News** (`news`): newest first. Each item has an `id` (lowercase-dashes, unique), a `date` (`YYYY-MM-DD`),
  a `category` (`update`, `event`, `server`, `community`), a `title` and `body` in `en` (+ `fr`).
  Blank lines in `body` make paragraphs. Optional:
  - `"featured": true` → shown big at the top of the News page
  - `"image"`: a `https://hemispheresurvival.club/...` image, or a file you put in `content-src/news-images/`
    written as `"news-images/my-picture.png"`
  - `"link": { "label": { "en": "…", "fr": "…" }, "url": "https://…" }` → a button in the article
- **Maintenance**: set `"active": true` (and optionally `"until": "2026-10-10T18:00:00+02:00"`). Players see an
  amber banner with your message and the end time in their own time zone. Set it back to `false` when done.
- **Restart** (`restart`): daily time + time zone, e.g. `{ "time": "17:00", "timeZone": "Europe/Paris",
  "durationMin": 5 }`. Use `null` for no daily restart.

The feed is signed like the client: a modified or older feed is refused, and the last good one is kept.

## Problem reports (support)

Players use **Report a problem** (Settings → Installation, the crash card, the error line under PLAY). The launcher
builds `Hemisphere report HR-XXXXXX.zip` in their Downloads, copies a short message for the ticket, and its
**Open Discord** button takes them to your support place. Nothing is sent automatically.

Choose where that button goes in `content-src/feed.json` (optional; without it, it opens the Discord invite):

```json
"support": {
  "url": "https://discord.com/channels/<server id>/<ticket channel id>",
  "howTo": { "en": "Click “Create ticket” in #support, then paste the message and drop the zip.", "fr": "Clique « Créer un ticket » dans #support, puis colle le message et dépose le zip." }
}
```

Only `discord.com` / `discord.gg` links are accepted. Publish with `npm run content:feed` as usual.

**Reading a report** — open the zip and start with `README.txt`: the player's words, then the **Quick look**
(automatic: crash cause, out of memory, mods Fabric refused, mods named in the crash, mixin errors, low memory or disk,
custom Java, mods changed in the last 24 h, preset switches, graphics chip setting, server reachability). Then:

| File | What's in it |
| --- | --- |
| `system.txt` | Windows, CPU, RAM, graphics, Java, memory and launcher settings |
| `mods.txt` | every mod: on/off, version, Hemisphere / player / taken over, locks, updates, file |
| `packs.txt` | resource packs in order (top wins), shaders, Iris |
| `recent-changes.txt` | mod/pack changes (newest first) and restore points |
| `settings/` | launcher settings, `options.txt`, Iris settings |
| `logs/` | `launcher.log` (+ previous), `latest.log` (the last game) |
| `crash-reports/`, `jvm/` | Minecraft crash reports and Java crash files of the last 2 weeks |
| `screenshots/` | the ones the player chose |
| `report.json` | the same, machine-readable |

The report ID (`HR-…`) is in the message, the zip name and the README, so ticket and file always match. Private
details are removed before anything is written: Windows user name and folders, sign-in tokens, e-mail addresses,
IP addresses in network lines, other accounts' names, and (by default) chat lines of the game log.

## Events calendar and Discord status

**Events** (`events` in `content-src/feed.json`, optional). Players see them in News (and the next one, live or within
a week, in the server panel on Home), each in their own time, with **Remind me** (one notification 15 minutes before,
only if they ask) and **Add to calendar** (a calendar file for Outlook / Windows Calendar / Google Calendar).

```json
"events": [
  {
    "id": "build-contest-castles",
    "title": { "en": "Build contest: castles", "fr": "Concours de construction : châteaux" },
    "body": { "en": "Build the best castle in 3 hours. Prizes for the top 3!", "fr": "…" },
    "start": "2026-10-17T20:00:00+02:00",
    "end": "2026-10-17T23:00:00+02:00",
    "where": { "en": "/warp contest" },
    "link": { "label": { "en": "Rules", "fr": "Règles" }, "url": "https://hemispheresurvival.club/rules" }
  }
]
```

`start` / `end` need their time zone (`+02:00` in Paris summer time, `+01:00` in winter, or `Z` for UTC). `end` is
optional (the event then counts as "live" for 2 hours). Events disappear by themselves once over; up to 50.

**Discord status** (`"discordAppId": "<id>"`, optional). Players can turn on "Show “Playing on Hemisphere SMP” in
Discord" (Settings → Launcher; off by default, only while the game runs). It needs a Discord application:
1. https://discord.com/developers/applications → **New Application** → name it **Hemisphere SMP** (that name is what
   Discord shows: "Playing Hemisphere SMP").
2. **General Information → App Icon** and **Rich Presence → Art Assets**: upload
   [`docs/discord/hemisphere-logo-512.png`](discord/hemisphere-logo-512.png) (512 × 512, Discord's minimum). As an art
   asset its name must be exactly **`logo`** (the launcher asks for that name). New assets can take a few minutes to show.
3. Test it before publishing: Settings → Developer → Discord → paste the **Application ID** → Save (the launcher checks
   it with Discord) → "Show Discord status now", with the Discord desktop app open.
4. Copy the **Application ID** into `"discordAppId"` and publish the feed. Until then the option is greyed out.

## Staff testing (Developer tab)

The installed launcher has a hidden **Developer** tab for staff: pretend situations to look at every screen without
waiting for them to happen (sample events, maintenance, restart countdown, unread news, busy/offline server, crash
card and every error, PLAY progress, notifications, Discord status with your own app id, launcher update banner,
low disk/RAM warnings, sample screenshots, window sizes). Everything is local to that PC and pretend: nothing reaches
the server or other players.

**Staff sign-in without Microsoft** (until Microsoft/Mojang approve the launcher). On the sign-in screen, press
**Ctrl+Shift+S** (or click the padlock under the Microsoft button 5 times quickly): a code field appears. Enter the staff
code: a **Staff test account** appears below; pick a name and you're in, with the Developer tab unlocked. It's an
offline account: every launcher feature and singleplayer work, the Hemisphere server refuses it. Nothing shows for
players without the code (wrong tries are slowed down). Settings → Developer → Lock removes the access and the
offline accounts from that PC.

To unlock it: **Settings → Advanced → Staff access**, enter the staff code. It stays unlocked on that PC until
**Lock** (in the tab). Five wrong codes in a row make it wait. Development builds always show the tab.

The code is never stored, only its fingerprint. To switch to a new code (e.g. someone left the staff):

```bash
npm run staff-code
```

It prints the new code (share it privately) and a `"staffCode"` entry to paste into `content-src/feed.json`; publish
with `npm run content:feed`. From then on only the new code works (PCs already unlocked stay unlocked).

## Daily restart (live)

The restart time comes from `restart` in the feed (`durationMin` is no longer shown to players). From 90 seconds
before that time, launchers check the server itself every 5 seconds: the panel says **Restarting** from the scheduled
time until the server answers again, then **Back online** for two minutes. If the server is never seen down within
5 minutes (it restarted between two checks), the panel goes back to normal; down for more than 30 minutes counts as
an outage. Players can pick restart notifications (15 min before, 1 min before, when it starts, when it's back) in
Settings → Launcher → Community; all are off by default.
