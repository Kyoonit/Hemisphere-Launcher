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
