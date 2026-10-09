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
