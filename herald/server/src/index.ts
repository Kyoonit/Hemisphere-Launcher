/**
 * Herald server.
 *   GET  /health, /time          liveness and server clock
 *   GET  /vault-key/:id          PUBLIC: a vault's key, only from its opening time (launchers ask right at that time)
 *   GET  /content-key/:id        PUBLIC: the key of the sealed feed / pack index online now (S12: nothing in the content
 *                                 repository can be read without it; a replaced key is refused after 15 minutes)
 *   POST /bootstrap              one-time creation of the Owner / Developer profiles (BOOTSTRAP_TOKEN secret)
 *   POST /login, /logout         staff sign-in (name + code) → session token
 *   GET  /me, /sync              the signed-in profile; presence + activity (the app refreshes every 15 s)
 *   …    /profiles               create, change, revoke profiles, new codes (permission profiles.manage)
 *   …    /publications           news, banners, welcome messages: edit, statuses, comments, publish (S5)
 *   POST /images, GET /images/:id   pictures of the publications (WebP from the app)
 *   POST /publish                publish the current state again (a failed run, a retry)
 *   …    /server/…               maintenances (planned, now, back online), daily restart, their history (S6)
 *   …    /pack…                  mod pack: proposals, approval by another member, config files (S10)
 *   GET  /activity               the full shared journal (filters, older pages) (S11)
 *   GET  /stats?range=           server statistics (players, sessions, playtime; collected every minute: stats.ts)
 *   GET  /backups                the last automatic backups of this database (backups.ts)
 *   POST /internal/backup        BACKUP WORKFLOW: how tonight's backup went
 *   GET  /settings/history/<key> every version of a setting Herald edits (backgrounds, launcher settings, templates)
 *   POST /templates/publications publication templates (S11)
 *   …    /player/…, /shop…        the catalogue in the launchers: verified players, sealed items marked for each (shop.ts)
 *   GET  /update/<file>          Herald app updates (signed-in staff only), from the private releases repository
 *   GET  /pulse                  PUBLIC: last sequence + commit; launchers read the feed at that exact commit (raw
 *                                 by commit is never cached, plain raw is cached up to 5 min): emergencies in minutes
 *   POST /internal/next          PUBLISHER: the newest queued job + its sequence (older queued jobs are superseded)
 *   POST /internal/done|failed   PUBLISHER: result of a publish run
 *   GET  /internal/file/<path>   PUBLISHER: a file the job writes next to the feed (vault, picture, pack config file)
 *   POST /dev/publish            test: queue a schema 1 feed and start the publish workflow
 *   POST /dev/publish-v2         test: queue a schema 2 feed; items not due yet are locked in vaults
 *   GET  /dev/job/:id            test: where a job is
 *   POST /dev/vault              test: seal a payload, keep its key until opensAt
 *   POST /dev/test-profile       test: the "Herald Test" admin profile, with a new code
 * Plan A: the content signing key is NOT here. GitHub Actions ("Herald publish" workflow of the content repository)
 * validates, signs and commits; this server only says what to publish. /dev/* never exists in production.
 */
import { sealVault, toB64, unwrapKey, wrapKey } from './crypto'
import { githubConfigured, latestReleaseFile, startPublishWorkflow, type GithubEnv } from './github'
import { listedFiles, openKeys, sealFuture, type FeedDraft } from './feedV2'
import { saveBackgrounds } from './backgrounds'
import { savePublic } from './publicSettings'
import { listActivity, savePublicationTemplates, settingsHistory } from './history'
import { contentKey, currentPackKey, KEY_GRACE_MS, newContentKey, publishKeys } from './sealing'
import { approvePack, getPack, packForJob, packJobFinished, proposePack, rejectPack, uploadPackFile, withdrawPack } from './pack'
import { authenticate, bootstrap, createProfile, deleteProfile, HttpError, listProfiles, login, logout, newProfileCode, sync, testProfile, updateProfile, type Actor } from './accounts'
import * as pubs from './publications'
import * as catalogue from './catalogue'
import * as shop from './shop'
import * as server from './serverState'
import { collectServerStats, statsView } from './stats'
import { listBackups, reportBackup } from './backups'
import { listRestarts, watchRestart } from './restartWatch'

export interface Env extends GithubEnv {
  DB: D1Database
  HERALD_ENV: string
  CONTENT_DIR: string
  VAULT_MASTER: string
  /** Shared with the publish workflow (secret of the content repository) */
  PUBLISHER_TOKEN: string
  /** Shared with the nightly backup workflow of the private backups repository (herald/backup) */
  BACKUP_TOKEN?: string
  /** Private repository of Herald app releases (its updates go through this server) */
  HERALD_RELEASES_REPO: string
  /** HMAC key of the profile codes */
  CODE_PEPPER: string
  /** One-time secret to create the Owner and Developer profiles (removed afterwards) */
  BOOTSTRAP_TOKEN?: string
  DEV_TOKEN?: string
  /** local tests only: the public key of a stand-in for Mojang's certificate signer (.dev.vars) */
  MOJANG_TEST_KEY?: string
  /** The version of this server that answers (wrangler.toml [version_metadata]) */
  CF_VERSION?: { id: string; tag: string; timestamp: string }
}

type Job = { id: string; payload: string; status: string; sequence: number | null; commit_sha: string | null; error: string | null; pack_id: string | null; keys: string | null; vault_ids: string | null }

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
const bearer = (req: Request, token: string | undefined) => Boolean(token) && req.headers.get('authorization') === `Bearer ${token}`

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const path = new URL(req.url).pathname
    try {
      if (req.method === 'GET' && path === '/health') return json({ ok: true, env: env.HERALD_ENV, version: env.CF_VERSION?.id ?? null, now: Date.now() })
      if (req.method === 'GET' && path === '/time') return json({ now: Date.now() })
      if (req.method === 'GET' && path === '/pulse') return await pulse(env)
      const staff = await staffRoute(req, env, path)
      if (staff) return staff
      const content = await publicationRoute(req, env, ctx, path)
      if (content) return content
      const catalogue = await catalogueRoute(req, env, path)
      if (catalogue) return catalogue
      const shopAnswer = await shopRoute(req, env, path)
      if (shopAnswer) return shopAnswer
      const key = path.match(/^\/vault-key\/([a-z0-9-]{1,80})$/)
      if (req.method === 'GET' && key) return await vaultKey(env, key[1])
      const sealKey = path.match(/^\/content-key\/((?:feed|pack)-[0-9a-f]{24})$/)
      if (req.method === 'GET' && sealKey) {
        const r = await contentKey(env.DB, env.VAULT_MASTER, sealKey[1])
        return json(r.body, r.status)
      }
      // the nightly backup workflow reports how it went (its own token)
      if (req.method === 'POST' && path === '/internal/backup') return bearer(req, env.BACKUP_TOKEN) ? json(await reportBackup(env.DB, await req.json())) : json({ error: 'not found' }, 404)
      if (path.startsWith('/internal/')) {
        if (!bearer(req, env.PUBLISHER_TOKEN)) return json({ error: 'not found' }, 404)
        if (req.method === 'POST' && path === '/internal/next') return await nextJob(env)
        if (req.method === 'POST' && path === '/internal/done') return await finishJob(env, await req.json(), 'done')
        if (req.method === 'POST' && path === '/internal/failed') return await finishJob(env, await req.json(), 'failed')
        const file = path.match(/^\/internal\/file\/(v2\/(?:vaults|images)\/[a-z0-9-]{1,80}\.(?:bin|webp)|pack\/[0-9a-f]{64}\.bin)$/)
        if (req.method === 'GET' && file) return await contentFile(env, file[1])
      }
      if (path.startsWith('/dev/')) {
        if (env.HERALD_ENV === 'production' || !bearer(req, env.DEV_TOKEN)) return json({ error: 'not found' }, 404)
        if (req.method === 'POST' && path === '/dev/publish') return await devPublish(env, ctx, await req.json())
        if (req.method === 'POST' && path === '/dev/publish-v2') return await devPublishV2(env, ctx, await req.json())
        const job = path.match(/^\/dev\/job\/([a-z0-9-]{1,80})$/)
        if (req.method === 'GET' && job) return await jobStatus(env, job[1])
        if (req.method === 'POST' && path === '/dev/vault') return await devVault(env, await req.json())
        if (req.method === 'POST' && path === '/dev/test-profile') return json(await testProfile(env))
      }
      return json({ error: 'not found' }, 404)
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message, ...(shop.isBlocked(err) ? { blocked: true } : {}) }, err.status)
      console.error(err)
      return json({ error: err instanceof Error ? err.message : String(err) }, 400)
    }
  },

  /** Every minute: marks the keys that are now public (S3 also publishes them in the feed as the GitHub fallback), and
   *  starts the publish workflow again if a job waits for more than 90 s (its start failed: GitHub down, CPU limit…), and
   *  collects the server statistics (stats.ts). */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const now = Date.now()
    // server statistics: alongside the rest, a failure there never stops it
    ctx.waitUntil(collectServerStats(env.DB, now).catch((err) => console.error('[stats]', err)))
    // the daily restart as it really happens (only near its scheduled time)
    ctx.waitUntil(watchRestart(env.DB, now).catch((err) => console.error('[restart]', err)))
    const { meta } = await env.DB.prepare('UPDATE vaults SET released_at = ?1 WHERE released_at IS NULL AND opens_at <= ?1').bind(now).run()
    if (meta.changes) {
      console.log(`[cron] ${meta.changes} vault key(s) now public`)
      // Fallback for launchers that missed the opening: republish the feed with the keys of the open vaults
      const state = await env.DB.prepare('SELECT feed FROM feed_v2_state WHERE id = 1').first<{ feed: string }>()
      if (state) {
        const feed = JSON.parse(state.feed) as Record<string, unknown>
        await queue(env, { schema: 2, feed: { ...feed, vaultKeys: await openKeys(env.DB, env.VAULT_MASTER, feed, now) }, files: listedFiles(feed) }, now, null, 'vault keys')
        if (env.HERALD_ENV !== 'local' && githubConfigured(env)) await startPublishWorkflow(env, 'vault keys (cron)')
      }
    }
    // Vault files opened a week ago are in the content repository for good: no need to keep them here too
    if (new Date(now).getUTCMinutes() === 0)
      await env.DB.prepare("DELETE FROM content_files WHERE path LIKE 'v2/vaults/%' AND substr(path, 11, 20) IN (SELECT id FROM vaults WHERE released_at < ?1)").bind(now - 7 * 86_400_000).run()
    const waiting = await env.DB.prepare("SELECT count(*) AS n FROM publish_jobs WHERE status = 'queued' AND created_at < ?1").bind(now - 90_000).first<{ n: number }>()
    if (waiting?.n && env.HERALD_ENV !== 'local' && githubConfigured(env)) {
      console.log(`[cron] ${waiting.n} job(s) still queued: starting the publish workflow again`)
      await startPublishWorkflow(env, 'retry (cron)')
    }
  },
} satisfies ExportedHandler<Env>

/** Staff routes (null = not one of them). Everything but bootstrap and login needs a session. */
async function staffRoute(req: Request, env: Env, path: string): Promise<Response | null> {
  const body = async () => (await req.json().catch(() => ({}))) as Record<string, unknown>
  if (req.method === 'POST' && path === '/bootstrap') return json(await bootstrap(env, await body()))
  if (req.method === 'POST' && path === '/login') return json(await login(env, await body()))
  const profile = path.match(/^\/profiles\/(p-[a-z0-9-]{1,20})(\/code|\/delete)?$/)
  const update = path.match(/^\/update\/(latest\.yml|Herald-Setup-\d+\.\d+\.\d+\.exe)$/)
  if (!['/me', '/logout', '/sync', '/profiles', '/activity', '/stats', '/backups'].includes(path) && !profile && !update) return null
  const actor = await authenticate(env, req)
  // Herald's own updates: only for signed-in staff, from the private releases repository
  if (req.method === 'GET' && update) return githubConfigured(env) ? await latestReleaseFile(env, env.HERALD_RELEASES_REPO, update[1]) : json({ error: 'not available' }, 404)
  if (req.method === 'GET' && path === '/me') return json((await sync(env, actor)).me)
  if (req.method === 'POST' && path === '/logout') return json(await logout(env, req, actor).then(() => ({ ok: true })))
  if (req.method === 'GET' && path === '/sync') return json(await sync(env, actor))
  if (req.method === 'GET' && path === '/activity') return json(await listActivity(env.DB, new URL(req.url), actor))
  if (req.method === 'GET' && path === '/stats') return json(await statsView(env.DB, actor, new URL(req.url)))
  if (req.method === 'GET' && path === '/backups') return json(await listBackups(env.DB, actor))
  if (req.method === 'GET' && path === '/profiles') return json(await listProfiles(env, actor))
  if (req.method === 'POST' && path === '/profiles') return json(await createProfile(env, actor, await body()))
  if (req.method === 'PATCH' && profile && !profile[2]) return json(await updateProfile(env, actor, profile[1], await body()))
  if (req.method === 'POST' && profile?.[2] === '/code') return json(await newProfileCode(env, actor, profile[1]))
  if (req.method === 'POST' && profile?.[2] === '/delete') return json(await deleteProfile(env, actor, profile[1]))
  return json({ error: 'not found' }, 404)
}

async function vaultKey(env: Env, id: string): Promise<Response> {
  const now = Date.now()
  const row = await env.DB.prepare('SELECT opens_at, key_wrapped, revoked_at FROM vaults WHERE id = ?1').bind(id).first<{ opens_at: number; key_wrapped: string; revoked_at: number | null }>()
  if (!row) return json({ error: 'unknown vault', now }, 404)
  if (row.revoked_at !== null && now - row.revoked_at > KEY_GRACE_MS) return json({ error: 'removed', now }, 410)
  // The server's clock decides, never the player's: too early → when to ask again
  if (now < row.opens_at) return json({ error: 'not yet', now, opensAt: row.opens_at, retryInMs: row.opens_at - now }, 425)
  return json({ key: toB64(await unwrapKey(row.key_wrapped, env.VAULT_MASTER)), now })
}

/** Tiny answer, no player data, not logged: what was published last and in which commit. */
async function pulse(env: Env): Promise<Response> {
  const state = await env.DB.prepare('SELECT sequence, commit_sha FROM publish_state WHERE id = 1').first<{ sequence: number; commit_sha: string | null }>()
  return json({ sequence: state?.sequence ?? 0, commit: state?.commit_sha ?? null, repo: env.GITHUB_REPO, dir: env.CONTENT_DIR, now: Date.now() })
}

// ------------------------------------------------------------------------------------------------ publishing

/** The publisher takes the NEWEST queued job (the latest state); older queued ones are superseded. */
async function nextJob(env: Env): Promise<Response> {
  const job = await env.DB.prepare("SELECT * FROM publish_jobs WHERE status = 'queued' ORDER BY created_at DESC LIMIT 1").first<Job>()
  if (!job) return json({ job: null })
  const state = await env.DB.prepare('SELECT sequence FROM publish_state WHERE id = 1').first<{ sequence: number }>()
  const sequence = (state?.sequence ?? 0) + 1
  const now = Date.now()
  // The keys of this run: a new one for the feed; for the pack, the one in force (to read the index in the repository)
  // and a new one when the pack changes, or when none is published yet (the index gets sealed)
  const feedKey = await newContentKey(env.DB, env.VAULT_MASTER, 'feed', now)
  const current = await currentPackKey(env.DB, env.VAULT_MASTER)
  const nextPack = job.pack_id || !current ? await newContentKey(env.DB, env.VAULT_MASTER, 'pack', now) : null
  await env.DB.batch([
    env.DB.prepare("UPDATE publish_jobs SET status = 'superseded', updated_at = ?2 WHERE status = 'queued' AND id != ?1").bind(job.id, now),
    env.DB.prepare("UPDATE publish_jobs SET status = 'publishing', sequence = ?2, updated_at = ?3, started_at = ?3, keys = ?4 WHERE id = ?1").bind(job.id, sequence, now, JSON.stringify({ feed: feedKey.id, pack: nextPack?.id ?? null })),
  ])
  return json({ job: { id: job.id, sequence, ...JSON.parse(job.payload), seal: { feed: feedKey, pack: { current, next: nextPack } } }, contentDir: env.CONTENT_DIR })
}

async function finishJob(env: Env, body: { id?: string; commit?: string; error?: string; part?: string; packSealed?: boolean }, status: 'done' | 'failed'): Promise<Response> {
  const job = await env.DB.prepare("SELECT * FROM publish_jobs WHERE id = ?1 AND status = 'publishing'").bind(body.id ?? '').first<Job>()
  if (!job) return json({ error: 'no such job being published' }, 404)
  const now = Date.now()
  if (status === 'failed') {
    await env.DB.prepare("UPDATE publish_jobs SET status = 'failed', error = ?2, updated_at = ?3 WHERE id = ?1").bind(job.id, String(body.error ?? 'unknown error').slice(0, 2000), now).run()
    if (job.pack_id) await packJobFinished(env.DB, job.pack_id, { error: body.error, part: body.part })
    return json({ ok: true })
  }
  if (!/^[0-9a-f]{40}$/.test(body.commit ?? '') && body.commit !== 'local') return json({ error: 'commit sha expected' }, 400)
  await env.DB.batch([
    env.DB.prepare("UPDATE publish_jobs SET status = 'done', commit_sha = ?2, updated_at = ?3 WHERE id = ?1").bind(job.id, body.commit, now),
    env.DB.prepare('INSERT INTO publish_state (id, sequence, commit_sha, updated_at) VALUES (1, ?1, ?2, ?3) ON CONFLICT(id) DO UPDATE SET sequence = ?1, commit_sha = ?2, updated_at = ?3')
      .bind(job.sequence, body.commit, new Date(now).toISOString()),
  ])
  if (job.pack_id) await packJobFinished(env.DB, job.pack_id, { commit: body.commit })
  // Its keys are given from now on (the pack's only if this run wrote a new sealed index); the replaced ones retire
  const keys = job.keys ? (JSON.parse(job.keys) as { feed: string; pack: string | null }) : null
  if (keys) await publishKeys(env.DB, [keys.feed, ...(keys.pack && body.packSealed ? [keys.pack] : [])], now)
  // Vaults this feed no longer lists (item removed, or now in the feed itself): their keys are refused after a while
  if (job.vault_ids) await env.DB.prepare('UPDATE vaults SET revoked_at = ?2 WHERE revoked_at IS NULL AND listing IS NOT NULL AND id NOT IN (SELECT value FROM json_each(?1))').bind(job.vault_ids, now).run()
  return json({ ok: true })
}

async function queue(env: Env, payload: { feed?: Record<string, unknown> } & Record<string, unknown>, now: number, by: string | null = null, reason: string | null = null, packId: string | null = null): Promise<string> {
  const id = `job-${crypto.randomUUID()}`
  const vaultIds = payload.feed?.vaults ? JSON.stringify((payload.feed.vaults as { id: string }[]).map((v) => v.id)) : null
  await env.DB.prepare("INSERT INTO publish_jobs (id, payload, status, created_at, updated_at, requested_by, reason, pack_id, vault_ids) VALUES (?1, ?2, 'queued', ?3, ?3, ?4, ?5, ?6, ?7)").bind(id, JSON.stringify(payload), now, by, reason, packId, vaultIds).run()
  return id
}

/** Publishes the whole current state (Herald's publications + the other feed parts + an approved change of the mod
 *  pack not published yet): queue + start the workflow. */
function publisher(env: Env, ctx: ExecutionContext, actor: Actor): pubs.Publisher {
  return async (reason) => {
    const now = Date.now()
    const { feed, files, vaultKeys } = await pubs.buildFeed(env, now)
    await env.DB.prepare('INSERT INTO feed_v2_state (id, feed, updated_at) VALUES (1, ?1, ?2) ON CONFLICT(id) DO UPDATE SET feed = ?1, updated_at = ?2').bind(JSON.stringify(feed), now).run()
    const pack = await packForJob(env.DB)
    const id = await queue(env, { schema: 2, feed: { ...feed, vaultKeys }, files, ...(pack ? { pack: pack.payload } : {}) }, now, actor.profile.id, reason, pack?.id ?? null)
    if (env.HERALD_ENV !== 'local' && githubConfigured(env)) ctx.waitUntil(startPublishWorkflow(env, reason).catch((err) => console.error('[publish] workflow not started:', err)))
    return id
  }
}

/** Publications routes (null = not one of them). */
async function publicationRoute(req: Request, env: Env, ctx: ExecutionContext, path: string): Promise<Response | null> {
  const one = path.match(/^\/publications\/([nebw]-[a-z0-9]{12})(?:\/(status|publish|unpublish|delete|restore|comments|editing|versions\/(\d{1,6})))?$/)
  const image = path.match(/^\/images\/([0-9a-f]{64})$/)
  const maintenance = path.match(/^\/server\/maintenances\/(m-[a-z0-9]{10})\/delete$/)
  const packAction = path.match(/^\/pack\/proposals\/(k-[a-z0-9]{10})\/(approve|reject|withdraw)$/)
  const history = path.match(/^\/settings\/history\/(backgrounds|public|templates\.publications)$/)
  const serverPaths = ['/templates/publications', '/pack', '/pack/proposals', '/pack/files', '/backgrounds', '/settings/public', '/server/templates', '/server/maintenances', '/server/maintenance-now', '/server/back-online', '/server/restart', '/server/history', '/server/restarts']
  if (path !== '/publications' && path !== '/images' && path !== '/publish' && !one && !image && !maintenance && !packAction && !history && !serverPaths.includes(path)) return null
  const actor = await authenticate(env, req)
  const body = async () => (await req.json().catch(() => ({}))) as Record<string, unknown>
  const run = publisher(env, ctx, actor)
  if (req.method === 'GET' && path === '/publications') return json(await pubs.listPublications(env, actor))
  if (req.method === 'POST' && path === '/publications') return json(await pubs.createPublication(env, actor, await body()))
  if (req.method === 'POST' && path === '/images') return json(await pubs.uploadImage(env, actor, req))
  if (req.method === 'GET' && image) return await pubs.imageFile(env, image[1])
  if (req.method === 'POST' && path === '/publish') {
    if (!actor.permissions.includes('publications.publish')) throw new HttpError(403, 'You cannot publish.')
    return json({ job: await run('publish again') })
  }
  // Server tab (S6): maintenances, emergencies, daily restart
  if (req.method === 'GET' && path === '/server/history') return json(await server.serverHistory(env))
  if (req.method === 'GET' && path === '/server/restarts') return json(await listRestarts(env.DB, actor))
  if (req.method === 'POST' && path === '/server/maintenances') return json(await server.saveMaintenance(env, actor, await body(), run))
  if (req.method === 'POST' && maintenance) return json(await server.deleteMaintenance(env, actor, maintenance[1], await body(), run))
  if (req.method === 'POST' && path === '/server/maintenance-now') return json(await server.maintenanceNow(env, actor, await body(), run))
  if (req.method === 'POST' && path === '/server/back-online') return json(await server.backOnline(env, actor, run))
  if (req.method === 'POST' && path === '/settings/public') return json(await savePublic(env, actor, await body(), run))
  if (req.method === 'POST' && path === '/backgrounds') return json(await saveBackgrounds(env, actor, await body(), run))
  // Traceability (S11)
  if (req.method === 'GET' && history) return json(await settingsHistory(env.DB, actor, history[1]))
  if (req.method === 'POST' && path === '/templates/publications') return json(await savePublicationTemplates(env.DB, actor, await body()))
  // Mod pack (S10)
  if (req.method === 'GET' && path === '/pack') return json(await getPack(env, actor))
  if (req.method === 'POST' && path === '/pack/proposals') return json(await proposePack(env, actor, await body()))
  if (req.method === 'POST' && path === '/pack/files') return json(await uploadPackFile(env, actor, req))
  if (req.method === 'POST' && packAction?.[2] === 'approve') return json(await approvePack(env, actor, packAction[1], run))
  if (req.method === 'POST' && packAction?.[2] === 'reject') return json(await rejectPack(env, actor, packAction[1], await body()))
  if (req.method === 'POST' && packAction?.[2] === 'withdraw') return json(await withdrawPack(env, actor, packAction[1]))
  if (req.method === 'POST' && path === '/server/templates') return json(await server.saveTemplates(env, actor, await body()))
  if (req.method === 'POST' && path === '/server/restart') return json(await server.saveRestart(env, actor, await body(), run))
  if (!one) return json({ error: 'not found' }, 404)
  const [, id, action, version] = one
  if (req.method === 'GET' && !action) return json(await pubs.getPublication(env, actor, id))
  if (req.method === 'GET' && version) return json(await pubs.getVersion(env, actor, id, Number(version)))
  if (req.method === 'PATCH' && !action) return json(await pubs.savePublication(env, actor, id, await body()))
  if (req.method !== 'POST') return json({ error: 'not found' }, 404)
  if (action === 'status') return json(await pubs.setStatus(env, actor, id, await body()))
  if (action === 'publish') return json(await pubs.publishPublication(env, actor, id, await body(), run))
  if (action === 'unpublish') return json(await pubs.unpublishPublication(env, actor, id, await body(), run))
  if (action === 'delete') return json(await pubs.deletePublication(env, actor, id, await body(), run))
  if (action === 'restore') return json(await pubs.restorePublication(env, actor, id, await body()))
  if (action === 'comments') return json(await pubs.addComment(env, actor, id, await body()))
  if (action === 'editing') return json(await pubs.setEditing(env, actor, id, await body()))
  return json({ error: 'not found' }, 404)
}

/** Catalogue routes (null = not one of them). */
async function catalogueRoute(req: Request, env: Env, path: string): Promise<Response | null> {
  const one = path.match(/^\/catalogue\/(c-[a-z0-9]{10})(?:\/(files|original|version|status|thumbnail|delete))?$/)
  const blockOne = path.match(/^\/catalogue\/players\/([0-9a-f]{32})\/block$/)
  if (path !== '/catalogue' && path !== '/catalogue/trace' && path !== '/catalogue/blocked' && !blockOne && !one) return null
  const actor = await authenticate(env, req)
  const body = async () => (await req.json().catch(() => ({}))) as Record<string, unknown>
  if (path === '/catalogue/trace') return req.method === 'POST' ? json(await shop.trace(env, actor, await body())) : json({ error: 'not found' }, 404)
  if (path === '/catalogue/blocked') return req.method === 'GET' ? json(await shop.blockedPlayers(env, actor)) : json({ error: 'not found' }, 404)
  if (blockOne) return req.method === 'POST' ? json(await shop.blockPlayer(env, actor, blockOne[1], await body())) : json({ error: 'not found' }, 404)
  const v = Number(new URL(req.url).searchParams.get('version'))
  const version = Number.isInteger(v) && v > 0 ? v : undefined
  if (path === '/catalogue') {
    if (req.method === 'GET') return json(await catalogue.listCatalogue(env, actor))
    if (req.method === 'POST') return json(await catalogue.createItem(env, actor, await body()))
    return json({ error: 'not found' }, 404)
  }
  const [, id, action] = one!
  if (req.method === 'PATCH' && !action) return json(await catalogue.saveSheet(env, actor, id, await body()))
  if (req.method === 'GET' && action === 'files') return json(await catalogue.previewFiles(env, actor, id, version))
  if (req.method === 'GET' && action === 'original') return json(await catalogue.originalFiles(env, actor, id, version))
  if (req.method !== 'POST') return json({ error: 'not found' }, 404)
  if (action === 'files') return json(await catalogue.uploadFiles(env, actor, id, await body()))
  if (action === 'version') return json(await catalogue.useVersion(env, actor, id, await body()))
  if (action === 'status') return json(await catalogue.setStatus(env, actor, id, await body()))
  if (action === 'thumbnail') return json(await catalogue.setThumbnail(env, actor, id, await body()))
  if (action === 'delete') return json(await catalogue.deleteItem(env, actor, id))
  return json({ error: 'not found' }, 404)
}

/** The catalogue in the launchers (null = not one of these routes) */
async function shopRoute(req: Request, env: Env, path: string): Promise<Response | null> {
  if (req.method === 'GET' && path === '/player/challenge') return json(await shop.challenge(env))
  if (req.method === 'POST' && path === '/player/verify') return json(await shop.verifyPlayer(env, (await req.json().catch(() => ({}))) as Record<string, unknown>))
  if (req.method === 'GET' && path === '/shop') return json(await shop.listShop(env, req))
  const thumb = path.match(/^\/shop\/thumb\/(c-[a-z0-9]{10})$/)
  if (req.method === 'GET' && thumb) return await shop.thumbnail(env, thumb[1])
  const item = path.match(/^\/shop\/(c-[a-z0-9]{10})$/)
  if (req.method === 'GET' && item) return json(await shop.deliver(env, req, item[1]))
  return null
}

/** A file of a publish job, for the publisher (it checks it against the signed feed before writing it). */
async function contentFile(env: Env, path: string): Promise<Response> {
  const row = await env.DB.prepare('SELECT bytes FROM content_files WHERE path = ?1').bind(path).first<{ bytes: ArrayBuffer }>()
  // D1 gives BLOBs back as arrays of numbers
  return row ? new Response(new Uint8Array(row.bytes), { headers: { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' } }) : json({ error: 'unknown file' }, 404)
}

async function devPublishV2(env: Env, ctx: ExecutionContext, body: { feed?: FeedDraft }): Promise<Response> {
  const now = Date.now()
  const { feed, files } = await sealFuture(env.DB, env.VAULT_MASTER, body.feed ?? {}, now)
  await env.DB.prepare('INSERT INTO feed_v2_state (id, feed, updated_at) VALUES (1, ?1, ?2) ON CONFLICT(id) DO UPDATE SET feed = ?1, updated_at = ?2').bind(JSON.stringify(feed), now).run()
  const id = await queue(env, { schema: 2, feed: { ...feed, vaultKeys: await openKeys(env.DB, env.VAULT_MASTER, feed, now) }, files }, now, null, 'test')
  const workflow = env.HERALD_ENV !== 'local' && githubConfigured(env)
  if (workflow) ctx.waitUntil(startPublishWorkflow(env, `test v2 ${id}`).catch((err) => console.error('[publish] workflow not started:', err)))
  return json({ job: id, workflow, vaults: (feed.vaults as { id: string; opensAt: string }[]).map((v) => ({ id: v.id, opensAt: v.opensAt })) })
}

async function devPublish(env: Env, ctx: ExecutionContext, body: { feed?: Record<string, unknown> }): Promise<Response> {
  const now = Date.now()
  const id = await queue(env, { feed: body.feed ?? {} }, now)
  // Starting the workflow is a network call: done after answering (waitUntil), its CPU stays tiny either way.
  // Local server: never (the e2e test runs the publisher itself)
  const workflow = env.HERALD_ENV !== 'local' && githubConfigured(env)
  if (workflow) ctx.waitUntil(startPublishWorkflow(env, `test ${id}`).catch((err) => console.error('[publish] workflow not started:', err)))
  return json({ job: id, workflow })
}

async function jobStatus(env: Env, id: string): Promise<Response> {
  const job = await env.DB.prepare('SELECT id, status, sequence, commit_sha, error FROM publish_jobs WHERE id = ?1').bind(id).first<Omit<Job, 'payload'>>()
  return job ? json(job) : json({ error: 'unknown job' }, 404)
}

async function devVault(env: Env, body: { payload?: unknown; opensInSec?: number }): Promise<Response> {
  const opensAt = Date.now() + Math.max(0, Math.min(86400, Number(body.opensInSec ?? 10))) * 1000
  const sealed = await sealVault(new TextEncoder().encode(JSON.stringify(body.payload ?? null)))
  const id = `test-${crypto.randomUUID()}`
  await env.DB.prepare('INSERT INTO vaults (id, opens_at, key_wrapped) VALUES (?1, ?2, ?3)').bind(id, opensAt, await wrapKey(sealed.key, env.VAULT_MASTER)).run()
  return json({ id, opensAt, file: toB64(sealed.file), sha512: sealed.sha512, plainSha256: sealed.plainSha256 })
}
