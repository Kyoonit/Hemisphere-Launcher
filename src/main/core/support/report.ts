import { app, clipboard } from 'electron'
import { randomBytes } from 'node:crypto'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { readFile, stat, statfs, writeFile } from 'node:fs/promises'
import { cpus, release, totalmem, userInfo } from 'node:os'
import { dirname, join } from 'node:path'
import type { ClientManifest } from '@shared/manifest'
import type { ModItem, ModPolicy } from '@shared/modBrowser'
import { parseIncompatibleMods } from '@shared/crash'
import { DISCORD_LIMIT, REPORT_PARTS, REPORT_TEXT_MAX, type ReportDraft, type ReportPart, type ReportPartInfo, type ReportPrepare, type ReportResult } from '@shared/report'
import { parseJvmArgs } from '@shared/settings'
import { getAccountsState } from '../auth/accounts'
import { listRestorePoints } from '../backup/restorePoints'
import { listSets } from '../backup/modSets'
import { recommendedMemoryMb } from '../game/gameService'
import { installedJavaPath } from '../game/install'
import { inspectJava } from '../game/java'
import { gamePaths } from '../game/target'
import { launcherLogDir, launcherLogPath, redact } from '../logging/logger'
import { listMods } from '../modrinth/allMods'
import { readHistory } from '../modrinth/history'
import { listPacks } from '../packs/packs'
import { readShaders } from '../packs/gameSettings'
import { getSettings } from '../settings/settings'
import { getServerStatus } from '../status/serverStatus'
import { gpuSummary } from '../system/gpu'
import { isScreenshotName } from '../system/screenshots'
import { readInstanceState } from '../sync/sync'
import { ZipWriter } from './zipWriter'

/**
 * The problem report: one zip for staff, laid out to be read in order (README.txt first: the player's words, then an
 * automatic quick look at the usual causes), plus a short message for the Discord ticket. Private details are removed
 * from every text file: Windows user name and folders, sign-in tokens, e-mail and IP addresses, other accounts' names,
 * and (by default) chat lines of the game log.
 */

const MB = 1024 * 1024
const LOG_MAX = 4 * MB
const RECENT_DAYS = 14
const inst = (...p: string[]) => join(gamePaths().instance, ...p)

// ------------------------------------------------------------------------------ what's available

const fileSize = (p: string) => {
  try {
    return statSync(p).size
  } catch {
    return 0
  }
}

/** Crash reports and Java crash files (hs_err) of the last two weeks, newest first. */
function recentCrashFiles(): { path: string; name: string; mtimeMs: number }[] {
  const since = Date.now() - RECENT_DAYS * 86_400_000
  const list = (dir: string, match: (f: string) => boolean) =>
    (existsSync(dir) ? readdirSync(dir) : [])
      .filter(match)
      .map((name) => ({ path: join(dir, name), name, mtimeMs: statSync(join(dir, name)).mtimeMs }))
      .filter((f) => f.mtimeMs >= since)
  const reports = list(inst('crash-reports'), (f) => /\.txt$/i.test(f))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, 5)
  const jvm = list(inst(), (f) => /^hs_err_pid\d+\.log$/i.test(f))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, 3)
  return [...reports, ...jvm]
}

const jarCount = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.jar')).length : 0)
const packCount = () => ['resourcepacks', 'shaderpacks'].reduce((n, d) => n + (existsSync(inst(d)) ? readdirSync(inst(d)).length : 0), 0)

export async function prepareReport(): Promise<ReportPrepare> {
  const crashes = recentCrashFiles()
  const launcherLogs = [launcherLogPath(), join(launcherLogDir(), 'launcher.1.log')]
  const parts: Record<ReportPart, Omit<ReportPartInfo, 'id'>> = {
    system: { available: true, size: 4096, count: 1 },
    launcherLog: { available: existsSync(launcherLogPath()), size: launcherLogs.reduce((n, p) => n + fileSize(p), 0), count: launcherLogs.filter(existsSync).length },
    gameLog: { available: existsSync(inst('logs', 'latest.log')), size: Math.min(LOG_MAX, fileSize(inst('logs', 'latest.log'))), count: 1 },
    crashReports: { available: crashes.length > 0, size: crashes.reduce((n, c) => n + fileSize(c.path), 0), count: crashes.length },
    mods: { available: true, size: 16_384, count: jarCount(inst('mods')) + jarCount(inst('mods-disabled')) },
    packs: { available: packCount() > 0, size: 4096, count: packCount() },
    changes: { available: readHistory().length > 0, size: 8192, count: Math.min(40, readHistory().length) },
    settings: { available: true, size: fileSize(inst('options.txt')) + 2048, count: 1 },
    screenshots: { available: existsSync(inst('screenshots')), size: 0, count: 0 },
  }
  const crash = crashes.find((c) => c.name.endsWith('.txt') && Date.now() - c.mtimeMs < 86_400_000)
  let lastCrash: ReportPrepare['lastCrash'] = null
  if (crash) {
    const text = await readFile(crash.path, 'utf8').catch(() => '')
    lastCrash = { at: crash.mtimeMs, summary: crashDescription(text) }
  }
  const active = getAccountsState()
  return {
    parts: REPORT_PARTS.map((id) => ({ id, ...parts[id] })),
    player: active.accounts.find((a) => a.id === active.activeId)?.name ?? null,
    lastCrash,
    discord: getSettings().reportDiscord,
  }
}

const crashDescription = (text: string) => {
  const description = text.match(/^Description: (.+)$/m)?.[1]?.trim()
  const exception = text.match(/^((?:[a-z]+\.)+[A-Za-z]*(?:Exception|Error)[^\n]*)$/m)?.[1]?.trim()
  return [description, exception].filter(Boolean).join(' — ').slice(0, 300) || 'crash report'
}

// ------------------------------------------------------------------------------ privacy

/** Removes private details from a text file of the report. */
export function scrub(text: string, opts: { home: string; user: string; names: string[]; removeChat: boolean }): string {
  let out = redact(text)
  const home = opts.home.replace(/[\\/]+$/, '')
  for (const variant of new Set([home, home.replace(/\\/g, '/'), home.replace(/\\/g, '\\\\')]))
    if (variant.length > 3) out = out.split(variant).join('%USERPROFILE%').split(variant.toLowerCase()).join('%USERPROFILE%')
  if (opts.user.length >= 3) out = out.replace(new RegExp(`\\b${opts.user.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), '<windows-user>')
  for (const n of opts.names) if (/^\w{3,16}$/.test(n)) out = out.replace(new RegExp(`\\b${n}\\b`, 'g'), '<other-account>')
  out = out
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '<e-mail>')
    // IP addresses where logs write them ("/1.2.3.4", "1.2.3.4:25565", "@1.2.3.4"); a bare 0.6.0.78 is a version
    .replace(/(?<=[/@]|\bIP:? ?)(?!127\.)(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g, '<ip>')
    .replace(/\b(?!127\.)(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}(?=:\d{2,5}\b)/g, '<ip>')
  if (opts.removeChat) out = out.replace(/(\[CHAT\]).*$/gm, '$1 (message removed)')
  return out
}

// ------------------------------------------------------------------------------ the quick look

interface Facts {
  logText: string
  crashTexts: { name: string; text: string; mtimeMs: number }[]
  memoryMb: number
  recommendedMb: number
  totalMb: number
  customJava: string | null
  jvmArgs: string[]
  mods: ModItem[] | null
  history: ReturnType<typeof readHistory>
  freeGb: number | null
  hybridGpu: boolean
  highPerformanceGpu: boolean
  shadersOn: boolean
  irisOn: boolean | null
  server: { online: boolean | null; latencyMs: number | null } | null
  lang: string
}

/** Usual causes, spotted automatically: the first thing staff read. Plain English (staff tools). */
export function quickLook(f: Facts): string[] {
  const out: string[] = []
  const all = [f.logText, ...f.crashTexts.map((c) => c.text)].join('\n')
  const newest = f.crashTexts.find((c) => c.name.endsWith('.txt'))
  if (newest) out.push(`Crash report ${new Date(newest.mtimeMs).toLocaleString('en-GB')}: ${crashDescription(newest.text)} (crash-reports/${newest.name})`)
  const jvm = f.crashTexts.find((c) => c.name.startsWith('hs_err'))
  if (jvm) out.push(`Java itself crashed (jvm/${jvm.name}): often a graphics driver or a broken Java install.`)
  if (/java\.lang\.OutOfMemoryError/.test(all))
    out.push(`Out of memory: Minecraft had ${f.memoryMb} MB (recommended ${f.recommendedMb} MB, the PC has ${Math.round(f.totalMb / 1024)} GB).`)
  for (const m of parseIncompatibleMods(f.logText)) out.push(`Fabric refused ${m.name} ${m.version}${m.needs ? `: needs ${m.needs}` : ''}.`)
  const counts = new Map<string, number>()
  const IGNORE = new Set(['minecraft', 'java', 'fabricloader', 'fabric-loader', 'mixinextras'])
  for (const t of f.crashTexts.map((c) => c.text).concat(f.logText.slice(-200_000)))
    for (const m of t.matchAll(/(?:provided by '|from mod |by mod )([a-z0-9_.-]{2,64})/g)) if (!IGNORE.has(m[1])) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1)
  const suspects = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  if (suspects.length) out.push(`Mods named in the crash output: ${suspects.map(([id, n]) => `${id} (${n}×)`).join(', ')}.`)
  const mixins = new Set([...all.matchAll(/mixin[^\n]{0,60}?(?:for|from|in) mod '?([a-z0-9_.-]{2,64})/gi)].map((m) => m[1]))
  if (mixins.size) out.push(`Mixin errors (a mod not fitting this game version) from: ${[...mixins].slice(0, 5).join(', ')}.`)
  if (f.memoryMb < Math.min(f.recommendedMb, 3072)) out.push(`Low memory setting: ${f.memoryMb} MB (recommended ${f.recommendedMb} MB).`)
  if (f.memoryMb > f.totalMb - 2048) out.push(`Memory setting ${f.memoryMb} MB leaves less than 2 GB to Windows (PC: ${Math.round(f.totalMb / 1024)} GB).`)
  if (f.customJava) out.push(`Custom Java in use: ${f.customJava}.`)
  if (f.jvmArgs.length) out.push(`Extra JVM arguments: ${f.jvmArgs.join(' ')}.`)
  if (f.mods) {
    const own = f.mods.filter((m) => !m.fromHemisphere && m.enabled)
    if (own.length) out.push(`${own.length} mods added by the player are on (try "Launch without my mods" to rule them out).`)
    const taken = f.mods.filter((m) => m.fromHemisphere && !m.managed)
    if (taken.length) out.push(`Hemisphere mods the player changed (own version): ${taken.map((m) => `${m.name} ${m.versionNumber ?? ''}`.trim()).join(', ')}.`)
    const offRecommended = f.mods.filter((m) => m.managed && m.recommended && !m.enabled)
    if (offRecommended.length) out.push(`Recommended Hemisphere mods switched off: ${offRecommended.map((m) => m.name).join(', ')}.`)
    const blocked = f.mods.filter((m) => m.enabled && m.verdict === 'blocked')
    if (blocked.length) out.push(`Mods not allowed on the server are on: ${blocked.map((m) => m.name).join(', ')}.`)
  }
  const day = Date.now() - 86_400_000
  const recent = f.history.filter((h) => h.at >= day && h.kind !== 'setImport' && h.kind !== 'setSwitch')
  if (recent.length) out.push(`Changed in the last 24 h: ${recent.slice(0, 8).map(change).join('; ')}${recent.length > 8 ? ` (+${recent.length - 8} more)` : ''}.`)
  const switches = f.history.filter((h) => h.at >= day && h.kind === 'setSwitch')
  if (switches.length) out.push(`Preset switched ${switches.length}× in the last 24 h (now: ${switches[0].name}).`)
  if (f.freeGb !== null && f.freeGb < 2) out.push(`Low disk space: ${f.freeGb.toFixed(1)} GB free on the game drive.`)
  if (f.hybridGpu && !f.highPerformanceGpu) out.push('Laptop with two graphics chips and "Use the high-performance graphics card" is off.')
  if (f.shadersOn && f.irisOn === false) out.push('A shader is selected but Iris is off.')
  if (f.server) out.push(`Server at report time: ${f.server.online === null ? 'unknown' : f.server.online ? 'online' : 'OFFLINE'}${f.server.latencyMs !== null ? `, ${f.server.latencyMs} ms from this PC` : ', not reachable from this PC'}.`)
  return out.length ? out : ['Nothing unusual found automatically.']
}

/** One history entry, the way staff read it: "Sodium 0.7 → 0.6 (version)", "installed Jade 26.3.5". */
function change(h: ReturnType<typeof readHistory>[number]): string {
  const what = h.type && h.type !== 'mod' ? ` [${h.type}]` : ''
  switch (h.kind) {
    case 'version':
    case 'update':
      return `${h.name}${what} ${h.from ?? '?'} → ${h.to ?? '?'} (${h.kind})`
    case 'install':
      return `installed ${h.name}${what} ${h.to ?? ''}`.trim()
    case 'remove':
      return `removed ${h.name}${what}`
    case 'lock':
    case 'unlock':
      return `${h.kind}ed ${h.name}${what} ${h.to ?? ''}`.trim()
    case 'backToHemisphere':
      return `${h.name} back to Hemisphere's version`
    default:
      return `${h.kind} ${h.name}`
  }
}

// ------------------------------------------------------------------------------ build

const newReportId = () => {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // no 0/O/1/I/L
  return `HR-${[...randomBytes(6)].map((b) => alphabet[b % alphabet.length]).join('')}`
}

const clean = (s: unknown, max: number) => (typeof s === 'string' ? s.replace(/\r/g, '').slice(0, max).trim() : '')

let lastZip: string | null = null
/** The zip just built (only that file may be dragged out of the launcher). */
export const lastReportZip = () => lastZip

export async function buildReport(draft: ReportDraft, manifest: ClientManifest | null, policy: ModPolicy | null | undefined, launcherVersion: string): Promise<ReportResult> {
  try {
    const d = {
      ...draft,
      title: clean(draft.title, REPORT_TEXT_MAX.title),
      description: clean(draft.description, REPORT_TEXT_MAX.description),
      expected: clean(draft.expected, REPORT_TEXT_MAX.expected),
      steps: clean(draft.steps, REPORT_TEXT_MAX.steps),
      discord: clean(draft.discord, REPORT_TEXT_MAX.discord),
    }
    if (!d.title || !d.description) return { ok: false, reason: 'invalid' }
    const want = (p: ReportPart) => draft.parts?.[p] !== false
    const id = newReportId()
    const now = new Date()
    const settings = getSettings()
    const state = await readInstanceState()
    const accounts = getAccountsState()
    const player = accounts.accounts.find((a) => a.id === accounts.activeId)?.name ?? 'unknown'
    const privacy = { home: app.getPath('home'), user: userInfo().username, names: accounts.accounts.map((a) => a.name).filter((n) => n !== player), removeChat: draft.removeChat !== false }
    const text = (s: string) => scrub(s, privacy)
    const zip = new ZipWriter()
    const root = `Hemisphere report ${id}/`

    // facts
    const totalMb = Math.round(totalmem() / MB)
    const recommendedMb = recommendedMemoryMb()
    const memoryMb = settings.memoryMb ?? recommendedMb
    const managedJava = await installedJavaPath()
    const java = settings.javaPath ? await inspectJava(settings.javaPath, false) : managedJava ? await inspectJava(managedJava, true) : null
    const logPath = inst('logs', 'latest.log')
    const logRaw = existsSync(logPath) ? await readTail(logPath, LOG_MAX) : ''
    const crashFiles = recentCrashFiles()
    const crashTexts = await Promise.all(crashFiles.map(async (c) => ({ name: c.name, mtimeMs: c.mtimeMs, text: await readTail(c.path, LOG_MAX) })))
    const mods = manifest ? await listMods(manifest, policy).catch(() => null) : null
    const history = readHistory()
    let dir = gamePaths().root
    while (!existsSync(dir) && dirname(dir) !== dir) dir = dirname(dir)
    const fsStats = await statfs(dir).catch(() => null)
    const freeGb = fsStats ? (fsStats.bavail * fsStats.bsize) / 1024 ** 3 : null
    const shaders = await readShaders()
    const shaderList = manifest ? await listPacks('shader', manifest.minecraft, policy).catch(() => null) : null
    const resourceList = manifest ? await listPacks('resourcepack', manifest.minecraft, policy).catch(() => null) : null
    const irisOn = mods ? mods.some((m) => /iris/i.test(m.name) && m.enabled) : null
    const server = draft.category === 'connect' || draft.category === 'server' ? await Promise.race([getServerStatus(), new Promise<null>((r) => setTimeout(() => r(null), 8000))]).catch(() => null) : null
    const gpu = gpuSummary()
    const look = quickLook({
      logText: logRaw,
      crashTexts,
      memoryMb,
      recommendedMb,
      totalMb,
      customJava: settings.javaPath && java ? `Java ${java.version}` : settings.javaPath ? 'not usable' : null,
      jvmArgs: parseJvmArgs(settings.jvmArgs).args,
      mods,
      history,
      freeGb,
      hybridGpu: gpu.hybrid,
      highPerformanceGpu: settings.highPerformanceGpu,
      shadersOn: shaders.on,
      irisOn,
      server: server ? { online: server.online, latencyMs: server.latencyMs } : null,
      lang: 'en',
    }).map(text)

    // system.txt
    const system = [
      `Launcher: ${launcherVersion} (Electron ${process.versions.electron}, ${app.isPackaged ? 'installed' : 'development build'})`,
      `Windows: ${release()} ${process.arch}`,
      `CPU: ${cpus()[0]?.model ?? 'unknown'} (${cpus().length} threads)`,
      `RAM: ${Math.round(totalMb / 1024)} GB`,
      `Graphics: ${gpu.names.join(' + ') || 'unknown'}${gpu.hybrid ? ' (two chips)' : ''} · high-performance chip for Minecraft: ${settings.highPerformanceGpu ? 'on' : 'off'}`,
      `Free disk space (game drive): ${freeGb === null ? 'unknown' : `${freeGb.toFixed(1)} GB`}`,
      `Client: ${state.clientVersion ?? 'not installed'} · Minecraft ${state.minecraft ?? '-'} · ${Object.keys(state.owned).length} Hemisphere files`,
      `Java: ${java ? `${java.version} (${settings.javaPath ? 'custom' : 'managed by Hemisphere'})` : 'not installed'}`,
      `Memory: ${settings.memoryMb ? `${settings.memoryMb} MB` : `auto (${recommendedMb} MB)`} · JVM arguments: ${parseJvmArgs(settings.jvmArgs).args.join(' ') || 'none'}`,
      `Game window: ${settings.resolution} · On game start: ${settings.onGameStart} · Auto-join: ${settings.autoJoin} · Background updates: ${settings.backgroundUpdates}`,
      `Game folder: ${settings.gameDir ? 'custom' : 'default'} · Language: ${settings.language}`,
      `Accounts: ${accounts.accounts.length} · Player: ${player}`,
    ].join('\n')

    // README.txt
    const when = { now: 'just now', today: 'earlier today', earlier: 'before today' }[d.when] ?? d.when
    const freq = { always: 'every time', sometimes: 'sometimes', once: 'once' }[d.frequency] ?? d.frequency
    const readme = [
      `HEMISPHERE PROBLEM REPORT ${id}`,
      `Created ${now.toLocaleString('en-GB')} by launcher ${launcherVersion}`,
      '',
      `Player:     ${player}`,
      `Discord:    ${d.discord || '(not given)'}`,
      `Category:   ${d.category}`,
      `Happened:   ${when} · ${freq}`,
      `Client:     ${state.clientVersion ?? '-'} (Minecraft ${state.minecraft ?? '-'})`,
      '',
      `TITLE`,
      d.title,
      '',
      'WHAT HAPPENED',
      d.description,
      ...(d.expected ? ['', 'WHAT THEY EXPECTED', d.expected] : []),
      ...(d.steps ? ['', 'STEPS TO MAKE IT HAPPEN', d.steps] : []),
      '',
      'QUICK LOOK (automatic)',
      ...look.map((l) => `- ${l}`),
      '',
      'FILES',
      '%FILES%',
      '',
      'Private details were removed by the launcher: Windows user name and folders, sign-in tokens, e-mail and IP addresses,',
      `other accounts' names${privacy.removeChat ? ', and chat messages in the game log' : ''}.`,
    ]

    // the files
    const add = (name: string, body: string | Buffer, why?: string) => {
      zip.add(root + name, body)
      if (why) fileNotes.push(`  ${name.padEnd(34)} ${why}`)
    }
    const fileNotes: string[] = []
    if (want('system')) add('system.txt', text(system), 'PC, Java, memory, graphics, launcher settings')
    if (want('mods') && mods) add('mods.txt', text(modsTable(mods, await listSets().catch(() => null))), 'every mod: on/off, version, where it comes from, locks')
    if (want('packs') && (resourceList || shaderList)) add('packs.txt', text(packsTable(resourceList, shaderList, shaders)), 'resource packs (order) and shaders')
    if (want('changes')) {
      const points = await listRestorePoints().catch(() => [])
      add('recent-changes.txt', text(changesText(history, points)), 'mod/pack changes and restore points, newest first')
    }
    if (want('settings')) {
      const safe = { ...settings, gameDir: settings.gameDir ? 'custom' : null, javaPath: settings.javaPath ? 'custom' : null, seenNews: undefined, reportDiscord: undefined }
      add('settings/launcher.json', text(JSON.stringify(safe, null, 2)), 'launcher settings')
      if (existsSync(inst('options.txt'))) add('settings/options.txt', text(await readFile(inst('options.txt'), 'utf8')), "Minecraft's settings (video, keys, packs)")
      if (existsSync(inst('config', 'iris.properties'))) add('settings/iris.properties', text(await readFile(inst('config', 'iris.properties'), 'utf8')))
    }
    if (want('launcherLog')) {
      if (existsSync(launcherLogPath())) add('logs/launcher.log', text(await readTail(launcherLogPath(), LOG_MAX)), "the launcher's log (installs, PLAY, errors)")
      const previous = join(launcherLogDir(), 'launcher.1.log')
      if (existsSync(previous)) add('logs/launcher.previous.log', text(await readTail(previous, LOG_MAX)))
    }
    if (want('gameLog') && logRaw) add('logs/latest.log', text(logRaw), "Minecraft's log of the last game")
    if (want('crashReports'))
      for (const c of crashTexts) add(c.name.startsWith('hs_err') ? `jvm/${c.name}` : `crash-reports/${c.name}`, text(c.text), c.name.startsWith('hs_err') ? 'Java crash file' : 'Minecraft crash report')
    if (want('screenshots'))
      for (const name of (draft.screenshots ?? []).slice(0, 5)) {
        if (!isScreenshotName(name) || !existsSync(inst('screenshots', name))) continue
        add(`screenshots/${name}`, await readFile(inst('screenshots', name)), 'chosen by the player')
      }
    const report = {
      format: 'hemisphere-report',
      version: 1,
      id,
      createdAt: now.toISOString(),
      launcherVersion,
      player,
      discord: d.discord || null,
      category: d.category,
      when: d.when,
      frequency: d.frequency,
      title: d.title,
      description: d.description,
      expected: d.expected || null,
      steps: d.steps || null,
      client: { version: state.clientVersion, minecraft: state.minecraft },
      quickLook: look,
      included: REPORT_PARTS.filter(want),
    }
    add('report.json', text(JSON.stringify(report, null, 2)), 'the same, for tools')
    zip.add(root + 'README.txt', text(readme.join('\n').replace('%FILES%', ['  README.txt                         start here', ...fileNotes].join('\n'))))

    // save next to the player's downloads
    const folder = app.getPath('downloads')
    let zipName = `Hemisphere report ${id}.zip`
    for (let i = 2; existsSync(join(folder, zipName)); i++) zipName = `Hemisphere report ${id} (${i}).zip`
    const zipPath = join(folder, zipName)
    const buffer = zip.toBuffer()
    await writeFile(zipPath, buffer)
    lastZip = zipPath

    const message = discordMessage({ id, player, d, launcherVersion, client: state, java: java?.version ?? null, gpu: gpu.names[0] ?? null, totalMb, look, zipName })
    clipboard.writeText(message)
    if (d.discord !== settings.reportDiscord) await import('../settings/settings').then((s) => s.updateSettings({ reportDiscord: d.discord })).catch(() => {})
    console.log(`[report] ${id}: ${d.category}, ${zip.files.length} files, ${Math.round(buffer.length / 1024)} KB`)
    return { ok: true, id, zipPath, zipName, bytes: buffer.length, message, files: zip.files.map((f) => f.slice(root.length)), quickLook: look }
  } catch (err) {
    console.error('[report] failed:', err)
    return { ok: false, reason: 'failed', detail: String(err) }
  }
}

/** The end of a (possibly big) text file. */
async function readTail(path: string, max: number): Promise<string> {
  const size = (await stat(path)).size
  if (size <= max) return readFile(path, 'utf8')
  const fh = await import('node:fs/promises').then((m) => m.open(path, 'r'))
  try {
    const buf = Buffer.alloc(max)
    await fh.read(buf, 0, max, size - max)
    return `[… first ${Math.round((size - max) / MB)} MB left out …]\n${buf.toString('utf8')}`
  } finally {
    await fh.close()
  }
}

function modsTable(mods: ModItem[], sets: Awaited<ReturnType<typeof listSets>> | null): string {
  const row = (m: ModItem) =>
    [
      m.enabled ? 'ON ' : 'off',
      m.name.padEnd(36).slice(0, 36),
      (m.versionNumber ?? '?').padEnd(28).slice(0, 28),
      m.managed ? 'Hemisphere' : m.fromHemisphere ? 'Hemisphere, own version' : 'added by player',
      [m.locked && 'locked', m.duplicate && 'duplicate', m.update && `update ${m.update.versionNumber}`, m.verdict !== 'allowed' && m.verdict, m.incompatibleWith && `no version for ${m.incompatibleWith}`, m.file]
        .filter(Boolean)
        .join(' · '),
    ].join('  ')
  const active = sets?.sets.find((s) => s.id === sets.active)
  return [
    `${mods.filter((m) => m.enabled).length} of ${mods.length} mods on · preset: ${active?.name ?? 'none'}${sets ? ` (${sets.sets.length} presets)` : ''}`,
    '',
    ...[...mods].sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name)).map(row),
  ].join('\n')
}

function packsTable(resource: Awaited<ReturnType<typeof listPacks>> | null, shader: Awaited<ReturnType<typeof listPacks>> | null, sh: { pack: string; on: boolean }): string {
  const lines = ['RESOURCE PACKS (on: top one wins)']
  for (const p of [...(resource?.items ?? [])].sort((a, b) => (a.order ?? 999) - (b.order ?? 999)))
    lines.push(`  ${p.active ? `#${(p.order ?? 0) + 1}` : 'off'}  ${p.name}  ${p.versionNumber ?? (p.folder ? 'folder' : 'not on Modrinth')}${p.incompatible ? '  (made for another version)' : ''}${p.locked ? '  locked' : ''}  ${p.file}`)
  lines.push('', `SHADERS (${sh.on ? `on: ${sh.pack}` : 'off'}; Iris ${shader?.irisReady ? 'on' : 'off'})`)
  for (const p of shader?.items ?? []) lines.push(`  ${p.active ? 'IN USE' : '      '}  ${p.name}  ${p.versionNumber ?? 'not on Modrinth'}  ${p.file}`)
  return lines.join('\n')
}

function changesText(history: ReturnType<typeof readHistory>, points: Awaited<ReturnType<typeof listRestorePoints>>): string {
  return [
    'MOD AND PACK CHANGES (newest first)',
    ...history.slice(0, 40).map((h) => `  ${new Date(h.at).toLocaleString('en-GB')}  ${h.kind.padEnd(16)} ${h.type && h.type !== 'mod' ? `[${h.type}] ` : ''}${h.name}${h.from || h.to ? `  ${h.from ?? '—'} → ${h.to ?? '—'}` : ''}`),
    '',
    'RESTORE POINTS',
    ...points.map((p) => `  ${new Date(p.createdAt).toLocaleString('en-GB')}  before ${p.reason.kind}  (${p.mods} mods)`),
  ].join('\n')
}

/** The Discord message: the essentials, under Discord's 2000 characters (the zip has the rest). */
export function discordMessage(x: {
  id: string
  player: string
  d: Pick<ReportDraft, 'category' | 'title' | 'description' | 'expected' | 'steps' | 'when' | 'frequency' | 'discord'>
  launcherVersion: string
  client: { clientVersion: string | null; minecraft: string | null }
  java: string | null
  gpu: string | null
  totalMb: number
  look: string[]
  zipName: string
}): string {
  const freq = { always: 'every time', sometimes: 'sometimes', once: 'once' }[x.d.frequency] ?? x.d.frequency
  const when = { now: 'just now', today: 'today', earlier: 'before today' }[x.d.when] ?? x.d.when
  const head = [
    `**🛠️ Problem report ${x.id}** · ${x.d.category}`,
    `**${x.d.title}**`,
    `Player **${x.player}**${x.d.discord ? ` · Discord ${x.d.discord}` : ''} · happened ${when}, ${freq}`,
    `Launcher ${x.launcherVersion} · client ${x.client.clientVersion ?? '-'} (MC ${x.client.minecraft ?? '-'}) · Windows ${release()} · ${Math.round(x.totalMb / 1024)} GB RAM${x.gpu ? ` · ${x.gpu}` : ''}${x.java ? ` · Java ${x.java}` : ''}`,
  ]
  const tail = [`📎 Full report: \`${x.zipName}\` (attached)`]
  const quick = ['**Quick look**', ...x.look.slice(0, 5).map((l) => `• ${l.slice(0, 200)}`)]
  const body = [`> ${x.d.description.replace(/\n/g, '\n> ')}`, ...(x.d.expected ? [`**Expected:** ${x.d.expected}`] : []), ...(x.d.steps ? [`**Steps:** ${x.d.steps}`] : [])]
  const build = (b: string[]) => [...head, '', ...b, '', ...quick, '', ...tail].join('\n')
  let msg = build(body)
  if (msg.length > DISCORD_LIMIT) {
    const room = DISCORD_LIMIT - build([]).length - 40
    msg = build([`> ${x.d.description.slice(0, Math.max(100, room)).replace(/\n/g, '\n> ')}…`, '(full text in README.txt)'])
  }
  return msg.slice(0, DISCORD_LIMIT)
}
