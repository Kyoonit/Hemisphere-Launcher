import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { History, Image, Package, Sparkles, Upload, type LucideIcon } from 'lucide-react'
import ModSetsMenu from '../components/ModSetsMenu'
import Mods, { useClient } from './Mods'
import Packs from './Packs'

export type ContentTab = 'mods' | 'resourcepack' | 'shader'
export type BrowseKind = 'mod' | 'resourcepack' | 'shader'

const TABS: { id: ContentTab; icon: LucideIcon }[] = [
  { id: 'mods', icon: Package },
  { id: 'resourcepack', icon: Image },
  { id: 'shader', icon: Sparkles },
]

/**
 * Content: mods, resource packs and shaders in one page (one tab in the title bar). The tabs take the place of the
 * page title; presets, history and import stay top right for all three.
 */
export default function Content({
  tab,
  onTab,
  onBrowse,
  onHistory,
  onImport,
}: {
  tab: ContentTab
  onTab(t: ContentTab): void
  onBrowse(kind: BrowseKind): void
  onHistory(): void
  onImport(): void
}) {
  const { t } = useTranslation()
  const client = useClient()
  // a preset switch changes every tab: the current one reloads
  const [refresh, setRefresh] = useState(0)
  const toolButton = 'flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-semibold text-gray-300 transition-colors hover:bg-gray-700 hover:text-white'

  const top = (
    <div className="mb-3">
      <p className="text-xs font-bold tracking-[0.08em] text-green-400 uppercase">
        {client ? t('mods.subtitle', { version: client.clientVersion, minecraft: client.minecraft }) : ' '}
      </p>
      <div className="mt-1.5 flex items-center justify-between gap-3">
        <div role="tablist" aria-label={t('nav.mods')} className="flex flex-none gap-1 rounded-xl bg-gray-800/70 p-1">
          {TABS.map(({ id, icon: Icon }) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => onTab(id)}
              className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-[14.5px] font-bold transition-colors ${tab === id ? 'bg-green-600 text-white shadow-md' : 'text-gray-300 hover:bg-gray-700 hover:text-white'}`}
            >
              <Icon size={16} /> {t(`content.tabs.${id}`)}
            </button>
          ))}
        </div>
        {/* top right, under the window buttons: presets, history, import */}
        <div className="flex flex-none items-center gap-1.5">
          <ModSetsMenu className={toolButton} onSwitched={() => setRefresh((r) => r + 1)} />
          <button onClick={onHistory} className={toolButton}>
            <History size={14} /> {t('history.title')}
          </button>
          <button onClick={onImport} className={toolButton}>
            <Upload size={14} /> {t('import.settingsButton')}
          </button>
        </div>
      </div>
    </div>
  )

  return tab === 'mods' ? (
    <Mods key={`mods-${refresh}`} top={top} onBrowse={() => onBrowse('mod')} />
  ) : (
    <Packs key={`${tab}-${refresh}`} type={tab} top={top} onBrowse={() => onBrowse(tab)} />
  )
}
