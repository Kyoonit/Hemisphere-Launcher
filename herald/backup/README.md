# Herald backups

Every night a GitHub Actions workflow exports Herald's database (Cloudflare's own `wrangler d1 export`), encrypts it
for the owner's **public** key, and keeps it as a release of a **private** repository: the last 30 days, then one a
month for a year. It tells Herald how it went: Team › Backups shows the list, and Home warns when the last good backup
is more than 36 hours old or the last one failed.

Nobody but the owner can open a backup: the workflow only has the public key, the private key never leaves the owner.

A second safety net comes with Cloudflare: **Time Travel** puts the database back as it was at any minute of the last
days (7 on the free plan, 30 on the paid one), see "Restore" below.

## Set up (once)

1. **The key pair**, on the owner's PC:
   `npm run herald:backup -- key`
   The private key is saved in `Documents/herald-backup-private.pem`. **Keep a copy somewhere safe** (USB key, password
   manager): without it no backup can be opened. The command prints the public key.
2. **A private repository** on GitHub, e.g. `herald-backups`. Copy into it:
   - `herald/backup/herald-backup.yml` → `.github/workflows/herald-backup.yml`
   - `herald/backup/herald-backup.mjs` → `.github/herald/herald-backup.mjs`
3. **A Cloudflare API token** (dash.cloudflare.com › My Profile › API Tokens › Create Token › Custom): permission
   *Account › D1 › Edit* (the export needs it), on this account only. Nothing else.
4. **The report token**: `npm run herald:backup -- token`, then give it to the Herald server and to the repository
   (the command prints both commands; nothing is shown on screen).
5. In the repository's **Settings › Secrets and variables › Actions**:
   - secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `HERALD_BACKUP_TOKEN`
   - variables: `HERALD_DB` = `herald`, `HERALD_URL` = `https://herald.hemisphere-launcher.workers.dev`,
     `BACKUP_PUBLIC_KEY` = the public key from step 1
6. **Actions › Herald backup › Run workflow** once: Team › Backups shows it within a minute.

## Restore

**A few hours or days back (Time Travel)**, no backup file needed:

```
npx wrangler d1 time-travel info herald --config herald/server/wrangler.production.toml
npx wrangler d1 time-travel restore herald --timestamp=<when> --config herald/server/wrangler.production.toml
```

**From a backup file:**

1. Download it from the release on GitHub.
2. `npm run herald:backup -- decrypt herald-2026-10-11-0317.sql.gz.enc --key Documents/herald-backup-private.pem`
3. Restore it into a **new** database first and check it there:
   `npx wrangler d1 create herald-restore` then
   `npx wrangler d1 execute herald-restore --remote --file herald-2026-10-11-0317.sql`
4. Once it looks right, point the production configuration at it (its `database_id`), or restore the same file into
   `herald` after emptying it. Ask before touching the production database.
