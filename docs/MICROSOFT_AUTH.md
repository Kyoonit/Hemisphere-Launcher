# Microsoft sign-in setup

The launcher signs players in with their Microsoft account (the official, secure way — the launcher never sees passwords).
For this to work, Hemisphere needs its own **Microsoft app registration**, and Microsoft must **approve** it for Minecraft.

| Step | Who | Time |
|---|---|---|
| 1. Create the app registration | Hemisphere staff (owner of the launcher) | 10 minutes |
| 2. Put the client ID in the launcher | Developer | 1 minute |
| 3. Ask Microsoft for Minecraft API access | Hemisphere staff | form: 10 minutes · answer: days to weeks |

Until step 3 is approved, sign-in goes all the way through Microsoft and Xbox, then stops with
**"Launcher not approved yet"**. That's expected. Development builds can use the offline test mode meanwhile.

---

## 1. Create the app registration

1. Go to <https://portal.azure.com> and sign in with the Microsoft account that will **own** the launcher
   (use a staff account you'll keep long-term, not a personal throwaway).
2. Search for **App registrations** → **New registration**.
3. Fill in:
   - **Name:** `Hemisphere Launcher`
   - **Supported account types:** *Personal Microsoft accounts only*
   - **Redirect URI:** platform **Public client/native (mobile & desktop)**, value `http://localhost`
4. Click **Register**.
5. On the app's **Overview** page, copy the **Application (client) ID** (looks like `1a2b3c4d-....`).

Nothing else is needed: no client secret, no certificates, no API permissions to add.

## 2. Put the client ID in the launcher

Create a file named `.env` at the project root (next to `package.json`):

```
MAIN_VITE_MS_CLIENT_ID=paste-the-application-client-id-here
```

The client ID is **public** (it only identifies the app, like a username), so it's fine to commit this file.
Restart `npm run dev` — the **Sign in with Microsoft** button becomes active.

## 3. Request Minecraft API access

New apps are blocked from Minecraft services until Microsoft reviews them.

1. Open the review form: <https://aka.ms/mce-reviewappid>
2. Provide the **Application (client) ID** from step 1 and the tenant (*consumers* / personal accounts).
3. Describe the app, for example:
   > Hemisphere Launcher is the official launcher of the Hemisphere SMP Minecraft community
   > (hemispheresurvival.club). It signs players in with Microsoft (OAuth 2.0 authorization code + PKCE,
   > system browser), installs Minecraft Java Edition and Fabric from official sources, and launches the game
   > to join our server. It requires players to own Minecraft: Java Edition.
4. Mention the GitHub repository (<https://github.com/Kyoonit/Hemisphere-Launcher>) so reviewers can inspect the code.
5. Submit and wait for Microsoft's email.

Once approved, nothing changes in the launcher — sign-in simply starts working end-to-end.

## How it works (for maintainers)

```
Launcher ──opens──► browser: login.microsoftonline.com (player signs in, Microsoft only)
browser ──redirect──► http://localhost:<random port>/?code=…   (one-shot server inside the launcher)
Launcher ──code + PKCE verifier──► Microsoft token  ──► Xbox Live ──► XSTS ──► Minecraft token ──► profile
```

- Stored on disk: player name, UUID, and the Microsoft **refresh token encrypted with Windows DPAPI**
  (`%APPDATA%\Hemisphere Launcher\accounts.json`). Minecraft tokens stay in memory.
- Sessions renew silently at startup. If Microsoft revokes a session, the account shows **Sign in again**.
- Code: `src/main/core/auth/` · tests: `tests/oauth.test.ts`, `tests/auth-chain.test.ts`.
