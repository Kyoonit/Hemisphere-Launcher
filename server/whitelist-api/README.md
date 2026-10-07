# Hemisphere whitelist API

Lets the launcher tell a player "you're not whitelisted yet — join the Discord" **before** they try to connect.
One file (`server.mjs`), no dependencies, read-only: it only reads the Minecraft server's `whitelist.json`.

If this service is down, the launcher simply skips the check — players are never blocked by it.

## 1. Run it on the Minecraft server machine

Requires Node.js 18 or newer.

```bash
WHITELIST_PATH=/path/to/minecraft-server/whitelist.json node server.mjs
```

Check it: `curl http://127.0.0.1:8787/health` → `{"ok":true}`

Keep it running with **pm2** (simplest):

```bash
npm install -g pm2
WHITELIST_PATH=/path/to/whitelist.json pm2 start server.mjs --name hemisphere-api
pm2 save && pm2 startup
```

## 2. Publish it at `https://api.hemispheresurvival.club` with Cloudflare Tunnel

No open ports, no certificates to renew (free).

1. The `hemispheresurvival.club` domain must use Cloudflare DNS.
2. Cloudflare dashboard → **Zero Trust → Networks → Tunnels → Create a tunnel** → follow the install command for
   the server's OS.
3. Add a **public hostname**: `api.hemispheresurvival.club` → service `http://127.0.0.1:8787`.
4. Test from any PC: `https://api.hemispheresurvival.club/health`

## API

| Request | Response |
|---|---|
| `GET /v1/whitelist/<uuid>` (with or without dashes) | `{"whitelisted": true}` or `{"whitelisted": false}` |
| `GET /health` | `{"ok": true}` |

Rate limited to 60 requests/minute per IP. `whitelist.json` is re-read automatically when it changes.
