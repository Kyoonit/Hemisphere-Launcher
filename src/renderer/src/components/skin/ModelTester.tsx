import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Box, X } from 'lucide-react'
import { ModelError, readModel, type ModelFile } from '@shared/models'
import type { WornModel } from './SkinView'
import type { WornSlot } from './modelMesh'

const SLOTS: WornSlot[] = ['head', 'righthand', 'lefthand']

/** The alpha of a PNG (flat items get side faces from it) */
async function withAlpha(f: ModelFile): Promise<ModelFile> {
  if (!f.content.startsWith('data:image/png')) return f
  const img = new Image()
  img.src = f.content
  await img.decode()
  const c = document.createElement('canvas')
  c.width = img.width
  c.height = img.height
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0)
  const px = ctx.getImageData(0, 0, img.width, img.height).data
  const alpha = new Uint8Array(img.width * img.height)
  for (let i = 0; i < alpha.length; i++) alpha[i] = px[i * 4 + 3]
  return { ...f, width: img.width, height: img.height, alpha }
}

/**
 * Staff only (Developer tab > "Test a model"): try a model file on in the viewer before it is in the catalogue: a Blockbench
 * project, or a Minecraft JSON model with its PNGs (and parent models). Read in memory, kept nowhere.
 */
export function ModelTester({ onWear }: { onWear(worn: WornModel[]): void }) {
  const { t } = useTranslation()
  const [allowed, setAllowed] = useState(false)
  const [model, setModel] = useState<{ name: string; data: WornModel['model'] } | null>(null)
  const [slot, setSlot] = useState<WornSlot>('head')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // switched on in the Developer tab
    void window.hemisphere.dev.get().then((d) => setAllowed(!!d?.state?.modelTester))
  }, [])
  useEffect(() => onWear(model ? [{ model: model.data, slot }] : []), [model, slot]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!allowed) return null

  const pick = async () => {
    setError(null)
    const r = await window.hemisphere.skins.pickModel()
    if (!r.ok) return r.error !== 'cancelled' && setError(t(`skins.models.errors.${r.error}`))
    try {
      const files = await Promise.all(r.files.map(withAlpha))
      const data = readModel(files)
      const main = files.find((f) => /\.bbmodel$/i.test(f.name)) ?? files.find((f) => /\.json$/i.test(f.name))
      setModel({ name: main?.name ?? '?', data })
      if (data.kind === 'entity') setSlot('head')
    } catch (err) {
      setError(t('skins.models.errors.unreadable', { detail: err instanceof ModelError ? err.message : String(err) }))
    }
  }

  return (
    <div className="mt-5 rounded-xl bg-gray-800/50 p-3 ring-1 ring-amber-500/20">
      <p className="text-xs font-semibold tracking-wide text-amber-400/90 uppercase">{t('skins.models.title')}</p>
      <p className="mt-0.5 text-xs text-gray-500">{t('skins.models.hint')}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button onClick={pick} className="flex items-center gap-2 rounded-lg bg-gray-700/85 px-3 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-gray-600">
          <Box size={14} /> {t('skins.models.pick')}
        </button>
        {model && (
          <>
            <span className="max-w-48 truncate text-[13px] text-gray-300" title={model.name}>
              {model.name}
            </span>
            {model.data.kind === 'java' &&
              SLOTS.map((s) => (
                <button
                  key={s}
                  onClick={() => setSlot(s)}
                  className={`rounded-lg px-2.5 py-1 text-[12px] font-semibold transition-colors ${slot === s ? 'bg-green-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white'}`}
                >
                  {t(`skins.models.slots.${s}`)}
                </button>
              ))}
            {model.data.kind === 'entity' && <span className="text-[12px] text-gray-500">{t('skins.models.entity')}</span>}
            <button onClick={() => setModel(null)} title={t('skins.models.remove')} className="rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-white">
              <X size={14} />
            </button>
          </>
        )}
      </div>
      {error && <p className="mt-2 text-xs text-amber-400">{error}</p>}
    </div>
  )
}
