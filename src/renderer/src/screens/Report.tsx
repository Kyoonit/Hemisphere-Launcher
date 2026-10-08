import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  Bug,
  Check,
  ClipboardCopy,
  Cpu,
  FileArchive,
  FolderOpen,
  Gauge,
  Image,
  LoaderCircle,
  Package,
  Plug,
  Rocket,
  Server,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import { localize } from '@shared/manifest'
import { REPORT_PARTS, REPORT_TEXT_MAX, type ReportCategory, type ReportDraft, type ReportPart, type ReportPrepare, type ReportResult } from '@shared/report'
import { screenshotUrl, type Screenshot } from '@shared/screenshots'
import Toggle from '../components/Toggle'
import DiscordIcon from '../components/DiscordIcon'
import { formatBytes } from '../format'
import { useFeed } from '../hooks'

const CATEGORIES: { id: ReportCategory; icon: LucideIcon }[] = [
  { id: 'crash', icon: Bug },
  { id: 'launcher', icon: Rocket },
  { id: 'connect', icon: Plug },
  { id: 'mods', icon: Package },
  { id: 'performance', icon: Gauge },
  { id: 'account', icon: UserRound },
  { id: 'server', icon: Server },
  { id: 'other', icon: Sparkles },
]
const PART_ICONS: Record<ReportPart, LucideIcon> = {
  system: Cpu,
  launcherLog: Rocket,
  gameLog: FileArchive,
  crashReports: Bug,
  mods: Package,
  packs: Image,
  changes: Sparkles,
  settings: Gauge,
  screenshots: Image,
}
/** What usually matters for each kind of problem (the others stay available). */
const SUGGESTED: Record<ReportCategory, ReportPart[]> = {
  crash: ['system', 'launcherLog', 'gameLog', 'crashReports', 'mods', 'packs', 'changes', 'settings'],
  launcher: ['system', 'launcherLog', 'settings'],
  connect: ['system', 'launcherLog', 'gameLog', 'mods'],
  mods: ['system', 'launcherLog', 'gameLog', 'crashReports', 'mods', 'changes'],
  performance: ['system', 'gameLog', 'mods', 'packs', 'settings'],
  account: ['system', 'launcherLog'],
  server: ['system', 'gameLog'],
  other: ['system', 'launcherLog', 'gameLog'],
}

/**
 * "Report a problem": the player describes it, the launcher gathers everything staff need into a zip (private
 * details removed) and writes the Discord message. Nothing is sent by itself: the player posts both in a ticket.
 */
export default function Report({ initialCategory, onBack }: { initialCategory: ReportCategory | null; onBack(): void }) {
  const { t } = useTranslation()
  const [prep, setPrep] = useState<ReportPrepare | null>(null)
  const [result, setResult] = useState<Extract<ReportResult, { ok: true }> | null>(null)
  const [draft, setDraft] = useState<ReportDraft | null>(null)

  useEffect(() => {
    void window.hemisphere.report.prepare().then((p) => {
      setPrep(p)
      const category = initialCategory ?? 'crash'
      setDraft({
        category,
        title: '',
        description: '',
        expected: '',
        steps: '',
        when: 'now',
        frequency: 'once',
        discord: p.discord,
        parts: Object.fromEntries(REPORT_PARTS.map((id) => [id, SUGGESTED[category].includes(id)])) as ReportDraft['parts'],
        removeChat: true,
        screenshots: [],
      })
    })
  }, [])

  return (
    <div className="h-full overflow-auto px-8 py-6">
      <button onClick={onBack} className="mb-3 flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-gray-400 transition-colors hover:bg-gray-700 hover:text-white">
        <ArrowLeft size={14} /> {t('report.back')}
      </button>
      <p className="text-xs font-bold tracking-[0.08em] text-green-400 uppercase">{t('report.subtitle')}</p>
      <h1 className="text-[30px] font-bold text-white uppercase">{t('report.title')}</h1>
      <p className="mt-1 mb-5 max-w-[72ch] text-[13px] text-gray-400">{t('report.intro')}</p>

      {!prep || !draft ? (
        <div className="space-y-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-28 rounded-xl" />
          ))}
        </div>
      ) : result ? (
        <Done
          result={result}
          onAgain={() => {
            setResult(null)
            setDraft({ ...draft, title: '', description: '', expected: '', steps: '', screenshots: [] })
          }}
        />
      ) : (
        <Form prep={prep} draft={draft} setDraft={setDraft} onDone={setResult} />
      )}
    </div>
  )
}

// ------------------------------------------------------------------------------ the form

function Form({ prep, draft, setDraft, onDone }: { prep: ReportPrepare; draft: ReportDraft; setDraft(d: ReportDraft): void; onDone(r: Extract<ReportResult, { ok: true }>): void }) {
  const { t, i18n } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shots, setShots] = useState<Screenshot[]>([])
  useEffect(() => {
    void window.hemisphere.screenshots.list().then((l) => setShots(l.screenshots.slice(0, 12)))
  }, [])
  const set = (patch: Partial<ReportDraft>) => setDraft({ ...draft, ...patch })
  const pickCategory = (category: ReportCategory) =>
    set({ category, parts: Object.fromEntries(REPORT_PARTS.map((id) => [id, SUGGESTED[category].includes(id) || (id === 'screenshots' && draft.screenshots.length > 0)])) as ReportDraft['parts'] })
  const missing = [!draft.title.trim() && t('report.fields.title'), !draft.description.trim() && t('report.fields.description')].filter(Boolean) as string[]

  const create = async () => {
    setBusy(true)
    setError(null)
    const r = await window.hemisphere.report.build(draft).catch(() => null)
    setBusy(false)
    if (r?.ok) onDone(r)
    else setError(t('report.failed'))
  }

  const input = 'w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:border-green-500 focus:outline-none'
  const seg = (on: boolean) => `rounded-md px-3 py-1.5 text-[13px] font-semibold transition-colors ${on ? 'bg-green-600 text-white' : 'text-gray-300 hover:bg-gray-700 hover:text-white'}`

  return (
    <div className="max-w-[860px] space-y-4">
      {prep.lastCrash && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border-l-[3px] border-red-400 bg-red-950/40 px-4 py-3 text-[13px] text-red-100">
          <Bug size={16} className="flex-none text-red-300" />
          <span className="min-w-0 flex-1">
            <b className="text-white">{t('report.lastCrash', { time: new Date(prep.lastCrash.at).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' }) })}</b>
            <span className="block truncate text-xs text-red-200/80">{prep.lastCrash.summary}</span>
          </span>
          {draft.category !== 'crash' && (
            <button onClick={() => pickCategory('crash')} className="flex-none rounded-md bg-red-500/30 px-3 py-1 text-xs font-bold text-white hover:bg-red-500/45">
              {t('report.aboutCrash')}
            </button>
          )}
        </div>
      )}

      <Section n={1} title={t('report.s1')}>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
          {CATEGORIES.map(({ id, icon: Icon }) => {
            const on = draft.category === id
            return (
              <button
                key={id}
                onClick={() => pickCategory(id)}
                aria-pressed={on}
                className={`flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors ${on ? 'bg-green-900/40 ring-2 ring-green-500' : 'bg-gray-800/70 hover:bg-gray-700/80'}`}
              >
                <Icon size={17} className={`mt-0.5 flex-none ${on ? 'text-green-400' : 'text-gray-400'}`} />
                <span className="min-w-0">
                  <b className="block text-[13.5px] text-white">{t(`report.categories.${id}.label`)}</b>
                  <span className="block text-[11.5px] leading-snug text-gray-400">{t(`report.categories.${id}.hint`)}</span>
                </span>
              </button>
            )
          })}
        </div>
      </Section>

      <Section n={2} title={t('report.s2')}>
        <label className="block">
          <span className="mb-1 flex justify-between text-[13px] font-semibold text-gray-200">
            {t('report.fields.title')} <Counter value={draft.title} max={REPORT_TEXT_MAX.title} />
          </span>
          <input value={draft.title} maxLength={REPORT_TEXT_MAX.title} onChange={(e) => set({ title: e.target.value })} placeholder={t(`report.placeholders.title.${draft.category}`)} className={input} />
        </label>
        <label className="mt-3 block">
          <span className="mb-1 flex justify-between text-[13px] font-semibold text-gray-200">
            {t('report.fields.description')} <Counter value={draft.description} max={REPORT_TEXT_MAX.description} />
          </span>
          <textarea
            value={draft.description}
            maxLength={REPORT_TEXT_MAX.description}
            onChange={(e) => set({ description: e.target.value })}
            rows={4}
            placeholder={t('report.placeholders.description')}
            className={`${input} resize-y`}
          />
        </label>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[13px] font-semibold text-gray-200">
              {t('report.fields.expected')} <span className="font-normal text-gray-500">{t('report.optional')}</span>
            </span>
            <textarea value={draft.expected} maxLength={REPORT_TEXT_MAX.expected} onChange={(e) => set({ expected: e.target.value })} rows={2} placeholder={t('report.placeholders.expected')} className={`${input} resize-y`} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[13px] font-semibold text-gray-200">
              {t('report.fields.steps')} <span className="font-normal text-gray-500">{t('report.optional')}</span>
            </span>
            <textarea value={draft.steps} maxLength={REPORT_TEXT_MAX.steps} onChange={(e) => set({ steps: e.target.value })} rows={2} placeholder={t('report.placeholders.steps')} className={`${input} resize-y`} />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
          <div>
            <span className="mb-1 block text-[13px] font-semibold text-gray-200">{t('report.fields.when')}</span>
            <div className="inline-flex gap-1 rounded-lg bg-gray-800/70 p-1">
              {(['now', 'today', 'earlier'] as const).map((w) => (
                <button key={w} onClick={() => set({ when: w })} aria-pressed={draft.when === w} className={seg(draft.when === w)}>
                  {t(`report.when.${w}`)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="mb-1 block text-[13px] font-semibold text-gray-200">{t('report.fields.frequency')}</span>
            <div className="inline-flex gap-1 rounded-lg bg-gray-800/70 p-1">
              {(['always', 'sometimes', 'once'] as const).map((f) => (
                <button key={f} onClick={() => set({ frequency: f })} aria-pressed={draft.frequency === f} className={seg(draft.frequency === f)}>
                  {t(`report.frequency.${f}`)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Section>

      <Section n={3} title={t('report.s3')} hint={t('report.s3hint')}>
        <ul className="grid gap-1.5 md:grid-cols-2">
          {prep.parts
            .filter((p) => p.id !== 'screenshots')
            .map((p) => {
              const Icon = PART_ICONS[p.id]
              return (
                <li key={p.id} className={`flex items-center gap-2.5 rounded-lg bg-gray-800/60 px-3 py-2 ${p.available ? '' : 'opacity-50'}`}>
                  <Icon size={15} className="flex-none text-gray-400" />
                  <span className="min-w-0 flex-1">
                    <b className="block text-[13px] text-white">{t(`report.parts.${p.id}.label`)}</b>
                    <span className="block truncate text-[11.5px] text-gray-400">
                      {p.available ? t(`report.parts.${p.id}.detail`, { count: p.count, size: formatBytes(p.size, i18n.language) }) : t('report.notAvailable')}
                    </span>
                  </span>
                  <Toggle on={p.available && draft.parts[p.id]} label={t(`report.parts.${p.id}.label`)} disabled={!p.available} onChange={(on) => set({ parts: { ...draft.parts, [p.id]: on } })} />
                </li>
              )
            })}
        </ul>
        {draft.parts.gameLog && (
          <label className="mt-2 flex items-center gap-2.5 rounded-lg bg-gray-800/40 px-3 py-2 text-[13px] text-gray-300">
            <ShieldCheck size={15} className="flex-none text-green-400" />
            <span className="min-w-0 flex-1">{t('report.removeChat')}</span>
            <Toggle on={draft.removeChat} label={t('report.removeChat')} onChange={(on) => set({ removeChat: on })} />
          </label>
        )}
        {shots.length > 0 && (
          <div className="mt-3">
            <span className="mb-1.5 block text-[13px] font-semibold text-gray-200">
              {t('report.screenshots')} <span className="font-normal text-gray-500">{t('report.screenshotsHint', { count: draft.screenshots.length })}</span>
            </span>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2">
              {shots.map((s) => {
                const on = draft.screenshots.includes(s.name)
                return (
                  <button
                    key={s.name}
                    onClick={() => {
                      const next = on ? draft.screenshots.filter((n) => n !== s.name) : [...draft.screenshots, s.name].slice(-5)
                      set({ screenshots: next, parts: { ...draft.parts, screenshots: next.length > 0 } })
                    }}
                    aria-pressed={on}
                    className={`relative aspect-video overflow-hidden rounded-md bg-gray-800 transition ${on ? 'ring-2 ring-green-400' : 'opacity-75 hover:opacity-100'}`}
                  >
                    <img src={screenshotUrl('thumb', s)} alt="" loading="lazy" draggable={false} className="h-full w-full object-cover" />
                    {on && (
                      <span className="absolute top-1 left-1 grid h-5 w-5 place-items-center rounded-full bg-green-500 text-white">
                        <Check size={12} strokeWidth={3} />
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </Section>

      <Section n={4} title={t('report.s4')}>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[13px] font-semibold text-gray-200">{t('report.fields.player')}</span>
            <input value={prep.player ?? '—'} readOnly className={`${input} cursor-default text-gray-400`} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[13px] font-semibold text-gray-200">
              {t('report.fields.discord')} <span className="font-normal text-gray-500">{t('report.recommended')}</span>
            </span>
            <input value={draft.discord} maxLength={REPORT_TEXT_MAX.discord} onChange={(e) => set({ discord: e.target.value })} placeholder={t('report.placeholders.discord')} className={input} />
          </label>
        </div>
      </Section>

      <div className="sticky bottom-0 -mx-2 flex flex-wrap items-center gap-3 rounded-xl bg-gray-900/95 px-4 py-3 shadow-[0_-8px_24px_rgba(0,0,0,0.35)] ring-1 ring-gray-800 backdrop-blur">
        <p className="flex min-w-0 flex-1 items-start gap-2 text-[12px] text-gray-400">
          <ShieldCheck size={14} className="mt-0.5 flex-none text-green-400" /> {t('report.privacy')}
        </p>
        {error && (
          <span className="flex items-center gap-1.5 text-[12.5px] text-amber-300">
            <TriangleAlert size={13} /> {error}
          </span>
        )}
        <button
          onClick={create}
          disabled={busy || missing.length > 0}
          title={missing.length ? t('report.missing', { fields: missing.join(', ') }) : undefined}
          className="flex flex-none items-center gap-2 rounded-lg bg-green-600 px-4 py-2.5 text-sm font-bold text-white shadow-md transition-colors hover:bg-green-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? <LoaderCircle size={16} className="animate-spin" /> : <FileArchive size={16} />} {busy ? t('report.creating') : t('report.create')}
        </button>
      </div>
    </div>
  )
}

function Section({ n, title, hint, children }: { n: number; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl bg-gray-900/55 p-4">
      <h2 className={`flex items-center gap-2.5 ${hint ? 'mb-1' : 'mb-3'}`}>
        <span className="grid h-6 w-6 flex-none place-items-center rounded-full bg-green-600 text-xs font-bold text-white">{n}</span>
        <span className="font-semibold text-white">{title}</span>
      </h2>
      {hint && <p className="mb-3 pl-[34px] text-[12px] text-gray-400">{hint}</p>}
      {children}
    </section>
  )
}

const Counter = ({ value, max }: { value: string; max: number }) => (
  <span className={`font-normal tabular-nums ${value.length > max * 0.9 ? 'text-amber-400' : 'text-gray-500'}`}>
    {value.length}/{max}
  </span>
)

// ------------------------------------------------------------------------------ done: send it

function Done({ result, onAgain }: { result: Extract<ReportResult, { ok: true }>; onAgain(): void }) {
  const { t, i18n } = useTranslation()
  const feed = useFeed()
  const [copied, setCopied] = useState(true)
  const howTo = feed?.support?.howTo ? localize(feed.support.howTo, i18n.language) : t('report.howTo')
  const step = 'rounded-xl bg-gray-900/55 p-4'
  const num = 'grid h-7 w-7 flex-none place-items-center rounded-full bg-green-600 text-sm font-bold text-white'

  return (
    <div className="max-w-[860px] space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border-l-[3px] border-green-400 bg-green-950/40 px-4 py-3">
        <Check size={20} className="flex-none text-green-400" />
        <div className="min-w-0 flex-1">
          <b className="block text-white">{t('report.ready', { id: result.id })}</b>
          <span className="text-[13px] text-green-100/80">{t('report.readyHint')}</span>
        </div>
        <button onClick={onAgain} className="flex-none rounded-lg px-3 py-1.5 text-[13px] font-semibold text-gray-300 hover:bg-gray-700 hover:text-white">
          {t('report.another')}
        </button>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <div className={step}>
          <div className="mb-2 flex items-center gap-2.5">
            <span className={num}>1</span>
            <b className="text-white">{t('report.step1')}</b>
          </div>
          <p className="mb-3 text-[12.5px] text-gray-400">{howTo}</p>
          <button
            onClick={() => window.hemisphere.report.openSupport()}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#5865f2] px-3 py-2.5 text-sm font-bold text-white shadow-md transition-colors hover:bg-[#4752c4]"
          >
            <DiscordIcon size={16} /> {t('report.openDiscord')}
          </button>
        </div>

        <div className={step}>
          <div className="mb-2 flex items-center gap-2.5">
            <span className={num}>2</span>
            <b className="text-white">{t('report.step2')}</b>
          </div>
          <p className="mb-3 text-[12.5px] text-gray-400">{copied ? t('report.copied') : t('report.copyHint')}</p>
          <button
            onClick={() => {
              window.hemisphere.report.copyMessage(result.message)
              setCopied(true)
            }}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-gray-700/85 px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gray-600"
          >
            {copied ? <Check size={16} className="text-green-400" /> : <ClipboardCopy size={16} />} {t('report.copyAgain')}
          </button>
        </div>

        <div className={step}>
          <div className="mb-2 flex items-center gap-2.5">
            <span className={num}>3</span>
            <b className="text-white">{t('report.step3')}</b>
          </div>
          {/* dragged straight from here into Discord (a real file drag) */}
          <div
            draggable
            onDragStart={(e) => {
              e.preventDefault()
              window.hemisphere.report.startDrag()
            }}
            title={t('report.dragHint')}
            className="mb-2 flex cursor-grab items-center gap-2.5 rounded-lg border-2 border-dashed border-green-500/60 bg-green-950/30 px-3 py-2.5 active:cursor-grabbing"
          >
            <FileArchive size={22} className="flex-none text-green-400" />
            <span className="min-w-0">
              <b className="block truncate text-[13px] text-white">{result.zipName}</b>
              <span className="text-[11.5px] text-gray-400">
                {formatBytes(result.bytes, i18n.language)} · {t('report.dragHint')}
              </span>
            </span>
          </div>
          <button onClick={() => window.hemisphere.report.showInFolder()} className="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-[13px] font-semibold text-gray-300 hover:bg-gray-700 hover:text-white">
            <FolderOpen size={15} /> {t('report.showInFolder')}
          </button>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className={step}>
          <b className="mb-2 block text-white">{t('report.messagePreview')}</b>
          <pre className="max-h-[260px] overflow-auto rounded-lg bg-gray-950/70 p-3 text-[12px] whitespace-pre-wrap text-gray-300">{result.message}</pre>
        </div>
        <div className={step}>
          <b className="mb-1 block text-white">{t('report.quickLook')}</b>
          <p className="mb-2 text-[12px] text-gray-400">{t('report.quickLookHint')}</p>
          <ul className="space-y-1 text-[12.5px] text-gray-300">
            {result.quickLook.map((l) => (
              <li key={l} className="flex gap-2">
                <span className="mt-[7px] h-1.5 w-1.5 flex-none rounded-full bg-green-400" />
                <span className="min-w-0 break-words">{l}</span>
              </li>
            ))}
          </ul>
          <details className="mt-3 text-[12px] text-gray-400">
            <summary className="cursor-pointer font-semibold text-gray-300">{t('report.filesIncluded', { count: result.files.length })}</summary>
            <ul className="mt-1 space-y-0.5 font-mono">
              {result.files.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </details>
        </div>
      </div>
    </div>
  )
}
